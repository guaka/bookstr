package app.bookstr.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.BookstrTestRunner
import app.bookstr.NarrationService
import app.bookstr.ReaderActivity
import app.bookstr.data.ReaderTheme
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ReaderNarrationReadyTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun openingReaderAnswersNarrationRequestMadeBeforeWebViewWasReady() = checkReaderReady(false)

    @Test fun televisionOpeningBookDoesNotAutomaticallyRequestNarrationWhenReaderIsReady() = checkReaderReady(true)

    @Test fun televisionExplicitNarrationRequestStartsWhenReaderIsReady() = checkReaderReady(true, explicitRequest = true)

    @Test fun missingPublicationShowsReaderErrorWithoutStartingNarration() = checkMissingPublication(false)

    @Test fun missingTelevisionPublicationShowsErrorWithoutAutoplay() = checkMissingPublication(true)

    private fun checkMissingPublication(television: Boolean) {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "reader-error-fixture-${System.nanoTime()}"
        val epub = app.catalogRepository.epubFile(bookId)
        epub.delete()
        app.settingsRepository.clearReaderSession()
        val narrationStarted = java.util.concurrent.atomic.AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == bookId &&
                    intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false)
                ) narrationStarted.set(true)
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            if (television) {
                val configuration = Configuration(app.resources.configuration).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_TYPE_MASK.inv()) or Configuration.UI_MODE_TYPE_TELEVISION
                }
                BookstrTestRunner.setActivityConfiguration(ReaderActivity::class.java.name, configuration)
            }
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(app, bookId, "Missing fixture", null, null, null, ReaderTheme.Paper),
            ).use {
                compose.waitUntil(30_000) {
                    compose.onAllNodesWithTag("reader.error").fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithTag("reader.error").assertExists()
                compose.onNodeWithTag("reader.loading").assertDoesNotExist()
                if (television) compose.onNodeWithTag("tv.reader.speech").assertExists()
                else compose.onNodeWithContentDescription("Read aloud").assertExists()
                assertFalse("Opening an unreadable book must not start narration", narrationStarted.get())
            }
        } finally {
            NarrationService.stop(app)
            app.unregisterReceiver(receiver)
            if (television) BookstrTestRunner.clearActivityConfiguration(ReaderActivity::class.java.name)
            app.settingsRepository.clearReaderSession()
            epub.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun checkReaderReady(television: Boolean, explicitRequest: Boolean = false) {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = if (television) UUID.randomUUID().toString().replace("-", "") else "reader-narration-ready-fixture"
        val epub = app.catalogRepository.epubFile(bookId)
        NarrationService.stop(app)
        app.settingsRepository.clearReaderSession()
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
        val observedUiMode = AtomicInteger(Int.MIN_VALUE)
        val narrationEvents = CopyOnWriteArrayList<String>()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) != bookId) return
                narrationEvents += "request=${intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)}, " +
                    "hasText=${intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false)}, " +
                    "active=${intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false)}, " +
                    "message=${intent.getStringExtra(NarrationService.EXTRA_MESSAGE)}"
                if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)) initialRequest.countDown()
                if (intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false)) receivedText.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            if (television) {
                val configuration = Configuration(app.resources.configuration).apply {
                    uiMode = (uiMode and Configuration.UI_MODE_TYPE_MASK.inv()) or Configuration.UI_MODE_TYPE_TELEVISION
                }
                BookstrTestRunner.setActivityConfiguration(ReaderActivity::class.java.name, configuration)
            }
            if (!television) {
                NarrationService.toggle(app, bookId, "Ready fixture", null, null)
                assertTrue("Narration did not request text", initialRequest.await(10, TimeUnit.SECONDS))
            }
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(
                    app,
                    bookId,
                    "Ready fixture",
                    null,
                    null,
                    null,
                    ReaderTheme.Paper,
                    startNarration = explicitRequest,
                ),
            ).use { scenario ->
                if (television) {
                    scenario.onActivity { activity ->
                        observedUiMode.set(activity.resources.configuration.uiMode)
                        assertTrue(
                            "TV reader must receive a television configuration; uiMode=${activity.resources.configuration.uiMode}",
                            (Configuration.UI_MODE_TYPE_MASK and activity.resources.configuration.uiMode) == Configuration.UI_MODE_TYPE_TELEVISION,
                        )
                    }
                    compose.waitUntil(45_000) {
                        compose.onAllNodesWithTag("reader.loading").fetchSemanticsNodes().isEmpty() ||
                            compose.onAllNodesWithTag("reader.error").fetchSemanticsNodes().isNotEmpty()
                    }
                    val readerSnapshot = compose.onRoot().printToString()
                    assertTrue(
                        "Reader did not become ready on TV. uiMode=${observedUiMode.get()}, " +
                            "error=${compose.onAllNodesWithTag("reader.error").fetchSemanticsNodes().isNotEmpty()}\n$readerSnapshot",
                        compose.onAllNodesWithTag("reader.loading").fetchSemanticsNodes().isEmpty(),
                    )
                    assertTrue(
                        "TV reader reported an error. uiMode=${observedUiMode.get()}\n$readerSnapshot",
                        compose.onAllNodesWithTag("reader.error").fetchSemanticsNodes().isEmpty(),
                    )
                    if (explicitRequest) {
                        assertTrue(
                            "Explicit TV narration request was ignored. uiMode=${observedUiMode.get()}, " +
                                "reader=$readerSnapshot, narrationEvents=$narrationEvents",
                            initialRequest.await(45, TimeUnit.SECONDS),
                        )
                    } else {
                        assertFalse(
                            "TV book open must not request narration automatically. uiMode=${observedUiMode.get()}, " +
                                "reader=$readerSnapshot, narrationEvents=$narrationEvents",
                            initialRequest.await(1, TimeUnit.SECONDS),
                        )
                        assertFalse("TV book open must not send narration text", receivedText.await(1, TimeUnit.SECONDS))
                    }
                }
                if (!television || explicitRequest) {
                    assertTrue("Reader did not supply narration text after becoming ready", receivedText.await(45, TimeUnit.SECONDS))
                } else {
                    assertTrue("TV book open emitted narration events: $narrationEvents", narrationEvents.isEmpty())
                }
            }
        } finally {
            NarrationService.stop(app)
            app.unregisterReceiver(receiver)
            if (television) BookstrTestRunner.clearActivityConfiguration(ReaderActivity::class.java.name)
            app.settingsRepository.clearReaderSession()
            epub.delete()
        }
    }
}
