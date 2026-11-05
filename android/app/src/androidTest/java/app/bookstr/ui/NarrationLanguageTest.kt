package app.bookstr.ui

import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.semantics.SemanticsActions
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
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicBoolean

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

    private fun checkBook(baseBookId: String, metadata: String, text: String, language: String) {
        val bookId = "$baseBookId-${System.nanoTime()}"
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val previousRate = settings.rate(language)
        val englishRate = settings.rate("en")
        settings.setRate(language, 0.55f)
        settings.setBookLanguage(bookId, null)
        val playbackLanguage = AtomicReference<String>()
        val inactive = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == bookId) {
                    inactive.set(!intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false))
                    if (intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false)) {
                        playbackLanguage.set(intent.getStringExtra(NarrationService.EXTRA_LANGUAGE))
                    }
                }
            }
        }
        ContextCompat.registerReceiver(app, receiver, IntentFilter(NarrationService.ACTION_EVENT), ContextCompat.RECEIVER_NOT_EXPORTED)
        val epub = app.catalogRepository.epubFile(bookId)
        ZipOutputStream(epub.outputStream()).use { zip ->
            fun entry(name: String, value: String) {
                zip.putNextEntry(ZipEntry(name)); zip.write(value.toByteArray()); zip.closeEntry()
            }
            entry("mimetype", "application/epub+zip")
            entry("META-INF/container.xml", """<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("content.opf", """<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">$bookId</dc:identifier><dc:title>Language fixture</dc:title>$metadata</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""")
            entry("chapter.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Language fixture</title></head><body>${("<p>$text</p>").repeat(30)}</body></html>""")
        }
        fun open() = ActivityScenario.launch<ReaderActivity>(ReaderActivity.intent(
            app, bookId, "Language fixture", null, null, null, ReaderTheme.Paper,
        ))
        fun waitForIsland() {
            compose.waitUntil(15_000) {
                compose.onAllNodesWithTag("narration.language").fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(45_000) { playbackLanguage.get() != null }
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
                compose.onNodeWithTag("narration.language").performClick()
                androidx.test.espresso.Espresso.pressBack()
                assertNull(settings.bookLanguage(bookId))
                choose(language)
                compose.waitUntil(5_000) { settings.bookLanguage(bookId) == language }
                compose.waitUntil(15_000) { playbackLanguage.get() == language }
                compose.onNodeWithTag("narration.speed").performSemanticsAction(SemanticsActions.SetProgress) { it(0.40f) }
                compose.waitUntil(5_000) { settings.rate(language) < 0.55f }
                assertEquals(englishRate, settings.rate("en"), 0.0001f)
                assertNull(settings.bookLanguage("other-language-fixture"))
                compose.runOnIdle { NarrationService.stop(app) }
                compose.waitUntil(5_000) { compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isEmpty() }
            }
            playbackLanguage.set(null)
            open().use {
                compose.onNodeWithContentDescription("Read aloud").performClick()
                waitForIsland()
                pause()
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("narration.language").filter(hasText("Auto")).fetchSemanticsNodes().isEmpty()
                }
                assertEquals(language, settings.bookLanguage(bookId))
                compose.waitUntil(15_000) { playbackLanguage.get() == language }
                choose("auto")
                compose.waitUntil(5_000) { settings.bookLanguage(bookId) == null }
                compose.waitUntil(5_000) { playbackLanguage.get() == "en" }
                compose.onNodeWithTag("narration.language").assertTextEquals("Auto")
            }
        } finally {
            compose.runOnIdle { NarrationService.stop(app) }
            compose.waitUntil(5_000) { inactive.get() }
            app.unregisterReceiver(receiver)
            settings.setBookLanguage(bookId, null)
            settings.setRate(language, previousRate)
            app.settingsRepository.clearReaderSession()
            epub.delete()
        }
    }
}
