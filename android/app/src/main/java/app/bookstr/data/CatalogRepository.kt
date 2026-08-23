package app.bookstr.data

import android.content.Context
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
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile
import android.util.Xml
import org.xmlpull.v1.XmlPullParser

enum class BookFormat(val extension: String) {
    Epub("epub"),
    Pdf("pdf"),
    ;

    companion object {
        fun from(value: String?, url: String = ""): BookFormat {
            val normalized = value?.trim()?.lowercase()
            if (normalized == "pdf") return Pdf
            if (normalized == "epub") return Epub
            return if (url.substringBefore('?').substringBefore('#').lowercase().endsWith(".pdf")) Pdf else Epub
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
) {
    val isReadable: Boolean get() = !downloadUrl.isNullOrBlank() && format != null

    fun asCatalogBook(): CatalogBook? {
        val url = downloadUrl ?: return null
        val bookFormat = format ?: return null
        return CatalogBook(
            id = id,
            title = title,
            author = author,
            epubUrl = url,
            coverUrl = coverUrl,
            sourceUrl = url,
            format = bookFormat,
            year = year,
        )
    }
}

class CatalogRepository(
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
        withContext(Dispatchers.IO) {
            val cached = loadDownloadedBookMetadata().associateBy { it.id }.toMutableMap()
            val discovered = booksDir().listFiles().orEmpty()
                .filter { it.isFile && it.extension.lowercase() in setOf("epub", "pdf") }
                .mapNotNull { file ->
                    val id = file.nameWithoutExtension.lowercase()
                    cached[id] ?: discoverDownloadedBook(file, externalFavorites)
                }
            val merged = (cached.values + discovered).distinctBy { it.id }
            saveDownloadedBookMetadata(merged)
            merged
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
            rememberDownloadedBook(book)
            return@withContext target
        }
        if (target.exists()) target.delete()

        val partial = File(target.parentFile, "${target.name}.part")
        if (partial.exists() && isValidCachedFile(book, partial)) {
            if (!partial.renameTo(target)) {
                partial.copyTo(target, overwrite = true)
                partial.delete()
            }
            rememberDownloadedBook(book)
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
        rememberDownloadedBook(book)
        target
    }

    private fun discoverDownloadedBook(
        file: File,
        externalFavorites: List<ExternalFavorite>,
    ): CatalogBook? {
        val format = if (file.extension.equals("pdf", ignoreCase = true)) BookFormat.Pdf else BookFormat.Epub
        val embedded = when (format) {
            BookFormat.Epub -> readEpubMetadata(file)
            BookFormat.Pdf -> readPdfMetadata(file)
        }
        val matched = embedded.first?.let { title ->
            externalFavorites.firstOrNull {
                it.format.equals(format.extension, ignoreCase = true) &&
                    normalizedTitle(it.title) == normalizedTitle(title)
            }
        }
        val id = file.nameWithoutExtension.lowercase()
        if (!id.matches(Regex("^[a-f0-9]{64}$"))) return null
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
        )
    }

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

    private fun rememberDownloadedBook(book: CatalogBook) {
        val merged = (loadDownloadedBookMetadata() + book).distinctBy { it.id }
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
                    .put("sourceUrl", book.sourceUrl)
                    .put("isbn", book.isbn)
                    .put("libvaultMd5", book.libvaultMd5),
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
                val id = item.optString("id").ifBlank { item.optString("sha256") }
                val title = item.optString("title", "Untitled")
                val author = item.optString("author", "Unknown")
                val epubUrl = item.optString("epubUrl")
                if (id.isBlank() || epubUrl.isBlank()) continue
                add(
                    CatalogBook(
                        id = id.lowercase(),
                        title = title,
                        author = author,
                        epubUrl = epubUrl,
                        coverUrl = item.optString("coverUrl").takeIf { it.isNotBlank() },
                        sourceUrl = item.optString("sourceUrl").takeIf { it.isNotBlank() },
                        isbn = item.optString("isbn").takeIf { it.isNotBlank() },
                        libvaultMd5 = item.optString("libvaultMd5").takeIf { it.isNotBlank() },
                        format = BookFormat.from(
                            item.optString("format").ifBlank {
                                item.optString("extension").ifBlank { "epub" }
                            },
                            epubUrl,
                        ),
                        blossomSha256 = item.optString("blossomSha256")
                            .takeIf { it.matches(Regex("^[a-fA-F0-9]{64}$")) }
                            ?.lowercase(),
                        year = item.optString("year").takeIf(String::isNotBlank),
                    ),
                )
            }
        }
    }

    companion object {
        const val BLOSSOM_HOST = "blossom.bfr.ee"
        const val BOOKS_API_BASE = "https://books-api.guaka.org/api"
        private const val DOWNLOADED_BOOKS_CACHE_FILE = "downloaded-books.json"

        fun parseSearchResponse(json: String, limit: Int = 20): List<BookSearchResult> {
            val payload = JSONObject(json)
            val items = payload.optJSONArray("books") ?: payload.optJSONArray("results") ?: JSONArray()
            return buildList {
                for (index in 0 until items.length()) {
                    if (size >= limit.coerceAtLeast(0)) break
                    val item = items.optJSONObject(index) ?: continue
                    val source = item.cleanString("source")?.lowercase() ?: "all.books.party"
                    val nativeId = item.cleanString("id") ?: item.cleanString("source_native_id") ?: continue
                    val rawFormat = item.cleanString("extension") ?: item.cleanString("format")
                        ?: if (source == "gutenberg") "epub" else null
                    val format = rawFormat?.let {
                        BookFormat.from(it, item.cleanString("url").orEmpty())
                    }
                    val explicitUrl = item.cleanString("readUrl") ?: item.cleanString("url")
                        ?: item.cleanString("link")
                    val downloadUrl = when {
                        explicitUrl != null -> explicitUrl
                        source == "gutenberg" -> "$BOOKS_API_BASE/books/$nativeId/download"
                        else -> null
                    }
                    val coverId = item.cleanString("cover_id")
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
            )
        }
    }
}
