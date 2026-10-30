package app.bookstr.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.NarrationService
import app.bookstr.ReaderActivity
import app.bookstr.data.ReaderTheme
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ReaderNarrationReadyTest {
    @Test fun openingReaderAnswersNarrationRequestMadeBeforeWebViewWasReady() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "reader-narration-ready-fixture"
        val epub = app.catalogRepository.epubFile(bookId)
        ZipOutputStream(epub.outputStream()).use { zip ->
            fun entry(name: String, value: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(value.toByteArray())
                zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("OEBPS/content.opf", """<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">ready-fixture</dc:identifier><dc:title>Ready fixture</dc:title><dc:language>pt-PT</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            entry("OEBPS/chapter.xhtml", """<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Ready fixture</title></head><body><p>Uma frase portuguesa para testar a leitura.</p></body></html>""")
        }
        val initialRequest = CountDownLatch(1)
        val receivedText = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) != bookId) return
                if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)) initialRequest.countDown()
                if (intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false)) receivedText.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            NarrationService.toggle(app, bookId, "Ready fixture", null, null)
            assertTrue("Narration did not request text", initialRequest.await(10, TimeUnit.SECONDS))
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(app, bookId, "Ready fixture", null, null, null, ReaderTheme.Paper),
            ).use {
                assertTrue("Reader did not supply narration text after becoming ready", receivedText.await(45, TimeUnit.SECONDS))
            }
        } finally {
            NarrationService.stop(app)
            app.unregisterReceiver(receiver)
            epub.delete()
        }
    }
}
