package app.bookstr.data

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfDocument
import androidx.test.core.app.ApplicationProvider
import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class BookCoverRepositoryTest {
    private fun image(color: Int = Color.RED): ByteArray = ByteArrayOutputStream().use { out ->
        val bitmap = Bitmap.createBitmap(1024, 1536, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(color); bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); bitmap.recycle(); out.toByteArray()
    }
    private fun fixture(block: (File, BookCoverRepository) -> Unit) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val root = File(context.cacheDir, "covers-test-${System.nanoTime()}").apply { mkdirs() }
        try { File(root, "books").mkdirs(); block(root, BookCoverRepository(root, File(root, "covers"))) }
        finally { root.deleteRecursively() }
    }
    private fun zip(file: File, entries: Map<String, ByteArray>) {
        ZipOutputStream(file.outputStream()).use { zip -> entries.forEach { (name, data) ->
            zip.putNextEntry(ZipEntry(name)); zip.write(data); zip.closeEntry()
        } }
    }
    @Test fun epubMetadataWinsOverFirstImageAndCachesBoundedThumbnail() = fixture { root, repo ->
        zip(File(root, "books/book.epub"), linkedMapOf(
            "META-INF/container.xml" to "<container><rootfiles><rootfile full-path='OPS/package.opf'/></rootfiles></container>".toByteArray(),
            "OPS/package.opf" to "<package><manifest><item id='front' properties='cover-image' href='images/front%20art.png'/></manifest></package>".toByteArray(),
            "000.png" to image(Color.BLUE), "OPS/images/front art.png" to image()))
        val bitmap = repo.load("book", BookFormat.Epub, null)!!
        assertTrue(bitmap.width <= 256 && bitmap.height <= 384)
        assertEquals(Color.RED, bitmap.getPixel(0, 0))
        assertEquals(Color.RED, repo.load("book", BookFormat.Epub, null)!!.getPixel(0, 0))
        assertTrue(File(root, "covers").listFiles()!!.any { it.extension == "png" })
    }
    @Test fun epub2XhtmlCoverAndComicNaturalOrder() = fixture { root, repo ->
        zip(File(root, "books/old.epub"), linkedMapOf(
            "META-INF/container.xml" to "<container><rootfile full-path='package.opf'/></container>".toByteArray(),
            "package.opf" to "<package><metadata><meta name='cover' content='cover'/></metadata><manifest><item id='cover' href='front.xhtml'/></manifest><guide><reference type='cover' href='front.xhtml'/></guide></package>".toByteArray(),
            "front.xhtml" to "<html><body><img src='art.png'/></body></html>".toByteArray(), "art.png" to image()))
        assertNotNull(repo.load("old", BookFormat.Epub, null))
        zip(File(root, "books/comic.cbz"), linkedMapOf("10.png" to image(Color.BLUE), "2.png" to image()))
        assertEquals(Color.RED, repo.load("comic", BookFormat.Cbz, null)!!.getPixel(0, 0))
    }
    @Test fun pdfFirstPageAndMissingCorruptFilesAreSafe() = fixture { root, repo ->
        val pdf = PdfDocument()
        try {
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(100, 150, 1).create())
            page.canvas.drawColor(Color.BLUE); pdf.finishPage(page)
            File(root, "books/pdf.pdf").outputStream().use { pdf.writeTo(it) }
        } finally { pdf.close() }
        assertEquals(Color.BLUE, repo.load("pdf", BookFormat.Pdf, null)!!.getPixel(0, 0))
        val blockedCache = File(root, "not-a-directory").apply { writeText("keep") }
        assertNotNull(BookCoverRepository(root, blockedCache).load("pdf", BookFormat.Pdf, null))
        File(root, "books/bad.epub").writeText("broken")
        assertNull(repo.load("bad", BookFormat.Epub, null))
        assertNull(repo.load("bad", BookFormat.Epub, null))
        assertNull(repo.load("../outside", null, "file:///etc/passwd"))
        assertNull(repo.load("none", null, null))
        File(root, "books/unsupported.cbr").writeText("Rar!")
        assertNull(repo.load("unsupported", BookFormat.Cbr, null))
        zip(File(root, "books/empty.epub"), mapOf("cover.jpg" to byteArrayOf(1, 2)))
        assertNull(repo.load("empty", BookFormat.Epub, null))
    }
    @Test fun remoteCoverIsCachedForOfflineReuse() = fixture { root, _ ->
        var requests = 0
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requests++
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(image().toResponseBody()).build()
        }.build()
        val repo = BookCoverRepository(root, File(root, "remote-covers"), client)
        assertNotNull(repo.load("remote", null, "https://example.org/cover.png"))
        assertNotNull(repo.load("remote", null, "https://example.org/cover.png"))
        assertEquals(1, requests)
    }
}
