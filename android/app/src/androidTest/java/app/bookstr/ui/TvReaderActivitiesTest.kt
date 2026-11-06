package app.bookstr.ui

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.pdf.PdfDocument
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.BookstrTestRunner
import app.bookstr.ComicReaderActivity
import app.bookstr.Fb2ReaderActivity
import app.bookstr.MainActivity
import app.bookstr.PdfReaderActivity
import app.bookstr.data.BookFormat
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@OptIn(ExperimentalTestApi::class)
class TvReaderActivitiesTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val app get() = ApplicationProvider.getApplicationContext<BookstrApp>()

    private inline fun <reified T : ComponentActivity> television(intent: Intent, block: (ActivityScenario<T>) -> Unit) {
        val configuration = Configuration(app.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_TYPE_MASK.inv()) or Configuration.UI_MODE_TYPE_TELEVISION
        }
        BookstrTestRunner.setActivityConfiguration(T::class.java.name, configuration)
        try { ActivityScenario.launch<T>(intent).use { scenario ->
            try { block(scenario) } catch (error: Throwable) {
                println(compose.onRoot(useUnmergedTree = true).printToString())
                throw error
            }
        } }
        finally { BookstrTestRunner.clearActivityConfiguration(T::class.java.name) }
    }

    private fun select(tag: String) {
        compose.onNodeWithTag(tag).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus)
        compose.onNodeWithTag(tag).assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter) }
    }

    private fun awaitLibrary() {
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("library.language").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun comicPage(scenario: ActivityScenario<ComicReaderActivity>): String {
        fun find(view: View): WebView? {
            if (view is WebView) return view
            if (view is ViewGroup) for (index in 0 until view.childCount) find(view.getChildAt(index))?.let { return it }
            return null
        }
        val result = AtomicReference("")
        val done = CountDownLatch(1)
        scenario.onActivity { activity ->
            find(activity.findViewById(android.R.id.content))!!.evaluateJavascript(
                "document.querySelector('#stage img')?.naturalWidth ? document.getElementById('count').textContent : ''",
            ) { result.set(it); done.countDown() }
        }
        assertTrue(done.await(5, TimeUnit.SECONDS))
        return result.get()
    }

    @Test fun tvBackFromSearchReturnsToLibrary() {
        app.settingsRepository.clearReaderSession()
        television<MainActivity>(Intent(app, MainActivity::class.java).putExtra(MainActivity.EXTRA_SELECT_TAB, 3)) { scenario ->
            compose.onNodeWithTag("search.query").assertExists()
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            awaitLibrary()
            compose.onNodeWithTag("search.query").assertDoesNotExist()
        }
    }

    @Test fun pdfRemoteTurnsPagesAndPersistsPosition() {
        val id = "tv-pdf-controls"
        val file = app.catalogRepository.publicationFile(id, BookFormat.Pdf)
        val pdf = PdfDocument()
        try {
            repeat(4) { index ->
                val page = pdf.startPage(PdfDocument.PageInfo.Builder(300, 400, index + 1).create())
                page.canvas.drawColor(android.graphics.Color.WHITE)
                pdf.finishPage(page)
            }
            file.outputStream().use(pdf::writeTo)
        } finally { pdf.close() }
        try {
            television<PdfReaderActivity>(PdfReaderActivity.intent(app, id, "TV PDF")) {
                compose.onNodeWithTag("tv.reader.speech").assertDoesNotExist()
                select("tv.reader.next")
                compose.waitUntil(10_000) { runBlocking { app.catalogRepository.getProgress(id) }?.progression?.let { it > 0 } == true }
                val advanced = runBlocking { app.catalogRepository.getProgress(id) }!!.progression
                select("tv.reader.previous")
                compose.waitUntil(10_000) { runBlocking { app.catalogRepository.getProgress(id) }?.progression?.let { it < advanced } == true }
                select("tv.reader.library")
                awaitLibrary()
            }
        } finally { file.delete(); app.settingsRepository.clearReaderSession(); runBlocking { app.catalogRepository.clearProgress(id) } }
    }

    @Test fun fb2RemoteScrollsAndTogglesNarration() {
        val id = "tv-fb2-controls"
        val file = app.catalogRepository.publicationFile(id, BookFormat.Fb2)
        file.writeText("<FictionBook><body><section id=\"chapter\">" +
            (1..80).joinToString("") { "<p>Paragraph $it with enough words to read on television.</p>" } +
            "</section></body></FictionBook>")
        try {
            television<Fb2ReaderActivity>(Fb2ReaderActivity.intent(app, id, "TV FB2", null, null)) {
                compose.waitUntil(10_000) { compose.onAllNodesWithText("Paragraph 1", substring = true).fetchSemanticsNodes().isNotEmpty() }
                select("tv.reader.next")
                compose.waitUntil(10_000) { runBlocking { app.catalogRepository.getProgress(id) }?.progression?.let { it > 0 } == true }
                val advanced = runBlocking { app.catalogRepository.getProgress(id) }!!.progression
                select("tv.reader.previous")
                compose.waitUntil(10_000) { runBlocking { app.catalogRepository.getProgress(id) }?.progression?.let { it < advanced } == true }
                select("tv.reader.speech")
                compose.onNodeWithContentDescription("Pause narration").assertExists()
                select("tv.reader.speech")
                compose.onNodeWithContentDescription("Resume narration").assertExists()
                select("tv.reader.library")
                awaitLibrary()
            }
        } finally {
            file.delete(); app.settingsRepository.clearReaderSession()
            runBlocking { app.catalogRepository.clearProgress(id) }
        }
    }

    @Test fun comicRemoteTurnsPagesAndRestoresSavedPosition() {
        val id = "tv-comic-controls"
        val file = app.catalogRepository.publicationFile(id, BookFormat.Cbz)
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        bitmap.recycle()
        ZipOutputStream(file.outputStream()).use { zip ->
            repeat(3) { zip.putNextEntry(ZipEntry("page-$it.png")); zip.write(png); zip.closeEntry() }
        }
        fun page() = runBlocking { app.catalogRepository.getProgress(id) }?.cfi
        try {
            runBlocking { app.catalogRepository.clearProgress(id) }
            television<ComicReaderActivity>(ComicReaderActivity.intent(app, id, BookFormat.Cbz, "TV comic")) { scenario ->
                compose.waitUntil(30_000) { comicPage(scenario) == "\"1 / 3\"" }
                compose.waitUntil(30_000) { page() == "comic:0:3" }
                select("tv.reader.next")
                compose.waitUntil(10_000) { page() == "comic:1:3" }
                select("tv.reader.previous")
                compose.waitUntil(10_000) { page() == "comic:0:3" }
                select("tv.reader.next")
                compose.waitUntil(10_000) { page() == "comic:1:3" }
            }
            television<ComicReaderActivity>(ComicReaderActivity.intent(app, id, BookFormat.Cbz, "TV comic")) { scenario ->
                compose.waitUntil(30_000) { comicPage(scenario) == "\"2 / 3\"" }
                compose.onNodeWithTag("tv.reader.next").assertIsFocused()
                select("tv.reader.next")
                compose.waitUntil(30_000) { page() == "comic:2:3" }
                select("tv.reader.library")
                awaitLibrary()
            }
        } finally { file.delete(); runBlocking { app.catalogRepository.clearProgress(id) } }
    }
}
