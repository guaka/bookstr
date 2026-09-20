package app.bookstr.data

import android.content.Context
import android.util.Xml
import app.bookstr.nostr.BlossomAuth
import app.bookstr.nostr.NostrSignerFactory
import app.bookstr.util.Sha256
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile
import java.io.BufferedInputStream
import javax.xml.parsers.SAXParserFactory
import org.xml.sax.Attributes
import org.xml.sax.InputSource
import org.xml.sax.SAXException
import org.xml.sax.helpers.DefaultHandler
import org.xmlpull.v1.XmlPullParser

enum class BookFormat(val extension: String) {
    Epub("epub"),
    Pdf("pdf"),
    Fb2("fb2"),
    Cbr("cbr"),
    Cbz("cbz"),
    ;

    companion object {
        fun from(value: String?, url: String = ""): BookFormat {
            val normalized = value?.trim()?.lowercase()
            if (normalized == "pdf") return Pdf
            if (normalized == "epub") return Epub
            if (normalized == "fb2" || normalized == "fb2.zip") return Fb2
            if (normalized == "cbr") return Cbr
            if (normalized == "cbz") return Cbz
            val path = url.substringBefore('?').substringBefore('#').lowercase()
            return when {
                path.endsWith(".pdf") -> Pdf
                path.endsWith(".fb2") || path.endsWith(".fb2.zip") -> Fb2
                path.endsWith(".cbr") -> Cbr
                path.endsWith(".cbz") -> Cbz
                else -> Epub
            }
        }
    }
}

data class CatalogBook(
    val id: String,
    val title: String,
    val author: String,
    val epubUrl: String,
    val coverUrl: String?,
    val sourceUrl: String? = null,
    val isbn: String? = null,
    val libvaultMd5: String? = null,
    val format: BookFormat = BookFormat.Epub,
    val blossomSha256: String? = null,
    val year: String? = null,
    val rightsStatus: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val rightsSource: String? = null,
    val language: String? = null,
)

data class BookSearchResult(
    val id: String,
    val source: String,
    val title: String,
    val author: String,
    val year: String? = null,
    val publisher: String? = null,
    val language: String? = null,
    val format: BookFormat? = null,
    val downloadUrl: String? = null,
    val coverUrl: String? = null,
    val rating: Double = 0.0,
    val editionCount: Int = 0,
    val libvaultMd5: String? = null,
    val rightsStatus: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val rightsSource: String? = null,
) {
    val isReadable: Boolean get() = (!downloadUrl.isNullOrBlank() || libvaultMd5 != null) && format != null

    fun asCatalogBook(): CatalogBook? {
        val url = downloadUrl ?: if (libvaultMd5 != null) "" else return null
        val bookFormat = format ?: return null
        return CatalogBook(
            id = id,
            title = title,
            author = author,
            epubUrl = url,
            coverUrl = coverUrl,
            sourceUrl = url,
            libvaultMd5 = libvaultMd5,
            format = bookFormat,
            year = year,
            language = language,
            rightsStatus = rightsStatus,
            license = license,
            licenseUrl = licenseUrl,
            rightsSource = rightsSource,
        )
    }
}

