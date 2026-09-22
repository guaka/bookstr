package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import app.bookstr.BookstrApp
import app.bookstr.Fb2ReaderActivity
import app.bookstr.Fb2Parser
import app.bookstr.data.BookFormat
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class Fb2HeaderTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun readingHeaderHasNoBackControlAndSystemBackStillClosesReader() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val id = "header-test-${System.nanoTime()}"
        val file = app.catalogRepository.publicationFile(id, BookFormat.Fb2)
        file.writeText("""<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Header fixture</book-title></title-info></description><body><section><p><emphasis>Local reading content.</emphasis></p></section></body></FictionBook>""")
        org.junit.Assert.assertTrue(Fb2Parser.parse(file).flatSections().any { it.paragraphs.any { p -> p.text.contains("Local reading content.") } })
        try {
            ActivityScenario.launch<Fb2ReaderActivity>(Fb2ReaderActivity.intent(app, id, "Header fixture", null, null)).use { scenario ->
                compose.waitUntil(5000) { compose.onAllNodesWithText("Local reading content.", substring = true).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithContentDescription("Back").assertDoesNotExist()
                compose.onNodeWithContentDescription("Table of contents").assertIsDisplayed()
                UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
                compose.waitUntil(5000) { scenario.state == Lifecycle.State.DESTROYED }
                assertEquals(Lifecycle.State.DESTROYED, scenario.state)
            }
        } finally { file.delete(); runBlocking { app.catalogRepository.clearProgress(id) } }
    }
}
