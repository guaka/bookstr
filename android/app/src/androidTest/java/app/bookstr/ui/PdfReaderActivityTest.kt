package app.bookstr.ui

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import app.bookstr.BookstrApp
import app.bookstr.PdfReaderActivity
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class PdfReaderActivityTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun validPdfRendersPagesAndPersistsPositionBeforeBackClosesReader() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "pdf-reader-${UUID.randomUUID()}"
        val file = app.catalogRepository.publicationFile(bookId, BookFormat.Pdf)
        // Keep a following page after the destination so page 2 is not clamped at the list end.
        writePdf(file, pageCount = 3)
        val previousTheme = app.settingsRepository.theme
        resetState(app, bookId)

        try {
            ActivityScenario.launch<PdfReaderActivity>(
                PdfReaderActivity.intent(
                    context = app,
                    bookId = bookId,
                    bookTitle = "Fixture PDF",
                    author = "Test Author",
                    year = "2026",
                ),
            ).use { scenario ->
                val activity = AtomicReference<PdfReaderActivity>()
                scenario.onActivity { activity.set(it) }

                compose.waitUntil(15_000) {
                    compose.onAllNodesWithContentDescription("Page 1").fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithText("Fixture PDF").assertIsDisplayed()
                compose.onNodeWithContentDescription("Page 1").assertIsDisplayed()

                val initialSession = app.settingsRepository.readerSession()
                assertNotNull(initialSession)
                assertEquals(bookId, initialSession?.bookId)
                assertEquals(BookFormat.Pdf, initialSession?.format)
                assertEquals(0, initialSession?.pageIndex)

                compose.onNodeWithContentDescription("Page 1").performTouchInput { swipeLeft() }
                val progressDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
                try {
                    compose.waitUntil(15_000) { hasPage("Page 2") }
                } catch (timeout: androidx.compose.ui.test.ComposeTimeoutException) {
                    val progressAfterSwipe = runBlocking { app.catalogRepository.getProgress(bookId) }
                    fail(
                        "PDF swipe did not expose page 2; page1=${hasPage("Page 1")}, " +
                            "page2=${hasPage("Page 2")}, cfi=${progressAfterSwipe?.cfi}, " +
                            "progression=${progressAfterSwipe?.progression}; ${timeout.message}",
                    )
                }
                compose.onNodeWithContentDescription("Page 2").assertIsDisplayed()

                try {
                    val remainingMillis = TimeUnit.NANOSECONDS.toMillis(progressDeadline - System.nanoTime()).coerceAtLeast(1)
                    compose.waitUntil(remainingMillis) {
                        runBlocking { app.catalogRepository.getProgress(bookId)?.cfi?.startsWith("pdf:1:") == true }
                    }
                } catch (timeout: androidx.compose.ui.test.ComposeTimeoutException) {
                    val progressAfterPageChange = runBlocking { app.catalogRepository.getProgress(bookId) }
                    fail(
                        "PDF page 2 is visible but progress was not persisted; " +
                            "page1=${hasPage("Page 1")}, page2=${hasPage("Page 2")}, " +
                            "cfi=${progressAfterPageChange?.cfi}, " +
                            "progression=${progressAfterPageChange?.progression}; ${timeout.message}",
                    )
                }
                val progress = runBlocking { app.catalogRepository.getProgress(bookId) }
                assertNotNull(progress)
                assertTrue(progress!!.progression >= 1.0 / 3.0)

                scenario.moveToState(Lifecycle.State.STARTED)
                assertEquals(1, app.settingsRepository.readerSession()?.pageIndex)
                scenario.moveToState(Lifecycle.State.RESUMED)

                compose.onNodeWithContentDescription("Back").performClick()
                compose.waitUntil(5_000) {
                    activity.get().isFinishing || activity.get().isDestroyed
                }
                // Closing a successfully opened reader keeps the session for resuming later.
                assertEquals(1, app.settingsRepository.readerSession()?.pageIndex)
                assertTrue(runBlocking { app.catalogRepository.getProgress(bookId)?.cfi?.startsWith("pdf:1:") == true })
            }
        } finally {
            file.delete()
            runBlocking { app.catalogRepository.clearProgress(bookId) }
            app.settingsRepository.clearReaderSession()
            app.settingsRepository.theme = previousTheme
        }
    }

    @Test
    fun malformedPdfShowsOpenErrorAndBackLeavesNoReaderSession() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "pdf-malformed-${UUID.randomUUID()}"
        val file = app.catalogRepository.publicationFile(bookId, BookFormat.Pdf)
        file.parentFile?.mkdirs()
        file.writeBytes("%PDF-1.7\nnot a valid document".toByteArray())
        val previousTheme = app.settingsRepository.theme
        resetState(app, bookId)

        try {
            ActivityScenario.launch<PdfReaderActivity>(
                PdfReaderActivity.intent(app, bookId, "Damaged PDF"),
            ).use { scenario ->
                val activity = AtomicReference<PdfReaderActivity>()
                scenario.onActivity { activity.set(it) }

                compose.onNodeWithText("Could not open this PDF").assertIsDisplayed()
                compose.onNodeWithText("Back").performClick()
                compose.waitUntil(5_000) {
                    activity.get().isFinishing || activity.get().isDestroyed
                }
                assertEquals(null, app.settingsRepository.readerSession())
            }
        } finally {
            file.delete()
            runBlocking { app.catalogRepository.clearProgress(bookId) }
            app.settingsRepository.clearReaderSession()
            app.settingsRepository.theme = previousTheme
        }
    }

    private fun resetState(app: BookstrApp, bookId: String) {
        app.settingsRepository.disconnectNostr()
        app.settingsRepository.clearReaderSession()
        app.settingsRepository.theme = ReaderTheme.White
        runBlocking { app.catalogRepository.clearProgress(bookId) }
    }

    private fun hasPage(description: String): Boolean =
        compose.onAllNodesWithContentDescription(description).fetchSemanticsNodes().isNotEmpty()

    private fun writePdf(file: File, pageCount: Int) {
        file.parentFile?.mkdirs()
        val document = android.graphics.pdf.PdfDocument()
        try {
            repeat(pageCount) { index ->
                val page = document.startPage(
                    android.graphics.pdf.PdfDocument.PageInfo.Builder(300, 500, index + 1).create(),
                )
                page.canvas.drawText("Fixture page ${index + 1}", 20f, 40f, android.graphics.Paint())
                document.finishPage(page)
            }
            ByteArrayOutputStream().use { output ->
                document.writeTo(output)
                file.writeBytes(output.toByteArray())
            }
        } finally {
            document.close()
        }
    }
}
