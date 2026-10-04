package app.bookstr.ui

import androidx.compose.ui.test.*
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
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibraryScreenTest {
    private val screenshots = E2eScreenshotRule()
    val composeRule = createComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(composeRule).around(screenshots)

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
                publicationSize = { 1024L },
            )
        }

        composeRule.onNodeWithText("Library").assertIsDisplayed()
        composeRule.onNodeWithText("Little Brother").assertIsDisplayed()
        composeRule.onNodeWithText("Cory Doctorow").assertIsDisplayed()
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
                publicationSize = { 1024L },
            )
        }
        composeRule.onNodeWithText("offline").assertIsDisplayed().performClick()
        assertEquals(1, refreshed)
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
                publicationSize = { 1024L },
            )
        }

        composeRule.onNodeWithText("Downloading and opening…").assertIsDisplayed()
        composeRule.onNodeWithText("Other book").performClick()
        assertEquals(null, opened)
    }

    @Test
    fun favoriteWithProgressAppearsOnlyOnceWithoutFavoritesShelf() {
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
                publicationSize = { 1024L },
            )
        }

        composeRule.onAllNodesWithText("Reading favorite").assertCountEquals(1)
        composeRule.onNodeWithText("Favorites").assertDoesNotExist()
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
                publicationSize = { 1024L },
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
    fun bookDetailsStayVisibleWithProgressAndPublicationMetadata() {
        val book = CatalogBook(
            id = "screenshot-details",
            title = "The Screenshot Review",
            author = "Visible Author",
            epubUrl = "https://blossom.example/review.epub",
            coverUrl = null,
            sourceUrl = "https://publisher.example/review",
            isbn = "9781234567890",
            year = "2026",
            blossomSha256 = "f".repeat(64),
        )
        var sentToKindle: CatalogBook? = null
        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.73, "cfi", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
                publicationSize = { 3L * 1024 * 1024 },
                canSendToKindle = { true },
                onSendToKindle = { sentToKindle = it },
            )
        }

        composeRule.onAllNodesWithText("The Screenshot Review")[0].performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("9781234567890").assertIsDisplayed()
        composeRule.onNodeWithText("73%").assertIsDisplayed()
        composeRule.onNodeWithText("3.0 MB").assertIsDisplayed()
        composeRule.onNodeWithTag("library.kindle.screenshot-details").assertIsDisplayed().performClick()
        assertEquals(book, sentToKindle)
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
        assertEquals(null, deleted)
        composeRule.onNodeWithTag("library.delete.confirm").performClick()
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
                publicationSize = { 1024L },
            )
        }

        composeRule.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo)).assertIsDisplayed()
        composeRule.onAllNodesWithText("Heart a book in LibVault to keep it here.").assertCountEquals(0)
    }

    @Test fun filtersLibraryByLanguageAndFormatAndResetsMissingFacets() {
        val en = CatalogBook("en", "English EPUB", "Unknown author", "", null, language = "English")
        val pt = en.copy(id = "pt", title = "Portuguese PDF", language = "pt-BR", format = BookFormat.Pdf)
        val ptEpub = en.copy(id = "pt-epub", title = "Portuguese EPUB", language = "pt")
        val books = androidx.compose.runtime.mutableStateOf(listOf(en, pt, ptEpub))
        composeRule.setContent {
            LibraryScreen(books.value, emptySet(), emptyList(), emptyMap(), false,
                error = null, onRefresh = {}, onOpenBook = {}, onOpenExternal = {}, publicationSize = { 100L })
        }
        composeRule.onNodeWithText("Unknown author").assertDoesNotExist()
        composeRule.onNodeWithTag("library.language").performClick()
        composeRule.onNodeWithTag("library.language.pt").performClick()
        composeRule.onNodeWithText("English EPUB").assertDoesNotExist()
        composeRule.onNodeWithText("Portuguese EPUB").assertIsDisplayed()
        composeRule.onNodeWithTag("library.format").performClick()
        composeRule.onNodeWithTag("library.format.pdf").performClick()
        composeRule.onNodeWithText("Portuguese EPUB").assertDoesNotExist()
        composeRule.onNodeWithText("Portuguese PDF").assertIsDisplayed()
        composeRule.runOnIdle { books.value = listOf(en) }
        composeRule.onNodeWithText("English EPUB").assertIsDisplayed()
    }

    @Test fun swipeLeftRequiresConfirmationAndCancelPreservesBook() {
        val book = CatalogBook("swipe", "Swipe book", "Author", "", null)
        var deleted = 0
        composeRule.setContent {
            LibraryScreen(listOf(book), emptySet(), emptyList(), emptyMap(), false,
                error = null, onRefresh = {}, onOpenBook = {}, onOpenExternal = {},
                publicationSize = { 100L }, onDeleteBook = { deleted++ })
        }
        composeRule.onNodeWithTag("library.swipe.swipe").performTouchInput { swipeRight() }
        composeRule.onNodeWithTag("library.delete.confirm").assertDoesNotExist()
        composeRule.onNodeWithTag("library.swipe.swipe").performTouchInput { swipeLeft() }
        composeRule.onNodeWithTag("library.delete.confirm").assertIsDisplayed()
        assertEquals(0, deleted)
        composeRule.onNodeWithTag("library.delete.cancel").performClick()
        composeRule.onNodeWithText("Swipe book").assertIsDisplayed()
        assertEquals(0, deleted)
        composeRule.onNodeWithTag("library.swipe.swipe").performTouchInput { swipeLeft() }
        composeRule.onNodeWithTag("library.delete.confirm").performClick()
        assertEquals(1, deleted)
    }

    @Test fun favoritesWithoutLocalFilesOrProgressAreNotInLibrary() {
        val book = CatalogBook("remote", "Remote favorite", "Author", "", null)
        composeRule.setContent {
            LibraryScreen(listOf(book), setOf(book.id), emptyList(), emptyMap(), false,
                error = null, onRefresh = {}, onOpenBook = {}, onOpenExternal = {})
        }
        composeRule.onNodeWithText("Remote favorite").assertDoesNotExist()
        composeRule.onNodeWithText("Favorites").assertDoesNotExist()
    }
}
