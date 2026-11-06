package app.bookstr.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import android.app.Activity
import android.app.Application
import android.content.res.Configuration
import android.os.Bundle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.NarrationService
import app.bookstr.ReaderActivity
import app.bookstr.data.ReaderTheme
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ReaderNarrationReadyTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun openingReaderAnswersNarrationRequestMadeBeforeWebViewWasReady() = checkReaderReady(false)

    @Test fun televisionOpeningBookAutomaticallyRequestsNarrationWhenReaderIsReady() = checkReaderReady(true)

    @Test fun missingPublicationShowsReaderErrorWithoutStartingNarration() {
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
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(app, bookId, "Missing fixture", null, null, null, ReaderTheme.Paper),
            ).use {
                compose.waitUntil(30_000) {
                    compose.onAllNodesWithTag("reader.error").fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithTag("reader.error").assertExists()
                compose.onNodeWithTag("reader.loading").assertDoesNotExist()
                compose.onNodeWithContentDescription("Read aloud").assertExists()
                assertFalse("Opening an unreadable book must not start narration", narrationStarted.get())
            }
        } finally {
            NarrationService.stop(app)
            app.unregisterReceiver(receiver)
            app.settingsRepository.clearReaderSession()
            epub.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun checkReaderReady(television: Boolean) {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = if (television) "1234567890abcdef1234567890abcdef" else "reader-narration-ready-fixture"
        val originalConfiguration = Configuration(app.resources.configuration)
        val activityConfigurations = java.util.IdentityHashMap<Activity, Configuration>()
        val televisionConfiguration = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityPreCreated(activity: Activity, state: Bundle?) {
                if (television && activity is ReaderActivity) {
                    activityConfigurations[activity] = Configuration(activity.resources.configuration)
                    val configuration = Configuration(activity.resources.configuration).apply {
                        uiMode = (uiMode and Configuration.UI_MODE_TYPE_MASK.inv()) or Configuration.UI_MODE_TYPE_TELEVISION
                    }
                    activity.resources.updateConfiguration(configuration, activity.resources.displayMetrics)
                }
            }
            override fun onActivityCreated(activity: Activity, state: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {
                activityConfigurations.remove(activity)?.let {
                    activity.resources.updateConfiguration(it, activity.resources.displayMetrics)
                }
            }
        }
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
        app.registerActivityLifecycleCallbacks(televisionConfiguration)
        try {
            if (!television) {
                NarrationService.toggle(app, bookId, "Ready fixture", null, null)
                assertTrue("Narration did not request text", initialRequest.await(10, TimeUnit.SECONDS))
            }
            ActivityScenario.launch<ReaderActivity>(
                ReaderActivity.intent(app, bookId, "Ready fixture", null, null, null, ReaderTheme.Paper),
            ).use {
                if (television) {
                    assertTrue("TV did not automatically request narration", initialRequest.await(45, TimeUnit.SECONDS))
                }
                assertTrue("Reader did not supply narration text after becoming ready", receivedText.await(45, TimeUnit.SECONDS))
            }
        } finally {
            NarrationService.stop(app)
            app.unregisterReceiver(receiver)
            app.unregisterActivityLifecycleCallbacks(televisionConfiguration)
            app.resources.updateConfiguration(originalConfiguration, app.resources.displayMetrics)
            epub.delete()
        }
    }
}
