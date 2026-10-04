package app.bookstr.ui

import android.app.Activity
import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.NarrationService
import app.bookstr.PdfReaderActivity
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NarrationIslandOpenBookTest {
    private val compose = createEmptyComposeRule()
    private lateinit var app: BookstrApp
    private val pdf = ByteArrayOutputStream().also { output ->
        val document = android.graphics.pdf.PdfDocument()
        try {
            val page = document.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(72, 72, 1).create())
            page.canvas.drawText(UUID.randomUUID().toString(), 2f, 20f, android.graphics.Paint())
            document.finishPage(page)
            document.writeTo(output)
        } finally {
            document.close()
        }
    }.toByteArray()
    private val downloadedId = MessageDigest.getInstance("SHA-256").digest(pdf)
        .joinToString("") { "%02x".format(it) }
    private val files = mutableListOf<File>()
    private val setup = object : ExternalResource() {
        override fun before() {
            app = ApplicationProvider.getApplicationContext()
            app.settingsRepository.disconnectNostr()
            app.settingsRepository.clearReaderSession()
            NarrationService.stop(app)
            val downloaded = app.catalogRepository.publicationFile(downloadedId, BookFormat.Pdf)
            downloaded.parentFile?.mkdirs()
            downloaded.writeBytes(pdf)
            files += downloaded
        }

        override fun after() {
            NarrationService.stop(app)
            app.settingsRepository.clearReaderSession()
            files.forEach(File::delete)
        }
    }

    @get:Rule val rules: RuleChain = RuleChain.outerRule(setup).around(compose)

    @Test fun narrationIslandOpensAnAlreadyDownloadedBook() {
        openFromIsland(downloadedId, "Downloaded PDF")
    }

    @Test fun narrationIslandUsesTheSavedReaderSessionWhenBookIsNotInLibrary() {
        val fallbackId = "reader-session-${UUID.randomUUID()}"
        app.catalogRepository.publicationFile(fallbackId, BookFormat.Pdf).apply {
            parentFile?.mkdirs()
            writeBytes(pdf)
            files += this
        }
        app.settingsRepository.saveReaderSession(
            ReaderSession(
                bookId = fallbackId,
                bookTitle = "Saved PDF session",
                format = BookFormat.Pdf,
                author = "Saved author",
                year = "2024",
                pageIndex = 0,
            ),
        )
        openFromIsland(fallbackId, "Saved PDF session")
    }

    private fun openFromIsland(bookId: String, title: String) {
        val context = ApplicationProvider.getApplicationContext<BookstrApp>()
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_SELECT_TAB, 0)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = instrumentation.addMonitor(PdfReaderActivity::class.java.name, null, false)
        try {
            ActivityScenario.launch<MainActivity>(intent).use { scenario ->
                if (bookId == downloadedId) {
                    compose.waitUntil(10_000) {
                        compose.onAllNodesWithTag("library.swipe.$bookId").fetchSemanticsNodes().isNotEmpty()
                    }
                } else {
                    compose.onNodeWithTag("library.swipe.$bookId").assertDoesNotExist()
                }
                scenario.onActivity { activity ->
                    NarrationService.toggle(activity, bookId, title, "Fixture author", null)
                }
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isNotEmpty()
                }
                instrumentation.waitForIdleSync()
                compose.onNodeWithTag("narration.openBook").performClick()
                val opened: Activity? = instrumentation.waitForMonitorWithTimeout(monitor, 10_000)
                assertNotNull("Narration island did not open the PDF reader", opened)
                instrumentation.runOnMainSync { opened?.finish() }
                scenario.onActivity { it.finish() }
            }
        } finally {
            instrumentation.removeMonitor(monitor)
            NarrationService.stop(context)
        }
    }
}
