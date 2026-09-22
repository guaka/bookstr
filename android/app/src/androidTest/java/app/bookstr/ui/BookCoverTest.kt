package app.bookstr.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.core.app.ApplicationProvider
import app.bookstr.data.BookFormat
import app.bookstr.data.BookSearchResult
import app.bookstr.data.CatalogBook
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class BookCoverTest {
    @get:Rule val compose = createComposeRule()
    private fun publication(id: String): File {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = File(context.filesDir, "books/$id.cbz")
        file.parentFile!!.mkdirs()
        ZipOutputStream(file.outputStream()).use { zip ->
            zip.putNextEntry(ZipEntry("cover.png"))
            val image = Bitmap.createBitmap(80, 120, Bitmap.Config.ARGB_8888)
            image.eraseColor(Color.BLUE); image.compress(Bitmap.CompressFormat.PNG, 100, zip); image.recycle()
            zip.closeEntry()
        }
        return file
    }
    @Test fun libraryDisplaysLocalCoverWithoutChangingBookClick() {
        val id = "cover-ui-${System.nanoTime()}"
        val file = publication(id)
        val book = CatalogBook(id, "Offline cover", "Author", "", null, format = BookFormat.Cbz)
        var opened = false
        try {
            compose.setContent { LibraryScreen(listOf(book), setOf(id), emptyList(), emptyMap(), false,
                error = null, onRefresh = {}, onOpenBook = { opened = true }, onOpenExternal = {}) }
            compose.waitUntil(5000) { compose.onAllNodesWithTag("cover.image.$id", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("cover.$id", useUnmergedTree = true).assertWidthIsEqualTo(42.dp).assertHeightIsEqualTo(62.dp)
            compose.onNodeWithText("Offline cover").performClick()
            org.junit.Assert.assertTrue(opened)
        } finally { file.delete() }
    }
    @Test fun searchDisplaysCoverAndMissingCoverKeepsStableSize() {
        val id = "search-cover-${System.nanoTime()}"
        val file = publication(id)
        val result = BookSearchResult(id, "public", "Search cover", "Author", format = BookFormat.Cbz, downloadUrl = "https://example.org/book.cbz")
        try {
            compose.setContent { SearchScreen(query = "book", results = listOf(result, result.copy(id = "missing", title = "No cover")), searching = false, openingBookId = null,
                message = null, isFavorite = { false }, readingProgress = { null }, onQueryChange = {}, onSearch = {}, onOpen = {}, onToggleFavorite = {}) }
            compose.waitUntil(5000) { compose.onAllNodesWithTag("cover.image.$id", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("cover.missing", useUnmergedTree = true).assertWidthIsEqualTo(42.dp).assertHeightIsEqualTo(62.dp)
            File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "book-cover-preview.png").outputStream().use {
                compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } finally { file.delete() }
    }
}
