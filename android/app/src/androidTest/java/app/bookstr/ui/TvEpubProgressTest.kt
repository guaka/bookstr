package app.bookstr.ui

import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.BookstrTestRunner
import app.bookstr.ReaderActivity
import app.bookstr.readerSessionRestoreIntent
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import app.bookstr.data.ReaderTheme
import kotlinx.coroutines.runBlocking
import org.json.JSONTokener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@OptIn(ExperimentalTestApi::class)
class TvEpubProgressTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val app get() = ApplicationProvider.getApplicationContext<BookstrApp>()

    @Test fun tvEpubProgressSurvivesReaderReopen() {
        val bookId = "tv-epub-progress-reopen"
        val epub = app.catalogRepository.epubFile(bookId)
        ZipOutputStream(epub.outputStream()).use { zip ->
            fun entry(name: String, value: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(value.toByteArray())
                zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("OEBPS/content.opf", """<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">tv-progress</dc:identifier><dc:title>TV progress fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            val paragraphs = (1..80).joinToString("") { "<p>Reading progress paragraph $it. ${"A longer sentence keeps the reader paginated. ".repeat(5)}</p>" }
            entry("OEBPS/chapter.xhtml", """<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>TV progress fixture</title></head><body>$paragraphs</body></html>""")
        }

        runBlocking { app.catalogRepository.clearProgress(bookId) }
        val configuration = Configuration(app.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_TYPE_MASK.inv()) or Configuration.UI_MODE_TYPE_TELEVISION
        }
        BookstrTestRunner.setActivityConfiguration(ReaderActivity::class.java.name, configuration)
        try {
            var initialCfi = ""
            ActivityScenario.launch<ReaderActivity>(readerIntent(bookId)).use { scenario ->
                waitForReaderLocation(scenario)
                initialCfi = readerLocation(scenario)
                assertEquals("\"function\"", evaluate(scenario, "typeof window.nextPage"))
                repeat(3) { evaluate(scenario, "window.nextPage();") }
                compose.waitUntil(15_000) {
                    val saved = runBlocking { app.catalogRepository.getProgress(bookId) }
                    saved?.cfi?.isNotBlank() == true && saved.cfi != initialCfi
                }
            }

            val savedCfi = runBlocking { app.catalogRepository.getProgress(bookId)!!.cfi }
            app.settingsRepository.saveReaderSession(
                ReaderSession(bookId, "TV progress fixture", BookFormat.Epub, locator = initialCfi),
            )
            val restoredIntent = runBlocking {
                readerSessionRestoreIntent(
                    app,
                    app.settingsRepository.readerSession()!!,
                    ReaderTheme.Paper,
                    app.catalogRepository,
                )
            }
            ActivityScenario.launch<ReaderActivity>(restoredIntent).use { scenario ->
                compose.waitUntil(45_000) { readerLocation(scenario) == savedCfi }
                assertEquals("TV resume must reopen at the exact current DB CFI", savedCfi, readerLocation(scenario))
            }
        } finally {
            BookstrTestRunner.clearActivityConfiguration(ReaderActivity::class.java.name)
            epub.delete()
            app.settingsRepository.clearReaderSession()
            runBlocking { app.catalogRepository.clearProgress(bookId) }
        }
    }

    private fun readerIntent(bookId: String, cfi: String? = null) = ReaderActivity.intent(
        app, bookId, "TV progress fixture", null, null, cfi, ReaderTheme.Paper,
    )

    private fun waitForReaderLocation(scenario: ActivityScenario<ReaderActivity>) {
        compose.waitUntil(45_000) {
            runCatching { readerLocation(scenario).isNotBlank() }.getOrDefault(false)
        }
    }

    private fun readerLocation(scenario: ActivityScenario<ReaderActivity>): String = evaluate(
        scenario,
        "rendition && rendition.currentLocation && rendition.currentLocation()?.start?.cfi || ''",
    ).let { value -> runCatching { JSONTokener(value).nextValue() as? String }.getOrNull().orEmpty() }

    private fun evaluate(scenario: ActivityScenario<ReaderActivity>, script: String): String {
        val value = AtomicReference("")
        val completed = CountDownLatch(1)
        scenario.onActivity { activity ->
            findWebView(activity.findViewById(android.R.id.content))?.evaluateJavascript(script) {
                value.set(it ?: "")
                completed.countDown()
            } ?: completed.countDown()
        }
        assertTrue("WebView script did not complete", completed.await(5, TimeUnit.SECONDS))
        return value.get()
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
        }
        return null
    }
}
