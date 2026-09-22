package app.bookstr.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import okhttp3.OkHttpClient
import okhttp3.Request
import org.w3c.dom.Element
import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory

/** Thumbnail-only cache: never edits publications or library/download metadata. Call off the UI thread. */
class BookCoverRepository(private val files: File, private val cache: File, private val client: OkHttpClient = sharedClient) {

    fun load(id: String, format: BookFormat?, remote: String?): Bitmap? {
        val publication = if (id.matches(Regex("[a-zA-Z0-9_-]+")) && format != null)
            File(files, "books/$id.${format.extension}").takeIf { it.isFile } else null
        val source = "$id|$format|${publication?.lastModified()}|${publication?.length()}|$remote"
        val key = MessageDigest.getInstance("SHA-256").digest(source.toByteArray()).joinToString("") { "%02x".format(it) }
        cache.mkdirs()
        val target = File(cache, "$key.png")
        decodeFile(target)?.let { return it }
        val missing = File(cache, "$key.none")
        if (missing.exists()) return null
        val embedded = publication?.let { file -> runCatching {
            when (format) {
                BookFormat.Epub, BookFormat.Cbz -> archiveCover(file, format == BookFormat.Epub)
                BookFormat.Pdf -> pdfCover(file)
                else -> null
            }
        }.getOrNull() }
        val image = embedded ?: remote?.takeIf { it.startsWith("https://") || it.startsWith("http://") }?.let { url ->
            runCatching {
                client.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (!response.isSuccessful) null else response.body?.byteStream()?.use { decode(bounded(it, MAX_IMAGE)) }
                }
            }.getOrNull()
        }
        if (image != null) runCatching {
            val temporary = File.createTempFile(key, ".tmp", cache)
            try {
                temporary.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
                temporary.renameTo(target)
            } finally { temporary.delete() }
        } else if (publication != null && remote.isNullOrBlank()) runCatching { missing.writeText("") }
        return image
    }

    private fun decodeFile(file: File) = if (file.isFile) runCatching { file.inputStream().use { decode(bounded(it, MAX_IMAGE)) } }.getOrNull() else null

    private fun archiveCover(file: File, epub: Boolean): Bitmap? = ZipFile(file).use { zip ->
        val names = zip.entries().asSequence().filterNot { it.isDirectory }.map { it.name }.toList()
        val candidates = linkedSetOf<String>()
        fun xml(path: String): Element? = zip.getEntry(path)?.let { entry ->
            zip.getInputStream(entry).use { input ->
                val bytes = bounded(input, 1024 * 1024)
                val text = bytes.toString(Charsets.UTF_8).replace("\u0000", "")
                require(!text.contains("<!DOCTYPE", true) && !text.contains("<!ENTITY", true))
                val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
                factory.newDocumentBuilder().apply {
                    setEntityResolver { _, _ -> throw org.xml.sax.SAXException("External entities are disabled") }
                }.parse(bytes.inputStream()).documentElement
            }
        }
        if (epub) runCatching {
            val container = xml("META-INF/container.xml")
            val opf = (container?.getElementsByTagNameNS("*", "rootfile")?.item(0) as? Element)?.getAttribute("full-path")
            if (!opf.isNullOrBlank()) {
                val root = xml(opf)
                val meta = root?.getElementsByTagNameNS("*", "meta")
                val coverId = (0 until (meta?.length ?: 0)).map { meta!!.item(it) as Element }
                    .firstOrNull { it.getAttribute("name") == "cover" }?.getAttribute("content")
                val items = root?.getElementsByTagNameNS("*", "item")
                val manifest = (0 until (items?.length ?: 0)).map { items!!.item(it) as Element }
                manifest.filter { it.getAttribute("properties").split(' ').contains("cover-image") || it.getAttribute("id") == coverId }
                    .forEach { candidates += resolve(opf, it.getAttribute("href")) }
                val guide = root?.getElementsByTagNameNS("*", "reference")
                (0 until (guide?.length ?: 0)).map { guide!!.item(it) as Element }
                    .filter { it.getAttribute("type") == "cover" }.forEach { candidates += resolve(opf, it.getAttribute("href")) }
                for (path in candidates.toList()) if (path.endsWith("html", true)) {
                    val images = xml(path)?.getElementsByTagNameNS("*", "img")
                    for (i in 0 until (images?.length ?: 0)) candidates += resolve(path, (images!!.item(i) as Element).getAttribute("src"))
                }
            }
        }
        val images = names.filter { it.substringAfterLast('.').lowercase() in setOf("jpg", "jpeg", "png", "webp") }
            .sortedBy { name -> Regex("\\d+").replace(name.lowercase()) { it.value.padStart(12, '0') } }
        candidates += images.filter { it.substringAfterLast('/').startsWith("cover", true) }
        candidates += images
        candidates.take(24).firstNotNullOfOrNull { name ->
            zip.getEntry(name)?.takeIf { it.size <= MAX_IMAGE }?.let { entry ->
                runCatching { zip.getInputStream(entry).use { decode(bounded(it, MAX_IMAGE)) } }.getOrNull()
            }
        }
    }

    private fun pdfCover(file: File): Bitmap? = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
            if (renderer.pageCount == 0) null else renderer.openPage(0).use { page ->
                val scale = minOf(256f / page.width, 384f / page.height)
                Bitmap.createBitmap((page.width * scale).toInt().coerceAtLeast(1), (page.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(android.graphics.Color.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply { inSampleSize = 1 }
        while (bounds.outWidth / options.inSampleSize > 512 || bounds.outHeight / options.inSampleSize > 768) options.inSampleSize *= 2
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        val scale = minOf(1f, 256f / bitmap.width, 384f / bitmap.height)
        if (scale == 1f) return bitmap
        return Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true).also { if (it !== bitmap) bitmap.recycle() }
    }

    private fun resolve(base: String, href: String): String = URI(null, null, base, null).resolve(href.replace(" ", "%20")).normalize().path
    private fun bounded(input: InputStream, limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer, 0, minOf(buffer.size, limit + 1 - output.size()))
            if (count < 0) return output.toByteArray()
            output.write(buffer, 0, count)
            require(output.size() <= limit)
        }
    }
    companion object {
        private const val MAX_IMAGE = 8 * 1024 * 1024
        private val sharedClient = OkHttpClient.Builder().callTimeout(12, TimeUnit.SECONDS).build()
    }
}
