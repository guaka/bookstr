package app.bookstr.ui

import android.content.Intent
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.PdfReaderActivity
import app.bookstr.ReaderActivity
import app.bookstr.data.BookFormat
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OpenBookIntentTest {
    @Test fun viewIntentImportsProviderDocumentsAndOpensBothReaders() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        app.settingsRepository.clearReaderSession()
        val directory = File(app.filesDir, "books").apply { mkdirs() }
        val pdf = File(directory, "External PDF.pdf")
        val document = PdfDocument()
        try {
            val page = document.startPage(PdfDocument.PageInfo.Builder(400, 600, 1).create())
            page.canvas.drawText("External PDF", 40f, 40f, android.graphics.Paint())
            document.finishPage(page)
            pdf.outputStream().use { document.writeTo(it) }
        } finally { document.close() }
        val epub = File(directory, "External EPUB.epub")
        ZipOutputStream(epub.outputStream()).use { zip ->
            for ((name, text) in mapOf(
                "mimetype" to "application/epub+zip",
                "META-INF/container.xml" to """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""",
                "content.opf" to """<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">external</dc:identifier><dc:title>External EPUB</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""",
                "chapter.xhtml" to """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>External EPUB</title></head><body><p>External book contents.</p></body></html>""",
            )) { zip.putNextEntry(ZipEntry(name)); zip.write(text.toByteArray()); zip.closeEntry() }
        }
        try {
            for ((file, mime, reader, format) in listOf(
                Entry(pdf, "application/pdf", PdfReaderActivity::class.java.name, BookFormat.Pdf),
                Entry(epub, "application/epub+zip", ReaderActivity::class.java.name, BookFormat.Epub),
            )) {
                val uri = FileProvider.getUriForFile(app, "${app.packageName}.books", file)
                val expectedId = MessageDigest.getInstance("MD5").digest(file.readBytes())
                    .joinToString("") { "%02x".format(it) }
                val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                    .setClass(app, MainActivity::class.java).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                val monitor = instrumentation.addMonitor(reader, null, false)
                try {
                    ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                        val opened = instrumentation.waitForMonitorWithTimeout(monitor, 20_000)
                        assertNotNull("External file reached its reader", opened)
                        val book = runBlocking { app.catalogRepository.downloadedBooks(emptyList()) }
                            .single { it.id == expectedId && it.format == format }
                        assertEquals(file.nameWithoutExtension, book.title)
                        assertTrue(app.catalogRepository.publicationFile(book.id, format).isFile)
                        instrumentation.runOnMainSync { opened.finish() }
                        instrumentation.waitForIdleSync()
                        // Reusing the foreground main activity must deliver onNewIntent.
                        val warmMonitor = instrumentation.addMonitor(reader, null, false)
                        try {
                            val warm = Intent(intent).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                            scenario.onActivity { it.startActivity(warm) }
                            val reopened = instrumentation.waitForMonitorWithTimeout(warmMonitor, 20_000)
                            assertNotNull("Warm file request reached its reader", reopened)
                            instrumentation.runOnMainSync { reopened.finish() }
                        } finally { instrumentation.removeMonitor(warmMonitor) }
                    }
                } finally { instrumentation.removeMonitor(monitor) }
            }
        } finally { pdf.delete(); epub.delete() }
    }

    private data class Entry(val file: File, val mime: String, val reader: String, val format: BookFormat)
}
