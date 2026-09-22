package app.bookstr.ui

import androidx.compose.ui.unit.dp
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import app.bookstr.ReaderChrome
import app.bookstr.PdfReaderChrome
import app.bookstr.data.*
import app.bookstr.download.DownloadJob
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class CompactControlsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun hidesEmptyAndSingleChoiceFacetsIndependently() {
        val languages = mutableStateOf(emptyList<String>())
        val formats = mutableStateOf(emptyList<String>())
        val language = mutableStateOf("")
        val format = mutableStateOf("")
        compose.setContent { BookFilterBar("fixture", languages.value, formats.value, language.value, format.value,
            { language.value = it }, { format.value = it }) }
        compose.onNodeWithTag("fixture.language").assertDoesNotExist()
        compose.onNodeWithTag("fixture.format").assertDoesNotExist()
        compose.runOnIdle { languages.value = listOf("en"); formats.value = listOf("epub") }
        compose.onNodeWithTag("fixture.language").assertDoesNotExist()
        compose.onNodeWithTag("fixture.format").assertDoesNotExist()
        compose.runOnIdle { languages.value = listOf("en", "pt") }
        compose.onNodeWithTag("fixture.language").assertIsDisplayed()
        compose.onNodeWithTag("fixture.format").assertDoesNotExist()
        compose.runOnIdle { formats.value = listOf("epub", "pdf") }
        compose.onNodeWithTag("fixture.format").performClick()
        compose.onNodeWithTag("fixture.format.pdf").performClick()
        compose.onNodeWithTag("fixture.language").performClick()
        compose.onNodeWithTag("fixture.language.pt").performClick()
        assertEquals("pt", language.value)
        assertEquals("pdf", format.value)
        compose.onNodeWithTag("fixture.language").performClick()
        compose.onNodeWithTag("fixture.language.all").performClick()
        compose.onNodeWithTag("fixture.format").performClick()
        androidx.test.uiautomator.UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.onNodeWithTag("fixture.format.all").assertDoesNotExist()
    }

    @Test fun undefinedLanguageHasReadableLabelInMenuAndSelection() {
        val selected = mutableStateOf("")
        compose.setContent { BookFilterBar("fixture", listOf("en", "und"), emptyList(), selected.value, "", { selected.value = it }, {}) }
        compose.onNodeWithTag("fixture.language").performClick()
        compose.onNodeWithTag("fixture.language.und").assertTextEquals("undefined").performClick()
        compose.onNodeWithTag("fixture.language").assertTextEquals("undefined")
    }

    @Test fun searchFiltersAppearOnlyForMultipleChoicesAndApplyToResults() {
        val english = BookSearchResult("en", "public", "English EPUB", "Author", language = "en", format = BookFormat.Epub,
            downloadUrl = "https://example.org/en.epub")
        val portuguese = english.copy(id = "pt", title = "Portuguese PDF", language = "pt", format = BookFormat.Pdf)
        val results = mutableStateOf(listOf(english, portuguese))
        compose.setContent { SearchScreen(query = "books", results = results.value, searching = false, openingBookId = null,
            message = "No value for torrent", isFavorite = { false }, readingProgress = { null }, onQueryChange = {}, onSearch = {}, onOpen = {}, onToggleFavorite = {}) }
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithText("No value for torrent").assertDoesNotExist()
        compose.onNodeWithContentDescription("Downloads").assertIsDisplayed()
        compose.onNodeWithTag("search.language").performClick()
        compose.onNodeWithTag("search.language.pt").performClick()
        compose.onNodeWithText("English EPUB").assertDoesNotExist()
        compose.onNodeWithTag("search.format").performClick()
        compose.onNodeWithTag("search.format.pdf").performClick()
        compose.onNodeWithText("Portuguese PDF").assertIsDisplayed()
        compose.runOnIdle { results.value = listOf(english) }
        compose.onNodeWithTag("search.language").assertDoesNotExist()
        compose.onNodeWithTag("search.format").assertDoesNotExist()
        compose.onNodeWithText("English EPUB").assertIsDisplayed()
    }

    @Test fun libraryFiltersHideWithOneChoiceAndFilterBothMetadataFields() {
        val english = CatalogBook("en", "English EPUB", "Author", "", null, language = "en")
        val portuguese = english.copy(id = "pt", title = "Portuguese PDF", language = "pt", format = BookFormat.Pdf)
        val books = mutableStateOf(listOf(english))
        compose.setContent { LibraryScreen(books.value, setOf("en", "pt"), emptyList(), emptyMap(), false,
            error = null, onRefresh = {}, onOpenBook = {}, onOpenExternal = {}) }
        compose.onNodeWithTag("library.language").assertDoesNotExist()
        compose.onNodeWithTag("library.format").assertDoesNotExist()
        compose.runOnIdle { books.value = listOf(english, portuguese) }
        compose.onNodeWithTag("library.language").performClick()
        compose.onNodeWithTag("library.language.pt").performClick()
        compose.onNodeWithTag("library.format").performClick()
        compose.onNodeWithTag("library.format.pdf").performClick()
        compose.onNodeWithText("English EPUB").assertDoesNotExist()
        compose.onNodeWithText("Portuguese PDF").assertIsDisplayed()
    }

    @Test fun compactDownloadActionsUseAccessibleIconsAndNeverShowFilters() {
        val book = CatalogBook("a".repeat(32), "A long book title that should stay on a single line", "Author", "", null)
        val job = mutableStateOf(DownloadJob(book, TorrentEdition(book.id, 1, "fiction", 100), size = 100))
        var action = ""
        var opened = false
        compose.setContent { DownloadsSheet(listOf(job.value), {}, { name, _ -> action = name }, { opened = true }) }
        compose.runOnIdle { job.value = job.value.copy(bytes = 50, error = "No value for torrent") }
        compose.onNodeWithText("No value for torrent").assertDoesNotExist()
        compose.onNodeWithContentDescription("Pause download").performClick()
        assertEquals("pause", action)
        compose.onNodeWithContentDescription("Cancel download").performClick()
        assertEquals("cancel", action)
        compose.runOnIdle { job.value = job.value.copy(state = "paused") }
        compose.onNodeWithContentDescription("Resume download").performClick()
        assertEquals("resume", action)
        compose.runOnIdle { job.value = job.value.copy(state = "cancelled") }
        compose.onNodeWithContentDescription("Retry download").performClick()
        compose.onNodeWithContentDescription("Cancel download").assertDoesNotExist()
        compose.runOnIdle { job.value = job.value.copy(state = "complete") }
        compose.onNodeWithContentDescription("Read book").assertDoesNotExist()
        compose.onNodeWithTag("download.${book.id}").performClick()
        assertTrue(opened)
        compose.onNodeWithTag("downloads.language").assertDoesNotExist()
        compose.onNodeWithTag("downloads.format").assertDoesNotExist()
        compose.onNodeWithText("All languages").assertDoesNotExist()
        compose.onNodeWithText("All formats").assertDoesNotExist()
    }

    @Test fun downloadRowsKeepCompactHeightAcrossAllStates() {
        val jobs = listOf("downloading", "paused", "failed", "cancelled", "complete").mapIndexed { index, state ->
            val id = (index + 1).toString().repeat(32)
            val book = CatalogBook(id, "Download ${index + 1}", "Author", "", null)
            DownloadJob(book, TorrentEdition(id, 1, "fiction", 100), state = state, bytes = 40, size = 100)
        }
        compose.setContent { DownloadsSheet(jobs, {}, { _, _ -> }, {}) }
        jobs.forEach { job ->
            val bounds = compose.onNodeWithTag("download.${job.book.id}").fetchSemanticsNode().boundsInRoot
            assertTrue("Download rows should fit in 64 dp", bounds.height <= with(compose.density) { 64.dp.toPx() })
        }
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val file = java.io.File(context.getExternalFilesDir(null), "compact-downloads.png")
        androidx.test.uiautomator.UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()).takeScreenshot(file)
    }

    @Test fun epubHeaderHasNoBackButtonAndRetainsNarrationAction() {
        var speaking = false
        compose.setContent { ReaderChrome("Book", null, null, BookRights(), false, { speaking = true }) }
        compose.onNodeWithContentDescription("Back").assertDoesNotExist()
        compose.onNodeWithText("Book").assertIsDisplayed()
        compose.onNodeWithContentDescription("Read aloud").performClick()
        assertTrue(speaking)
    }

    @Test fun pdfHeaderHasNoBackButtonAndRetainsBookTitle() {
        compose.setContent { PdfReaderChrome("PDF book", null, null) }
        compose.onNodeWithContentDescription("Back").assertDoesNotExist()
        compose.onNodeWithText("PDF book").assertIsDisplayed()
    }
}
