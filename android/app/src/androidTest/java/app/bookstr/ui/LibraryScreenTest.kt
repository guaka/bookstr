package app.bookstr.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.E2eScreenshotRule
import app.bookstr.data.CatalogBook
import app.bookstr.data.ExternalFavorite
import app.bookstr.data.BookFormat
import app.bookstr.data.BookProgress
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibraryScreenTest {
    @get:Rule
    val screenshots = E2eScreenshotRule()

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun rendersBooksAndOpensOnClick() {
        val book = CatalogBook(
            id = "abc",
            title = "Little Brother",
            author = "Cory Doctorow",
            epubUrl = "https://example.org/book.epub",
            coverUrl = null,
            format = BookFormat.Epub,
            blossomSha256 = "b".repeat(64),
        )
        var opened: CatalogBook? = null

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Library").assertIsDisplayed()
        composeRule.onNodeWithText("Little Brother").assertIsDisplayed()
        composeRule.onNodeWithText("Cory Doctorow").assertIsDisplayed()
        composeRule.onNodeWithText("EPUB · On Blossom").assertIsDisplayed()
        composeRule.onNodeWithText("Little Brother").performClick()
        assertEquals(book, opened)
    }

    @Test
    fun showsErrorAndAllowsRefresh() {
        var refreshed = 0
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = "offline",
                onRefresh = { refreshed++ },
                onOpenBook = {},
                onOpenExternal = {},
            )
        }
        composeRule.onNodeWithText("offline").assertIsDisplayed().performClick()
        assertEquals(1, refreshed)
    }

    @Test
    fun showsCompactMetadataFallbackForLegacyFavorites() {
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                externalFavorites = listOf(
                    ExternalFavorite(
                        key = "legacy",
                        title = "Legacy favorite",
                        author = null,
                        year = null,
                        url = null,
                        isbn = null,
                        libvaultMd5 = null,
                        format = "pdf",
                    ),
                ),
                favoriteIds = emptySet(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Author unknown · Year unknown").assertIsDisplayed()
        composeRule.onNodeWithText("PDF · Not on Blossom").assertIsDisplayed()
    }

    @Test
    fun disablesAdditionalBookTapsWhileOneIsOpening() {
        val opening = CatalogBook(
            id = "opening",
            title = "Opening book",
            author = "Author",
            epubUrl = "https://example.org/opening.epub",
            coverUrl = null,
        )
        val other = opening.copy(id = "other", title = "Other book")
        var opened: CatalogBook? = null

        composeRule.setContent {
            LibraryScreen(
                books = listOf(opening, other),
                favoriteIds = setOf(opening.id, other.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                openingBookId = opening.id,
                error = null,
                onRefresh = {},
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Downloading and opening…").assertIsDisplayed()
        composeRule.onNodeWithText("Other book").performClick()
        assertEquals(null, opened)
    }

    @Test
    fun favoriteWithProgressAppearsInReadingAndFavorites() {
        val book = CatalogBook(
            id = "both",
            title = "Reading favorite",
            author = "Author",
            epubUrl = "https://example.org/both.epub",
            coverUrl = null,
        )
        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.25, "cfi", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onAllNodesWithText("Reading favorite").assertCountEquals(2)
    }

    @Test
    fun openedBookAtStartAppearsInReadingWithZeroPercent() {
        val book = CatalogBook(
            id = "started",
            title = "Just started",
            author = "Author",
            epubUrl = "https://example.org/started.epub",
            coverUrl = null,
        )
        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = emptySet(),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.0, "epubcfi(/6/2)", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Just started").assertIsDisplayed()
        composeRule.onNodeWithText("0% read").assertIsDisplayed()
    }

    @Test
    fun longPressOpensFullBookDetailsAndActions() {
        val book = CatalogBook(
            id = "details",
            title = "Detailed Book",
            author = "Useful Author",
            epubUrl = "https://blossom.example/details.epub",
            coverUrl = null,
            sourceUrl = "https://publisher.example/books/details",
            isbn = "9780123456789",
            year = "2025",
            blossomSha256 = "c".repeat(64),
        )
        var unfavorited: CatalogBook? = null
        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.42, "cfi", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
                publicationSize = { 2L * 1024 * 1024 },
                onUnfavoriteBook = { unfavorited = it },
            )
        }

        composeRule.onAllNodesWithText("Detailed Book")[0].performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("9780123456789").assertIsDisplayed()
        composeRule.onNodeWithText("42%").assertIsDisplayed()
        composeRule.onNodeWithText("2.0 MB").assertIsDisplayed()
        composeRule.onNodeWithText("Delete download").assertIsDisplayed()
        composeRule.onNodeWithText("Unfavorite").performClick()
        assertEquals(book, unfavorited)
    }

    @Test
    fun searchesFavoritesByTitleAndFormat() {
        val epub = CatalogBook(
            id = "epub",
            title = "The Green Book",
            author = "Author",
            epubUrl = "https://example.org/green.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        val pdf = CatalogBook(
            id = "pdf",
            title = "The Blue Book",
            author = "Author",
            epubUrl = "https://example.org/blue.pdf",
            coverUrl = null,
            format = BookFormat.Pdf,
        )
        composeRule.setContent {
            LibraryScreen(
                books = listOf(epub, pdf),
                favoriteIds = setOf(epub.id, pdf.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("pdf")
        composeRule.onNodeWithText("The Blue Book").assertIsDisplayed()
        composeRule.onAllNodesWithText("The Green Book").assertCountEquals(0)
    }

    @Test
    fun filteringTheLibraryKeepsTheMatchingReadingProgressVisible() {
        val reading = CatalogBook(
            id = "reading",
            title = "A Visible Reading Journey",
            author = "Reader",
            epubUrl = "https://example.org/reading.epub",
            coverUrl = null,
        )
        val other = reading.copy(id = "other", title = "Another Book")
        composeRule.setContent {
            LibraryScreen(
                books = listOf(reading, other),
                favoriteIds = setOf(reading.id, other.id),
                externalFavorites = emptyList(),
                progress = mapOf(reading.id to BookProgress(reading.id, 0.6, "cfi", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("journey")
        composeRule.onAllNodesWithText("A Visible Reading Journey").assertCountEquals(2)
        composeRule.onAllNodesWithText("60% read").assertCountEquals(2)
        composeRule.onAllNodesWithText("Another Book").assertCountEquals(0)
    }

    @Test
    fun externalFavoriteDetailsCanOpenItsBlossomCopy() {
        val favorite = ExternalFavorite(
            key = "external-book",
            title = "Remote Book",
            author = "Remote Author",
            year = "2024",
            url = "https://publisher.example/remote-book",
            isbn = "9780000000000",
            libvaultMd5 = "d".repeat(32),
            format = "epub",
            blossomSha256 = "e".repeat(64),
            blossomUrl = "https://blossom.example/remote-book.epub",
        )
        var opened: ExternalFavorite? = null
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(favorite),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = { opened = it },
            )
        }

        composeRule.onNodeWithText("Remote Book").performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("9780000000000").assertIsDisplayed()
        composeRule.onNodeWithText("Available").assertIsDisplayed()
        composeRule.onNodeWithText("Open book").performClick()
        assertEquals(favorite, opened)
    }

    @Test
    fun bookDetailsDeleteActionReportsTheSelectedBook() {
        val book = CatalogBook(
            id = "delete-me",
            title = "Downloaded Book",
            author = "Author",
            epubUrl = "https://example.org/downloaded.epub",
            coverUrl = null,
        )
        var deleted: CatalogBook? = null
        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
                publicationSize = { 512L * 1024 },
                onDeleteBook = { deleted = it },
            )
        }

        composeRule.onNodeWithText("Downloaded Book").performTouchInput { longClick() }
        composeRule.onNodeWithText("Delete download").performClick()
        assertEquals(book, deleted)
    }

    @Test
    fun loadingAnEmptyLibraryShowsProgressInsteadOfEmptyShelves() {
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = true,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertIsDisplayed()
        composeRule.onAllNodesWithText("Heart a book in LibVault to keep it here.").assertCountEquals(0)
    }
}
