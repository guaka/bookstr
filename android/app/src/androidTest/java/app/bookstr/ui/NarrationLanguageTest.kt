package app.bookstr.ui

import android.content.Context
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.E2eScreenshotRule
import app.bookstr.NarrationService
import app.bookstr.ReaderActivity
import app.bookstr.data.ReaderTheme
import app.bookstr.speech.SpeechSettings
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class NarrationLanguageTest {
    @get:Rule val compose = createEmptyComposeRule()
    @get:Rule val screenshot = E2eScreenshotRule()

    @Test fun portugueseBookWithWrongMetadataRestoresItsOverride() = checkBook(
        "portuguese-language-fixture", "<dc:language>en</dc:language>",
        "Uma frase portuguesa para testar a leitura.", "pt-pt",
    )

    @Test fun italianBookWithMissingMetadataRestoresItsOverride() = checkBook(
        "italian-language-fixture", "", "Una frase italiana per provare la lettura.", "it",
    )

    private fun checkBook(bookId: String, metadata: String, text: String, language: String) {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setBookLanguage(bookId, null)
        val epub = app.catalogRepository.epubFile(bookId)
        ZipOutputStream(epub.outputStream()).use { zip ->
            fun entry(name: String, value: String) {
                zip.putNextEntry(ZipEntry(name)); zip.write(value.toByteArray()); zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("content.opf", """<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">$bookId</dc:identifier><dc:title>Language fixture</dc:title>$metadata</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            entry("chapter.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Language fixture</title></head><body><p>$text</p></body></html>""")
        }
        fun open() = ActivityScenario.launch<ReaderActivity>(ReaderActivity.intent(
            app, bookId, "Language fixture", null, null, null, ReaderTheme.Paper,
        ))
        fun waitForIsland() = compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("narration.language").fetchSemanticsNodes().isNotEmpty()
        }
        fun pause() {
            if (compose.onAllNodesWithContentDescription("Pause narration").fetchSemanticsNodes().isNotEmpty()) {
                compose.onNodeWithTag("narration.toggle").performClick()
            }
        }
        fun choose(tag: String) {
            compose.onNodeWithTag("narration.language").performClick()
            compose.onNodeWithTag("narration.language.$tag").performScrollTo().performClick()
        }
        try {
            open().use {
                compose.onNodeWithContentDescription("Read aloud").performClick()
                waitForIsland()
                pause()
                compose.onNodeWithTag("narration.language").assertTextEquals("Auto")
                choose(language)
                compose.waitUntil(5_000) { settings.bookLanguage(bookId) == language }
                assertNull(settings.bookLanguage("other-language-fixture"))
                NarrationService.stop(app)
                compose.waitUntil(5_000) { compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isEmpty() }
            }
            open().use {
                compose.onNodeWithContentDescription("Read aloud").performClick()
                waitForIsland()
                pause()
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("narration.language").filter(hasText("Auto")).fetchSemanticsNodes().isEmpty()
                }
                assertEquals(language, settings.bookLanguage(bookId))
                choose("auto")
                compose.waitUntil(5_000) { settings.bookLanguage(bookId) == null }
                compose.onNodeWithTag("narration.language").assertTextEquals("Auto")
            }
        } finally {
            NarrationService.stop(app)
            settings.setBookLanguage(bookId, null)
            epub.delete()
        }
    }
}
