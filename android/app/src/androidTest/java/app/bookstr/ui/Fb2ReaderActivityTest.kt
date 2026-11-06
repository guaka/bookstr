package app.bookstr.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.Fb2ReaderActivity
import app.bookstr.data.BookFormat
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class Fb2ReaderActivityTest {
    private val compose = createEmptyComposeRule()
    private lateinit var app: BookstrApp
    private val files = mutableListOf<File>()
    private val bookId = UUID.randomUUID().toString().replace("-", "")
    private val setup = object : ExternalResource() {
        override fun before() {
            app = ApplicationProvider.getApplicationContext()
            app.settingsRepository.disconnectNostr()
            app.settingsRepository.clearReaderSession()
        }

        override fun after() {
            app.settingsRepository.clearReaderSession()
            files.forEach(File::delete)
            runBlocking { app.catalogRepository.clearProgress(bookId) }
        }
    }

    @get:Rule val rules: RuleChain = RuleChain.outerRule(setup).around(compose)

    @Test
    fun opensFb2ContentNavigatesByContentsPersistsLocationAndCloses() {
        val file = writeBook(validBook)
        runBlocking { app.catalogRepository.clearProgress(bookId) }

        ActivityScenario.launch<Fb2ReaderActivity>(
            Fb2ReaderActivity.intent(
                app, bookId, "FB2 reader fixture", "Test author", "2026",
                rightsStatus = "open_license", license = "CC BY 4.0",
            ),
        ).use { scenario ->
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("First chapter paragraph 1 with enough text to fill the reader and scroll.")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("FB2 reader fixture").assertIsDisplayed()
            compose.onNodeWithText("First chapter paragraph 1 with enough text to fill the reader and scroll.").assertIsDisplayed()

            compose.onNodeWithContentDescription("Table of contents").performClick()
            compose.onNodeWithText("Contents").assertIsDisplayed()
            compose.onNodeWithTag("fb2.contents.section.chapter-two").performClick()
            compose.waitUntil(10_000) {
                runBlocking { app.catalogRepository.getProgress(bookId) }
                    ?.cfi?.startsWith("fb2:chapter-two:") == true
            }
            compose.onNodeWithText("Second chapter destination", substring = true).assertIsDisplayed()
            assertEquals(BookFormat.Fb2, app.settingsRepository.readerSession()?.format)

            compose.onNodeWithContentDescription("Back").performClick()
            compose.waitUntil(5_000) { scenario.state == Lifecycle.State.DESTROYED }
        }
    }

    @Test
    fun invalidFb2ShowsAReaderErrorAndStillAllowsBackNavigation() {
        writeBook("<not-a-fiction-book/>")

        ActivityScenario.launch<Fb2ReaderActivity>(
            Fb2ReaderActivity.intent(app, bookId, "Broken FB2 fixture", null, null),
        ).use { scenario ->
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Not a FictionBook document")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Not a FictionBook document").assertIsDisplayed()
            compose.onNodeWithContentDescription("Back").performClick()
            compose.waitUntil(5_000) { scenario.state == Lifecycle.State.DESTROYED }
        }
    }

    @Test
    fun blankParentContentsEntryDismissesWithoutChangingChildProgress() {
        writeBook(buildString {
            append("<FictionBook><body><section id='empty-parent'><section id='child'>")
            append("<title><p>Child chapter</p></title>")
            repeat(20) { index -> append("<p>Child paragraph ${index + 1} remains readable while the empty parent entry has no reader location.</p>") }
            append("</section></section></body></FictionBook>")
        })

        ActivityScenario.launch<Fb2ReaderActivity>(
            Fb2ReaderActivity.intent(app, bookId, "FB2 empty section fixture", null, null),
        ).use {
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Child paragraph 1 remains readable while the empty parent entry has no reader location.")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            var initialLocator: String? = null
            compose.waitUntil(10_000) {
                initialLocator = runBlocking { app.catalogRepository.getProgress(bookId)?.cfi }
                initialLocator?.startsWith("fb2:child:") == true
            }
            val savedLocator = requireNotNull(initialLocator)

            compose.onNodeWithContentDescription("Table of contents").performClick()
            compose.onNodeWithText("Contents").assertIsDisplayed()
            compose.onNodeWithText("Section 1").assertIsDisplayed()
            compose.onNodeWithTag("fb2.contents.section.empty-parent").performClick()
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Contents").fetchSemanticsNodes().isEmpty()
            }

            compose.onNodeWithText("Child chapter").assertIsDisplayed()
            compose.onNodeWithText("Child paragraph 1 remains readable while the empty parent entry has no reader location.")
                .assertIsDisplayed()
            assertEquals(savedLocator, runBlocking { app.catalogRepository.getProgress(bookId)?.cfi })
        }
    }

    private fun writeBook(xml: String): File = app.catalogRepository.publicationFile(bookId, BookFormat.Fb2).also {
        it.parentFile?.mkdirs()
        it.writeText(xml)
        files += it
    }

    private companion object {
        val validBook = buildString {
            append("<FictionBook><description><title-info><book-title>Fixture</book-title></title-info></description><body>")
            append("<section id='chapter-one'><title><p>Chapter One</p></title>")
            repeat(14) { index -> append("<p>First chapter paragraph ${index + 1} with enough text to fill the reader and scroll.</p>") }
            append("</section><section id='chapter-two'><title><p>Chapter Two</p></title>")
            append("<p>Second chapter destination is the location selected from the contents list.</p>")
            repeat(20) { index ->
                append("<p>Second chapter continuation ${index + 1} has enough text to fill the reader viewport after navigating from the contents list.</p>")
            }
            append("</section></body></FictionBook>")
        }
    }
}