open class CatalogRepository(
    private val context: Context,
    private val progressDao: BookProgressDao,
    private val settings: SettingsRepository,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private fun booksDir(): File {
        val dir = File(context.filesDir, "books")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun publicationFile(bookId: String, format: BookFormat): File =
        File(booksDir(), "$bookId.${format.extension}")

    fun epubFile(bookId: String): File = publicationFile(bookId, BookFormat.Epub)

    fun publicationSize(book: CatalogBook): Long? =
        publicationFile(book.id, book.format).takeIf(File::isFile)?.length()

    suspend fun deletePublication(book: CatalogBook): Boolean = withContext(Dispatchers.IO) {
        val target = publicationFile(book.id, book.format)
        val partial = File(target.parentFile, "${target.name}.part")
        val removedTarget = !target.exists() || target.delete()
        val removedPartial = !partial.exists() || partial.delete()
        removedTarget && removedPartial
    }

    suspend fun downloadedBooks(externalFavorites: List<ExternalFavorite>): List<CatalogBook> =
        withContext(Dispatchers.IO) { synchronized(this@CatalogRepository) {
            val cached = loadDownloadedBookMetadata().associateBy { it.id }.toMutableMap()
            val discovered = booksDir().listFiles().orEmpty()
                .filter { it.isFile && it.extension.lowercase() in setOf("epub", "pdf", "fb2") }
                .filter { it.extension.lowercase() != "fb2" || isStructurallyValidFb2(it) }
                .mapNotNull { file ->
                    val id = file.nameWithoutExtension.lowercase()
                    cached[id] ?: discoverDownloadedBook(file, externalFavorites)
                }
            val merged = (cached.values + discovered).distinctBy { it.id }
            saveDownloadedBookMetadata(merged)
            merged
        } }

    private val privateCatalog = app.bookstr.nostr.PrivateCatalogClient()
    private fun service() = settings.catalogConnection?.service ?: app.bookstr.nostr.CatalogService()

    open suspend fun searchPage(query: String, offset: Int = 0): CatalogSearchPage {
        require(query.trim().length >= 2 && offset >= 0)
        val signer = NostrSignerFactory.create(context, settings)
        if (signer == null) return CatalogSearchPage(search(query), null)
        val response = privateCatalog.request(JSONObject().put("type", "libcat.search")
            .put("query", query.trim()).put("search_type", "all").put("limit", 50).put("offset", offset), signer, service())
        return CatalogSearchPage.parse(response, offset)
    }

    open suspend fun resolveEdition(book: CatalogBook): TorrentEdition {
        val md5 = requireNotNull(book.libvaultMd5)
        val signer = NostrSignerFactory.create(context, settings) ?: error("Connect your signer to download")
        val response = privateCatalog.request(JSONObject().put("type", "libcat.resolve")
            .put("book", JSONObject().put("md5", md5)), signer, service())
        return TorrentEdition.parse(response.getJSONObject("book"), md5)
    }

    suspend fun importVerified(book: CatalogBook, source: File): File = withContext(Dispatchers.IO) {
        require(Regex("[0-9a-f]{32}").matches(book.id))
        require(isValidCachedFile(book, source)) { "Unsupported or invalid publication" }
        val target = publicationFile(book.id, book.format)
        val temporary = File(target.parentFile, target.name + ".importing")
        source.copyTo(temporary, overwrite = true)
        require(temporary.renameTo(target)) { "Could not import publication" }
        rememberDownloadedBook(withEmbeddedRights(book, target))
        target
    }

    suspend fun search(query: String, limit: Int = 20): List<BookSearchResult> =
        withContext(Dispatchers.IO) {
            val normalized = query.trim()
            require(normalized.length >= 2) { "Type at least 2 characters to search" }
            val url = BOOKS_API_BASE.toHttpUrl().newBuilder()
                .addPathSegment("search")
                .addQueryParameter("q", normalized)
                .addQueryParameter("limit", limit.coerceIn(1, 50).toString())
                .build()
            val request = Request.Builder().url(url).get().build()
            client.newCall(request).execute().use { response ->
                require(response.isSuccessful) { "Search failed: HTTP ${response.code}" }
                parseSearchResponse(response.body?.string() ?: "{}", limit)
            }
        }

    suspend fun ensureDownloaded(book: CatalogBook): File = withContext(Dispatchers.IO) {
        val target = publicationFile(book.id, book.format)
        if (target.exists() && isValidCachedFile(book, target)) {
            rememberDownloadedBook(withEmbeddedRights(book, target))
            return@withContext target
        }
        if (target.exists()) target.delete()

        val partial = File(target.parentFile, "${target.name}.part")
        if (partial.exists() && isValidCachedFile(book, partial)) {
            if (!partial.renameTo(target)) {
                partial.copyTo(target, overwrite = true)
                partial.delete()
            }
            rememberDownloadedBook(withEmbeddedRights(book, target))
            return@withContext target
        }
        val partialLength = partial.takeIf(File::isFile)?.length() ?: 0L
        val requestBuilder = Request.Builder().url(book.epubUrl).get()
        val blossomHash = book.blossomSha256
            ?: book.id.takeIf {
                it.matches(Regex("^[a-fA-F0-9]{64}$")) &&
                    book.epubUrl.toHttpUrl().host.equals(BLOSSOM_HOST, ignoreCase = true)
            }
        if (blossomHash != null) {
            val signer = NostrSignerFactory.create(context, settings)
                ?: throw IllegalStateException("Connect the approved Nostr identity to download this LibVault book")
            requestBuilder.header(
                "Authorization",
                BlossomAuth.authorization(signer, blossomHash, book.epubUrl.toHttpUrl().host),
            )
        }
        if (partialLength > 0) requestBuilder.header("Range", "bytes=$partialLength-")

        client.newCall(requestBuilder.build()).execute().use { response ->
            require(response.isSuccessful) {
                "${book.format.extension.uppercase()} download failed: HTTP ${response.code}"
            }
            val append = partialLength > 0 && response.code == 206
            response.body?.byteStream()?.use { input ->
                java.io.FileOutputStream(partial, append).buffered().use { output ->
                    input.copyTo(output)
                }
            } ?: throw IllegalStateException("Empty ${book.format.extension.uppercase()} response")
        }

        require(isValidCachedFile(book, partial)) {
            partial.delete()
            "Downloaded ${book.format.extension.uppercase()} failed verification"
        }
        if (!partial.renameTo(target)) {
            partial.copyTo(target, overwrite = true)
            partial.delete()
        }
        rememberDownloadedBook(withEmbeddedRights(book, target))
        target
    }

    private fun discoverDownloadedBook(
        file: File,
        externalFavorites: List<ExternalFavorite>,
    ): CatalogBook? {
        val format = when (file.extension.lowercase()) {
            "pdf" -> BookFormat.Pdf
            "fb2" -> BookFormat.Fb2
            "cbr" -> BookFormat.Cbr
            "cbz" -> BookFormat.Cbz
            else -> BookFormat.Epub
        }
        val embedded = when (format) {
            BookFormat.Epub -> readEpubMetadata(file)
            BookFormat.Pdf -> readPdfMetadata(file)
            BookFormat.Fb2 -> readFb2Metadata(file)
            BookFormat.Cbr, BookFormat.Cbz -> Triple(null, null, null)
        }
        val matched = embedded.first?.let { title ->
            externalFavorites.firstOrNull {
                it.format.equals(format.extension, ignoreCase = true) &&
                    normalizedTitle(it.title) == normalizedTitle(title)
            }
        }
        val id = file.nameWithoutExtension.lowercase()
        if (!id.matches(Regex("^[a-f0-9]{64}$"))) return null
        val embeddedRights = if (format == BookFormat.Epub) readEpubRights(file) else BookRights()
        val matchedRights = BookRightsMetadata.normalize(
            matched?.rightsStatus, matched?.license, matched?.licenseUrl, matched?.rightsSource,
        )
        val rights = BookRightsMetadata.preferred(matchedRights, embeddedRights)
        return CatalogBook(
            id = id,
            title = matched?.title ?: embedded.first ?: "Downloaded ${format.extension.uppercase()}",
            author = matched?.author ?: embedded.second ?: "Unknown",
            epubUrl = "https://$BLOSSOM_HOST/$id",
            coverUrl = null,
            sourceUrl = matched?.url,
            isbn = matched?.isbn,
            libvaultMd5 = matched?.libvaultMd5,
            format = format,
            blossomSha256 = id,
            year = matched?.year ?: embedded.third,
            rightsStatus = rights.status,
            license = rights.license,
            licenseUrl = rights.licenseUrl,
            rightsSource = rights.source,
        )
    }

    private fun withEmbeddedRights(book: CatalogBook, file: File): CatalogBook {
        if (book.format != BookFormat.Epub) return book
        val current = BookRightsMetadata.normalize(book.rightsStatus, book.license, book.licenseUrl, book.rightsSource)
        val rights = BookRightsMetadata.preferred(current, readEpubRights(file))
        return book.copy(
            rightsStatus = rights.status,
            license = rights.license,
            licenseUrl = rights.licenseUrl,
            rightsSource = rights.source,
        )
    }

    private fun readEpubRights(file: File): BookRights = runCatching {
        ZipFile(file).use { archive ->
            val containerEntry = archive.getEntry("META-INF/container.xml") ?: return@use BookRights()
            val container = archive.getInputStream(containerEntry).bufferedReader().readText()
            val packagePath = Regex("full-path=[\"']([^\"']+)").find(container)?.groupValues?.get(1)
                ?: return@use BookRights()
            val entry = archive.getEntry(packagePath) ?: return@use BookRights()
            val parser = Xml.newPullParser().apply {
                setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
                setInput(archive.getInputStream(entry), null)
            }
            var statement: String? = null
            while (parser.eventType != XmlPullParser.END_DOCUMENT && statement == null) {
                if (parser.eventType == XmlPullParser.START_TAG && parser.name.equals("rights", ignoreCase = true)) {
                    statement = parser.nextText().trim().ifBlank { null }
                }
                parser.next()
            }
            BookRightsMetadata.normalize(license = statement, source = "epub_opf")
        }
    }.getOrDefault(BookRights())

    private fun readEpubMetadata(file: File): Triple<String?, String?, String?> = runCatching {
        ZipFile(file).use { archive ->
            val container = archive.getInputStream(archive.getEntry("META-INF/container.xml")).bufferedReader().readText()
            val packagePath = Regex("full-path=[\"']([^\"']+)").find(container)?.groupValues?.get(1)
                ?: return@use Triple(null, null, null)
            val entry = archive.getEntry(packagePath) ?: return@use Triple(null, null, null)
            val parser = Xml.newPullParser().apply {
                setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
                setInput(archive.getInputStream(entry), null)
            }
            var title: String? = null
            var author: String? = null
            var year: String? = null
            while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                if (parser.eventType == XmlPullParser.START_TAG) {
                    when (parser.name.lowercase()) {
                        "title" -> if (title == null) title = parser.nextText().trim().ifBlank { null }
                        "creator" -> if (author == null) author = parser.nextText().trim().ifBlank { null }
                        "date" -> if (year == null) {
                            year = Regex("\\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\\b")
                                .find(parser.nextText())?.value
                        }
                    }
                }
                parser.next()
            }
            Triple(title, author, year)
        }
    }.getOrDefault(Triple(null, null, null))

    private fun readPdfMetadata(file: File): Triple<String?, String?, String?> = runCatching {
        val bytes = file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            val count = input.read(buffer).coerceAtLeast(0)
            buffer.copyOf(count)
        }
        val text = bytes.toString(Charsets.ISO_8859_1)
        fun field(name: String): String? = Regex("/$name\\s*\\(([^)]{1,300})\\)")
            .find(text)?.groupValues?.get(1)?.replace(Regex("\\s+"), " ")?.trim()?.ifBlank { null }
        val date = field("CreationDate")
        Triple(field("Title"), field("Author"), date?.let { Regex("(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})").find(it)?.value })
    }.getOrDefault(Triple(null, null, null))

    /** Reads only descriptive FB2 fields. The XML parser is non-validating and
     * never resolves external entities; the content is bounded by the caller's
     * structural validation before this method is used for a downloaded file.
     */
    private fun readFb2Metadata(file: File): Triple<String?, String?, String?> = runCatching {
        withFb2Input(file) { input ->
            val parser = Xml.newPullParser().apply {
                setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
                runCatching { setFeature("http://xmlpull.org/v1/doc/features.html#process-docdecl", false) }
                runCatching { setFeature("http://xmlpull.org/v1/doc/features.html#process-namespaces", true) }
                setInput(input, null)
            }
            var title: String? = null
            var author: String? = null
            var year: String? = null
            var firstName: String? = null
            var lastName: String? = null
            while (parser.eventType != XmlPullParser.END_DOCUMENT) {
                if (parser.eventType == XmlPullParser.START_TAG) {
                    when (parser.name.lowercase()) {
                        "book-title" -> if (title == null) title = parser.nextText().trim().ifBlank { null }
                        "first-name" -> if (firstName == null) firstName = parser.nextText().trim().ifBlank { null }
                        "last-name" -> if (lastName == null) lastName = parser.nextText().trim().ifBlank { null }
                        "nickname" -> if (author == null) author = parser.nextText().trim().ifBlank { null }
                        "date" -> if (year == null) year = Regex("\\b(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})\\b")
                            .find(parser.nextText())?.value
                    }
                }
                parser.next()
            }
            if (author == null) author = listOfNotNull(firstName, lastName).joinToString(" ").ifBlank { null }
            Triple(title, author, year)
        }
    }.getOrDefault(Triple(null, null, null))

    @Synchronized private fun rememberDownloadedBook(book: CatalogBook) {
        val existing = loadDownloadedBookMetadata()
        val previous = existing.firstOrNull { it.id == book.id }
        val rights = BookRightsMetadata.preferred(
            BookRightsMetadata.normalize(
                previous?.rightsStatus, previous?.license, previous?.licenseUrl, previous?.rightsSource,
            ),
            BookRightsMetadata.normalize(book.rightsStatus, book.license, book.licenseUrl, book.rightsSource),
        )
        val updated = book.copy(
            rightsStatus = rights.status,
            license = rights.license,
            licenseUrl = rights.licenseUrl,
            rightsSource = rights.source,
        )
        val merged = existing.filterNot { it.id == book.id } + updated
        saveDownloadedBookMetadata(merged)
    }

    private fun loadDownloadedBookMetadata(): List<CatalogBook> {
        val file = File(context.filesDir, DOWNLOADED_BOOKS_CACHE_FILE)
        if (!file.isFile) return emptyList()
        return runCatching { parseDownloadedBookMetadata(file.readText()) }.getOrDefault(emptyList())
    }

    private fun saveDownloadedBookMetadata(books: List<CatalogBook>) {
        val items = JSONArray()
        books.forEach { book ->
            items.put(
                JSONObject()
                    .put("id", book.id)
                    .put("title", book.title)
                    .put("author", book.author)
                    .put("epubUrl", book.epubUrl)
                    .put("coverUrl", book.coverUrl)
                    .put("format", book.format.extension)
                    .put("blossomSha256", book.blossomSha256)
                    .put("year", book.year)
                    .put("language", book.language)
                    .put("sourceUrl", book.sourceUrl)
                    .put("isbn", book.isbn)
                    .put("libvaultMd5", book.libvaultMd5)
                    .put("rights_status", book.rightsStatus)
                    .put("license", book.license)
                    .put("license_url", book.licenseUrl)
                    .put("rights_source", book.rightsSource),
            )
        }
        val target = File(context.filesDir, DOWNLOADED_BOOKS_CACHE_FILE)
        val temporary = File(context.filesDir, "$DOWNLOADED_BOOKS_CACHE_FILE.part")
        temporary.writeText(JSONObject().put("books", items).toString())
        if (!temporary.renameTo(target)) {
            temporary.copyTo(target, overwrite = true)
            temporary.delete()
        }
    }

    private fun normalizedTitle(value: String): String =
        value.lowercase().filter(Char::isLetterOrDigit)

    private fun isValidCachedFile(book: CatalogBook, file: File): Boolean {
        if (!file.isFile || file.length() == 0L) return false
        val expectedSha256 = book.id.lowercase().takeIf { it.matches(Regex("^[a-f0-9]{64}$")) }
        if (expectedSha256 != null && Sha256.hash(file) != expectedSha256) return false
        val signature = file.inputStream().use { input -> ByteArray(5).also { input.read(it) } }
        return when (book.format) {
            BookFormat.Pdf -> signature.decodeToString().startsWith("%PDF-")
            BookFormat.Epub ->
                signature[0] == 'P'.code.toByte() &&
                    signature[1] == 'K'.code.toByte() &&
                    runCatching {
                        ZipFile(file).use { archive -> archive.getEntry("META-INF/container.xml") != null }
                    }.getOrDefault(false)
            BookFormat.Fb2 -> isStructurallyValidFb2(file)
            BookFormat.Cbr -> signature[0] == 0x52.toByte() && signature[1] == 0x61.toByte() && signature[2] == 0x72.toByte() && signature[3] == 0x21.toByte()
            BookFormat.Cbz -> signature[0] == 0x50.toByte() && signature[1] == 0x4b.toByte()
        }
    }

    suspend fun getProgressForBooks(books: List<CatalogBook>): Map<String, BookProgress> {
        val all = progressDao.getAll().associateBy { it.bookId }
        return books.associate { book ->
            book.id to (all[book.id] ?: BookProgress(book.id, 0.0, "", 0L))
        }
    }

    suspend fun getProgress(bookId: String): BookProgress? = progressDao.get(bookId)

    suspend fun saveProgress(bookId: String, progression: Double, cfi: String): BookProgress {
        val existing = progressDao.get(bookId)
        val saved = BookProgress(
                bookId = bookId,
                progression = progression,
                cfi = cfi,
                updatedAt = System.currentTimeMillis(),
                furthestProgression = maxOf(
                    progression,
                    existing?.furthestProgression ?: existing?.progression ?: 0.0,
                ),
        )
        progressDao.upsert(saved)
        return saved
    }

    suspend fun clearProgress(bookId: String) {
        progressDao.upsert(BookProgress(bookId, 0.0, "", System.currentTimeMillis(), 0.0))
    }

    companion object {
        const val BLOSSOM_HOST = "blossom.bfr.ee"
        const val BOOKS_API_BASE = "https://books-api.guaka.org/api"
        private const val DOWNLOADED_BOOKS_CACHE_FILE = "downloaded-books.json"
        const val MAX_FB2_BYTES = 50L * 1024L * 1024L

        /** Public for contract tests and shared by discovery/download validation. */
        internal fun isStructurallyValidFb2(file: File): Boolean {
            if (!file.isFile || file.length() <= 0L || file.length() > MAX_FB2_BYTES) return false
            return runCatching {
                withFb2Input(file) { input ->
                    val parser = SAXParserFactory.newInstance().apply {
                        isNamespaceAware = true
                        listOf(
                            "http://apache.org/xml/features/disallow-doctype-decl" to true,
                            "http://xml.org/sax/features/external-general-entities" to false,
                            "http://xml.org/sax/features/external-parameter-entities" to false,
                            "http://apache.org/xml/features/nonvalidating/load-external-dtd" to false,
                        ).forEach { (feature, enabled) -> runCatching { setFeature(feature, enabled) } }
                    }
                    var rootSeen = false
                    var rootClosed = false
                    var rootDepth = 0
                    var sections = 0
                    var depth = 0
                    val handler = object : DefaultHandler() {
                        private fun nameOf(localName: String?, qName: String?): String =
                            (localName.takeUnless { it.isNullOrBlank() } ?: qName.orEmpty()).substringAfterLast(':')

                        override fun startElement(uri: String?, localName: String?, qName: String?, attributes: Attributes?) {
                            depth++
                            val name = nameOf(localName, qName)
                            if (!rootSeen) {
                                if (!name.equals("FictionBook", ignoreCase = true)) throw SAXException("Expected FictionBook root")
                                rootSeen = true
                                rootDepth = depth
                            } else if (rootClosed) {
                                throw SAXException("Unexpected XML after FictionBook root")
                            } else if (name.equals("section", ignoreCase = true)) {
                                sections++
                            }
                        }

                        override fun endElement(uri: String?, localName: String?, qName: String?) {
                            if (rootSeen && depth == rootDepth && nameOf(localName, qName).equals("FictionBook", ignoreCase = true)) {
                                rootClosed = true
                            }
                            depth--
                        }

                        override fun resolveEntity(publicId: String?, systemId: String?): InputSource? {
                            throw SAXException("External entities are not allowed")
                        }
                    }
                    parser.newSAXParser().parse(XmlSafetyInputStream(BufferedInputStream(input)), handler)
                    rootSeen && rootClosed && sections > 0
                }
            }.getOrDefault(false)
        }

        /** Runs a bounded parser over either native XML or one safe FB2 ZIP entry. */
        /**
         * Opens native FB2 XML or the sole validated entry in an FB2 ZIP.
         *
         * Readers use this after the cache gate has retained the original
         * download, so an accepted `.fb2.zip` is never handed to an XML parser
         * as archive bytes.
         */
        internal fun <T> withFb2Input(file: File, block: (java.io.InputStream) -> T): T {
            val prefix = file.inputStream().use { input -> ByteArray(2).also { input.read(it) } }
            if (prefix.size == 2 && prefix[0] == 'P'.code.toByte() && prefix[1] == 'K'.code.toByte()) {
                ZipFile(file).use { archive ->
                    val entries = archive.entries().toList()
                    val files = entries.filterNot { it.isDirectory }
                    if (entries.size != 1 || files.size != 1) throw IllegalArgumentException("FB2 ZIP must contain exactly one file")
                    val entry = files.single()
                    val name = entry.name.replace('\\', '/')
                    val safe = !name.startsWith('/') && name.split('/').none { it == ".." || it.isBlank() }
                        && name.endsWith(".fb2", ignoreCase = true)
                    if (!safe || entry.size <= 0L || entry.size > MAX_FB2_BYTES) throw IllegalArgumentException("Unsafe FB2 ZIP entry")
                    return block(archive.getInputStream(entry).limit(MAX_FB2_BYTES))
                }
            }
            return block(file.inputStream().limit(MAX_FB2_BYTES))
        }

        /** Rejects DTD/entity declarations even on XML parsers lacking a DTD-disabling feature. */
        private class XmlSafetyInputStream(input: java.io.InputStream) : java.io.FilterInputStream(input) {
            private val prohibited = arrayOf("<!doctype".encodeToByteArray(), "<!entity".encodeToByteArray())
            private val matched = IntArray(prohibited.size)

            override fun read(): Int = super.read().also { if (it >= 0) inspect(it) }

            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                val count = super.read(buffer, offset, length)
                if (count > 0) for (index in offset until offset + count) inspect(buffer[index].toInt() and 0xff)
                return count
            }

            private fun inspect(value: Int) {
                val normalized = if (value in 'A'.code..'Z'.code) value + ('a'.code - 'A'.code) else value
                prohibited.forEachIndexed { index, pattern ->
                    var prefix = matched[index]
                    if (prefix > 0 && pattern[prefix].toInt() != normalized) prefix = 0
                    if (pattern[prefix].toInt() == normalized) prefix++
                    if (prefix == pattern.size) throw IOException("DTD and entity declarations are not allowed")
                    matched[index] = prefix
                }
            }
        }

        private fun java.io.InputStream.limit(maxBytes: Long): java.io.InputStream = object : java.io.FilterInputStream(this) {
            private var remaining = maxBytes
            override fun read(): Int {
                if (remaining <= 0) return -1
                val value = super.read()
                if (value >= 0) remaining--
                return value
            }
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (remaining <= 0) return -1
                val count = super.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
                if (count > 0) remaining -= count
                return count
            }
        }

        private fun parseDownloadedBookMetadata(json: String): List<CatalogBook> {
            val root = JSONObject(json)
            val items: JSONArray = when {
                root.has("books") -> root.getJSONArray("books")
                root.has("items") -> root.getJSONArray("items")
                else -> JSONArray().put(root)
            }

            return buildList {
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    fun scalar(key: String): String? = when (val value = item.opt(key)) {
                        is String -> value.trim().takeIf(String::isNotEmpty)
                        is Number -> value.toString()
                        else -> null
                    }
                    fun text(key: String): String? = (item.opt(key) as? String)
                        ?.trim()
                        ?.takeIf(String::isNotEmpty)

                    val id = scalar("id") ?: scalar("sha256")
                    val epubUrl = text("epubUrl") ?: "".takeIf {
                        text("libvaultMd5")?.matches(Regex("[a-fA-F0-9]{32}")) == true
                    }
                    if (id == null || epubUrl == null) continue
                    val rights = rightsFromJson(item)
                    add(
                        CatalogBook(
                            id = id.lowercase(),
                            title = text("title") ?: "Untitled",
                            author = text("author") ?: "Unknown",
                            epubUrl = epubUrl,
                            coverUrl = text("coverUrl"),
                            sourceUrl = text("sourceUrl"),
                            isbn = text("isbn"),
                            libvaultMd5 = text("libvaultMd5"),
                            format = BookFormat.from(
                                text("format") ?: text("extension") ?: "epub",
                                epubUrl,
                            ),
                            blossomSha256 = text("blossomSha256")
                                ?.takeIf { it.matches(Regex("^[a-fA-F0-9]{64}$")) }
                                ?.lowercase(),
                            year = text("year"),
                            language = text("language"),
                            rightsStatus = rights.status,
                            license = rights.license,
                            licenseUrl = rights.licenseUrl,
                            rightsSource = rights.source,
                        ),
                    )
                }
            }
        }

        fun parseSearchResponse(json: String, limit: Int = 20): List<BookSearchResult> {
            val payload = JSONObject(json)
            val items = payload.optJSONArray("books") ?: payload.optJSONArray("results") ?: JSONArray()
            return buildList {
                for (index in 0 until items.length()) {
                    if (size >= limit.coerceAtLeast(0)) break
                    val item = items.optJSONObject(index) ?: continue
                    val source = item.cleanString("source")?.lowercase() ?: "all.books.party"
                    val nativeId = item.cleanString("id") ?: item.cleanString("source_native_id") ?: continue
                    val explicitUrl = item.cleanString("readUrl") ?: item.cleanString("url")
                        ?: item.cleanString("link")
                    val rawFormat = item.cleanString("extension") ?: item.cleanString("format")
                        ?: if (source == "gutenberg") "epub" else null
                    val format = when (rawFormat?.trim()?.lowercase()) {
                        "epub" -> BookFormat.Epub
                        "pdf" -> BookFormat.Pdf
                        "fb2", "fb2.zip" -> BookFormat.Fb2
                        null -> when {
                            explicitUrl.orEmpty().substringBefore('?').substringBefore('#')
                                .endsWith(".epub", ignoreCase = true) -> BookFormat.Epub
                            explicitUrl.orEmpty().substringBefore('?').substringBefore('#')
                                .endsWith(".pdf", ignoreCase = true) -> BookFormat.Pdf
                            explicitUrl.orEmpty().substringBefore('?').substringBefore('#')
                                .endsWith(".fb2", ignoreCase = true) || explicitUrl.orEmpty()
                                .substringBefore('?').substringBefore('#').endsWith(".fb2.zip", ignoreCase = true) -> BookFormat.Fb2
                            else -> null
                        }
                        else -> null
                    }
                    val downloadUrl = when {
                        explicitUrl != null -> explicitUrl
                        source == "gutenberg" -> "$BOOKS_API_BASE/books/$nativeId/download"
                        else -> null
                    }
                    val coverId = item.cleanString("cover_id")
                    val rights = rightsFromJson(item, source)
                    add(
                        BookSearchResult(
                            id = "$source:$nativeId",
                            source = source,
                            title = item.cleanString("title") ?: "Untitled",
                            author = item.cleanString("author") ?: item.cleanString("authors")
                                ?: "Unknown author",
                            year = item.cleanString("issued")?.substringBefore('-')
                                ?: item.cleanString("year"),
                            publisher = item.cleanString("publisher"),
                            language = item.cleanString("language"),
                            format = format,
                            downloadUrl = downloadUrl,
                            coverUrl = coverId?.let { "https://covers.openlibrary.org/b/id/$it-M.jpg" },
                            rating = item.optDouble("avg_rating", item.optDouble("rating", 0.0)),
                            editionCount = item.optInt("edition_count", 0),
                            rightsStatus = rights.status,
                            license = rights.license,
                            licenseUrl = rights.licenseUrl,
                            rightsSource = rights.source,
                        ),
                    )
                }
            }.sortedByDescending(BookSearchResult::isReadable)
        }

        private fun JSONObject.cleanString(key: String): String? {
            if (!has(key) || isNull(key)) return null
            return optString(key).trim().takeUnless {
                it.isBlank() || it.equals("null", ignoreCase = true) ||
                    it.equals("undefined", ignoreCase = true)
            }
        }

        private fun rightsFromJson(item: JSONObject, provider: String? = null): BookRights {
            val copyright = if (item.has("copyright") && !item.isNull("copyright") && item.opt("copyright") is Boolean) {
                item.optBoolean("copyright")
            } else {
                null
            }
            val evidenceSource = item.cleanString("rights_source") ?: item.cleanString("rightsSource")
                ?: provider?.takeIf {
                    copyright != null || item.cleanString("rights_status") != null ||
                        item.cleanString("license") != null || item.cleanString("rights") != null
                }?.let { if (it == "gutenberg" && copyright != null) "gutendex" else it }
            return BookRightsMetadata.normalize(
                status = item.cleanString("rights_status") ?: item.cleanString("rightsStatus"),
                license = item.cleanString("license") ?: item.cleanString("rights"),
                licenseUrl = item.cleanString("license_url") ?: item.cleanString("licenseUrl"),
                source = evidenceSource,
                copyright = copyright,
            )
        }

        fun fromBlossomFavorite(favorite: ExternalFavorite): CatalogBook? {
            val sha256 = favorite.blossomSha256
                ?.lowercase()
                ?.takeIf { it.matches(Regex("^[a-f0-9]{64}$")) }
                ?: return null
            val blossomUrl = favorite.blossomUrl ?: return null
            val parsedUrl = runCatching { blossomUrl.toHttpUrl() }.getOrNull() ?: return null
            if (!parsedUrl.isHttps || !parsedUrl.host.equals(BLOSSOM_HOST, ignoreCase = true)) return null
            return CatalogBook(
                id = sha256,
                title = favorite.title,
                author = favorite.author ?: "Unknown",
                epubUrl = blossomUrl,
                coverUrl = null,
                isbn = favorite.isbn,
                libvaultMd5 = favorite.libvaultMd5,
                format = BookFormat.from(favorite.format, blossomUrl),
                blossomSha256 = sha256,
                year = favorite.year,
                rightsStatus = favorite.rightsStatus,
                license = favorite.license,
                licenseUrl = favorite.licenseUrl,
                rightsSource = favorite.rightsSource,
            )
        }
    }
}
