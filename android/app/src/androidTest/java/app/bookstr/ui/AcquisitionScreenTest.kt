package app.bookstr.ui

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.*
import app.bookstr.download.DownloadJob
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AcquisitionScreenTest {
    @get:Rule val compose = createComposeRule()
    private val hash = "a".repeat(32)
    @Test fun privateSearchSupportsPaginationEditionSelectionAndDownloadNavigation() {
        var searched = false; var more = false; var downloads = false; var opened = false
        val query = mutableStateOf("")
        val result = BookSearchResult(hash, "libcat", "Fixture edition", "Bookstr", format = BookFormat.Pdf, libvaultMd5 = hash)
        compose.setContent {
            SearchScreen(query = query.value, results = listOf(result), searching = false, openingBookId = null,
                message = null, isFavorite = { false }, readingProgress = { null }, onQueryChange = { query.value = it },
                onSearch = { searched = true }, onOpen = { opened = it.id == hash }, onToggleFavorite = {},
                nextOffset = 20, onLoadMore = { more = true }, onDownloads = { downloads = true })
        }
        compose.onNodeWithTag("search.query").performTextInput("Fixture")
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithTag("search.open.$hash").performClick()
        compose.waitUntil(5_000) { more }
        compose.onNodeWithTag("search.load-more").assertDoesNotExist()
        compose.onNodeWithTag("search.downloads").performScrollTo().assertContentDescriptionEquals("Downloads")
        compose.onNodeWithText("All languages").assertExists()
        compose.onNodeWithText("All formats").assertExists()
        val languageCenter = compose.onNodeWithTag("search.language").fetchSemanticsNode().boundsInRoot.center.y
        val formatCenter = compose.onNodeWithTag("search.format").fetchSemanticsNode().boundsInRoot.center.y
        val downloadsCenter = compose.onNodeWithTag("search.downloads").fetchSemanticsNode().boundsInRoot.center.y
        assertEquals(languageCenter, formatCenter, 1f)
        assertEquals(languageCenter, downloadsCenter, 1f)
        compose.onNodeWithTag("search.downloads").performClick()
        assertTrue(searched && opened && more && downloads)
    }
    @Test fun searchHasClearControlAndProminentButtonOutsideTheField() {
        val query = mutableStateOf("fixture query")
        var searched = false
        compose.setContent {
            SearchScreen(query = query.value, results = emptyList(), searching = false, openingBookId = null,
                message = null, isFavorite = { false }, readingProgress = { null }, onQueryChange = { query.value = it },
                onSearch = { searched = true }, onOpen = {}, onToggleFavorite = {})
        }
        compose.onNodeWithTag("search.clear").assertExists()
        val field = compose.onNodeWithTag("search.query").fetchSemanticsNode().boundsInRoot
        val button = compose.onNodeWithTag("search.submit").fetchSemanticsNode().boundsInRoot
        assertTrue(button.left >= field.right)
        compose.onNodeWithTag("search.submit").assertIsEnabled().performClick()
        assertTrue(searched)
        compose.onNodeWithTag("search.clear").performClick()
        compose.runOnIdle { assertEquals("", query.value) }
        compose.onNodeWithTag("search.clear").assertDoesNotExist()
        compose.onNodeWithTag("search.submit").assertIsNotEnabled()
    }
    @Test fun searchLoadsNextPageAtEndOnlyOncePerOffset() {
        val offset = mutableStateOf<Int?>(20)
        val searching = mutableStateOf(false)
        var loads = 0
        val results = (0 until 30).map { index ->
            val id = index.toString(16).padStart(32, '0')
            BookSearchResult(id, "libcat", "Fixture $index", "Bookstr", format = BookFormat.Pdf,
                libvaultMd5 = id)
        }
        compose.setContent {
            SearchScreen(query = "fixture", results = results, searching = searching.value,
                openingBookId = null, message = null, isFavorite = { false }, readingProgress = { null },
                onQueryChange = {}, onSearch = {}, onOpen = {}, onToggleFavorite = {},
                nextOffset = offset.value, onLoadMore = { loads++; searching.value = true })
        }
        compose.runOnIdle { assertEquals(0, loads) }
        compose.onNodeWithTag("search.results").performScrollToIndex(32)
        compose.waitUntil(5_000) { loads == 1 }
        compose.runOnIdle { searching.value = false }
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(1, loads); offset.value = 40 }
        compose.waitUntil(5_000) { loads == 2 }
        compose.onNodeWithTag("search.load-more").assertDoesNotExist()
    }
    @Test fun searchCountsMetadataOnlyAfterReadableResultsAndHidesKeyboardWhenFiltering() {
        val readable = BookSearchResult(hash, "libcat", "Readable", "Author", language = "en",
            format = BookFormat.Epub, libvaultMd5 = hash)
        val metadata = readable.copy(id = "metadata", title = "Metadata", format = null, libvaultMd5 = null)
        val metadata2 = readable.copy(id = "metadata2", title = "Metadata 2", format = null, libvaultMd5 = null)
        val query = mutableStateOf("books")
        compose.setContent {
            SearchScreen(query.value, results = listOf(readable, metadata, metadata2), searching = false,
                openingBookId = null, message = null, isFavorite = { false }, readingProgress = { null },
                onQueryChange = { query.value = it }, onSearch = {}, onOpen = {}, onToggleFavorite = {})
        }
        compose.onNodeWithTag("search.metadata-only.heading").assertExists()
        compose.onNodeWithTag("search.metadata-only.heading").assertTextContains("2", substring = true)
        compose.onNodeWithTag("search.open.metadata").assertDoesNotExist()
        compose.onNodeWithTag("search.open.metadata2").assertDoesNotExist()
        val readableTop = compose.onNodeWithTag("search.open.$hash").fetchSemanticsNode().boundsInRoot.top
        val metadataTop = compose.onNodeWithTag("search.metadata-only.heading").fetchSemanticsNode().boundsInRoot.top
        assertTrue(readableTop < metadataTop)
        compose.onNodeWithTag("search.open.$hash").assertTextContains("English", substring = true)
        compose.onNodeWithTag("search.query").performClick().assertIsFocused()
        compose.onNodeWithTag("search.language").performClick()
        compose.onNodeWithTag("search.language.en").performClick()
        compose.onNodeWithTag("search.query").assertIsNotFocused()
        compose.onNodeWithTag("search.query").performClick().performTextInput(" extra")
        compose.onNodeWithTag("search.query").assertIsFocused()
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithTag("search.query").assertIsNotFocused()
    }
    @Test fun unavailableZlibMetadataIsCountedWithoutShowingItsRow() {
        val readable = BookSearchResult(hash, "libcat", "Readable", "Author", format = BookFormat.Epub, libvaultMd5 = hash)
        val unavailable = readable.copy(id = "zlib-missing", title = "Matilda", author = "Roald Dahl",
            unavailableReason = "Torrent unavailable")
        var opened = false
        compose.setContent {
            SearchScreen("Dahl", results = listOf(unavailable, readable), searching = false, openingBookId = null,
                message = null, isFavorite = { false }, readingProgress = { null }, onQueryChange = {},
                onSearch = {}, onOpen = { opened = true }, onToggleFavorite = {})
        }
        compose.onNodeWithTag("search.metadata-only.heading").assertTextContains("1", substring = true)
        compose.onNodeWithTag("search.open.zlib-missing").assertDoesNotExist()
        compose.onNodeWithTag("search.open.$hash").performScrollTo().assertExists()
        assertFalse(opened)
    }
    @Test fun downloadsExposePauseResumeCancelAndVerifiedReadActions() {
        val book = CatalogBook(hash, "Fixture", "Bookstr", "", null, format = BookFormat.Pdf, libvaultMd5 = hash)
        val job = mutableStateOf(DownloadJob(book, TorrentEdition(hash, 1, "fiction", 100)))
        var action = ""; var read = false
        compose.setContent {
            DownloadsSheet(listOf(job.value), {}, { a, id -> assertEquals(hash, id); action = a }, { read = true })
        }
        compose.onNodeWithTag("download.pause.$hash").performClick(); assertEquals("pause", action)
        compose.runOnIdle { job.value = job.value.copy(state = "paused") }
        compose.onNodeWithTag("download.resume.$hash").performClick(); assertEquals("resume", action)
        compose.onNodeWithTag("download.cancel.$hash").performClick(); assertEquals("cancel", action)
        compose.runOnIdle { job.value = job.value.copy(state = "complete", size = 100, bytes = 100) }
        compose.onNodeWithTag("download.$hash").performClick(); assertTrue(read)
        compose.onNodeWithText("Read").assertDoesNotExist()
    }

    @Test fun searchFacetsCombineAndUnknownAuthorsAndHeartsAreHidden() {
        val en = BookSearchResult("en", "libcat", "English EPUB", "Unknown author", language = "eng", format = BookFormat.Epub, libvaultMd5 = hash)
        val pt = en.copy(id = "pt", title = "Portuguese PDF", language = "pt-BR", format = BookFormat.Pdf)
        val ptEpub = en.copy(id = "pt-epub", title = "Portuguese EPUB", language = "Portuguese")
        var opened = ""
        compose.setContent {
            SearchScreen(query = "books", results = listOf(en, pt, ptEpub), searching = false, openingBookId = null,
                message = null, isFavorite = { true }, readingProgress = { null }, onQueryChange = {}, onSearch = {},
                onOpen = { opened = it.id }, onToggleFavorite = {})
        }
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithText("Unknown author").assertDoesNotExist()
        compose.onNodeWithContentDescription("Remove from favorites").assertDoesNotExist()
        compose.onNodeWithContentDescription("Add to favorites").assertDoesNotExist()
        compose.onNodeWithTag("search.language").performClick()
        compose.onNodeWithTag("search.language.pt").performClick()
        compose.onNodeWithTag("search.open.en").assertDoesNotExist()
        compose.onNodeWithTag("search.format").performClick()
        compose.onNodeWithTag("search.format.pdf").performClick()
        compose.onNodeWithTag("search.open.pt-epub").assertDoesNotExist()
        compose.onNodeWithTag("search.open.pt").performClick()
        assertEquals("pt", opened)
        compose.onNodeWithTag("edition.download").assertDoesNotExist()
        compose.onNodeWithTag("search.language").performClick()
        compose.onNodeWithTag("search.language.all").performClick()
        compose.onNodeWithTag("search.format").performClick()
        compose.onNodeWithTag("search.format.all").performClick()
        compose.onNodeWithTag("search.open.en").assertIsDisplayed()
    }

    @Test fun downloadRowsStayInPlaceWhileProgressChanges() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val root = java.io.File(context.cacheDir, "order-${System.nanoTime()}")
        val store = app.bookstr.download.DownloadStore(root)
        val first = CatalogBook(hash, "First", "Author", "", null)
        val second = first.copy(id = "b".repeat(32), title = "Second")
        store.enqueue(first, TorrentEdition(first.id, 1, "fiction", 100))
        store.enqueue(second, TorrentEdition(second.id, 2, "fiction", 100))
        assertEquals(listOf(second.id, first.id), store.jobs.value.map { it.book.id })
        compose.setContent {
            val jobs = store.jobs.collectAsState()
            DownloadsSheet(jobs.value, {}, { _, _ -> }, {})
        }
        val before = compose.onNodeWithTag("download.$hash").fetchSemanticsNode().boundsInRoot.top
        compose.runOnIdle { store.update(store.find(hash)!!.copy(bytes = 50, size = 100, state = "downloading")) }
        val after = compose.onNodeWithTag("download.$hash").fetchSemanticsNode().boundsInRoot.top
        assertEquals(before, after)
        assertTrue(after > compose.onNodeWithTag("download.${second.id}").fetchSemanticsNode().boundsInRoot.top)
        root.deleteRecursively()
    }

    @Test fun resumedDownloadMovesToTopWithoutMovingProgressUpdates() {
        val context = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val root = java.io.File(context.cacheDir, "resume-order-${System.nanoTime()}")
        try {
            val store = app.bookstr.download.DownloadStore(root)
            val first = CatalogBook(hash, "First", "Author", "", null)
            val second = first.copy(id = "b".repeat(32), title = "Second")
            store.enqueue(first, TorrentEdition(first.id, 1, "fiction", 100))
            store.enqueue(second, TorrentEdition(second.id, 2, "fiction", 100))
            store.update(store.find(first.id)!!.copy(state = "paused"))
            store.enqueue(first, TorrentEdition(first.id, 1, "fiction", 100))
            assertEquals(listOf(first.id, second.id), store.jobs.value.map { it.book.id })
            assertEquals(listOf(first.id, second.id), app.bookstr.download.DownloadStore(root).jobs.value.map { it.book.id })
        } finally { root.deleteRecursively() }
    }

    @Test fun downloadsFilterByBothFacetsWithoutChangingJobs() {
        val en = CatalogBook(hash, "English EPUB", "Author", "", null, language = "en")
        val pt = en.copy(id = "b".repeat(32), title = "Portuguese PDF", language = "pt", format = BookFormat.Pdf)
        val jobs = listOf(en, pt).map { DownloadJob(it, TorrentEdition(it.id, 1, "fiction", 100)) }
        compose.setContent { DownloadsSheet(jobs, {}, { _, _ -> }, {}) }
        compose.onNodeWithTag("downloads.language").performClick()
        compose.onNodeWithTag("downloads.language.pt").performClick()
        compose.onNodeWithText("English EPUB").assertDoesNotExist()
        compose.onNodeWithTag("downloads.format").performClick()
        compose.onNodeWithTag("downloads.format.pdf").performClick()
        compose.onNodeWithText("Portuguese PDF").assertIsDisplayed()
        assertEquals(2, jobs.size)
    }
}
