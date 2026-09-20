package app.bookstr.ui

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
                hasMore = true, onLoadMore = { more = true }, onDownloads = { downloads = true })
        }
        compose.onNodeWithTag("search.query").performTextInput("Fixture")
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithTag("search.open.$hash").performClick()
        compose.onNodeWithTag("search.load-more").performScrollTo().performClick()
        compose.onNodeWithTag("search.downloads").performScrollTo().performClick()
        assertTrue(searched && opened && more && downloads)
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
        compose.onNodeWithTag("download.open.$hash").performClick(); assertTrue(read)
    }
}
