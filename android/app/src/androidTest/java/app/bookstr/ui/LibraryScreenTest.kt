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
    fun showsEmptyLibrarySectionMessagesWhenNothingIsLoaded() {
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Library").assertIsDisplayed()
        composeRule.onNodeWithText("Reading").assertIsDisplayed()
        composeRule.onNodeWithText("Favorites").assertIsDisplayed()
        composeRule.onNodeWithText("Books you open will appear here with their progress.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("Heart a book in LibVault to keep it here.").assertIsDisplayed()
    }

    @Test
    fun searchFavoritesByAuthorYearAndFormat() {
        val poems = CatalogBook(
            id = "poetry",
            title = "Poetry Hour",
            author = "A Poet",
            epubUrl = "https://example.org/poetry.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        val notes = CatalogBook(
            id = "notes",
            title = "PDF Notes",
            author = "Study Friend",
            epubUrl = "https://example.org/notes.PDF",
            coverUrl = null,
            format = BookFormat.Pdf,
            year = "2026",
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(poems, notes),
                favoriteIds = setOf(poems.id, notes.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("poet")
        composeRule.onNodeWithText("Poetry Hour").assertIsDisplayed()
        composeRule.onNodeWithText("PDF Notes").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Search favorites").performTextInput("2026")
        composeRule.onNodeWithText("PDF Notes").assertIsDisplayed()
        composeRule.onNodeWithText("Poetry Hour").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Search favorites").performTextInput("pdf")
        composeRule.onNodeWithText("PDF Notes").assertIsDisplayed()
        composeRule.onNodeWithText("Poetry Hour").assertDoesNotExist()
    }

    @Test
    fun favoritesSearchNoMatchesShowsEmptyState() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "match",
                        title = "Matchable",
                        author = "Author",
                        epubUrl = "https://example.org/match.epub",
                        coverUrl = null,
                        format = BookFormat.Epub,
                    )
                ),
                favoriteIds = setOf("match"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("definitely-missing")
        composeRule.onNodeWithText("No favorites match “definitely-missing”.").assertIsDisplayed()
    }

    @Test
    fun externalFavoritesCanBeFilteredByFormatAndOpened() {
        val remote = ExternalFavorite(
            key = "external-format",
            title = "Remote EPUB",
            author = "Friend",
            year = "2024",
            url = "https://publisher.example/remote.epub",
            isbn = "9781111111111",
            libvaultMd5 = "a1",
            format = "epub",
            blossomSha256 = "b".repeat(64),
            blossomUrl = "https://blossom.bfr.ee/" + "b".repeat(64),
        )
        var opened: ExternalFavorite? = null

        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(remote),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = { opened = it },
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("epub")
        composeRule.onNodeWithText("Remote EPUB").assertIsDisplayed()
        composeRule.onNodeWithText("Author unknown").assertDoesNotExist()
        composeRule.onNodeWithText("Remote EPUB").performClick()
        assertEquals(remote, opened)
    }

    @Test
    fun externalFavoritesSearchByAuthorShowsNoMatchesStateMessage() {
        val remote = ExternalFavorite(
            key = "ext-author",
            title = "Remote PDF",
            author = "My Author",
            year = null,
            url = "https://publisher.example/remote.pdf",
            isbn = null,
            libvaultMd5 = "a2",
            format = "pdf",
            blossomSha256 = "c".repeat(64),
            blossomUrl = "https://blossom.bfr.ee/" + "c".repeat(64),
        )

        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(remote),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("missing-author")
        composeRule.onNodeWithText("No favorites match “missing-author”.").assertIsDisplayed()
    }

    @Test
    fun openingBookRowDoesNotAcceptTapForTheSameBook() {
        val opening = CatalogBook(
            id = "opening2",
            title = "Blocked book",
            author = "Author",
            epubUrl = "https://example.org/opening2.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        var openCount = 0

        composeRule.setContent {
            LibraryScreen(
                books = listOf(opening),
                favoriteIds = setOf(opening.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                openingBookId = opening.id,
                error = null,
                onRefresh = {},
                onOpenBook = { openCount++ },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Blocked book").performClick()
        composeRule.onNodeWithText("Downloading and opening…").assertIsDisplayed()
        assertEquals(0, openCount)
    }

    @Test
    fun booksWithProgressButNoReadingActivityAreNotInReadingShelf() {
        val book = CatalogBook(
            id = "idle",
            title = "Idle book",
            author = "Author",
            epubUrl = "https://example.org/idle.epub",
            coverUrl = null,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.0, "", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Reading").assertIsDisplayed()
        composeRule.onNodeWithText("Books you open will appear here with their progress.").assertIsDisplayed()
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
    fun showsReadingProgressInPercentForNonZeroProgress() {
        val reading = CatalogBook(
            id = "reading",
            title = "A Reading Book",
            author = "Author",
            epubUrl = "https://example.org/reading.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(reading),
                favoriteIds = setOf(reading.id),
                externalFavorites = emptyList(),
                progress = mapOf(reading.id to BookProgress(reading.id, 0.42, "epubcfi(/6/2)", 100L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("42% read").assertIsDisplayed()
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
    fun selectedBookDetailsShowSourceAndFormat() {
        val book = CatalogBook(
            id = "details",
            title = "Detailed Meta",
            author = "Source Author",
            epubUrl = "https://example.org/details.epub",
            coverUrl = null,
            sourceUrl = "https://publisher.example/book/details",
            isbn = "9789876543210",
            format = BookFormat.Pdf,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onOpenBook = {},
                onRefresh = {},
                onOpenExternal = {},
            )
        }

        composeRule.onAllNodesWithText("Detailed Meta")[0].performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("Format").assertIsDisplayed()
        composeRule.onNodeWithText("PDF").assertIsDisplayed()
        composeRule.onNodeWithText("Source").assertIsDisplayed()
        composeRule.onNodeWithText("publisher.example").assertIsDisplayed()
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
    fun externalFavoriteOpensWithOnOpenCallbackWithoutOpeningBookPath() {
        val favorite = ExternalFavorite(
            key = "blossom",
            title = "Remote Blossom",
            author = "Remote Author",
            year = "2026",
            url = "https://publisher.example.com/remote-book.epub",
            isbn = "9789999999999",
            libvaultMd5 = "a1",
            format = "epub",
            blossomSha256 = "f".repeat(64),
            blossomUrl = "https://blossom.bfr.ee/" + "f".repeat(64),
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

        composeRule.onNodeWithText("Remote Blossom").performClick()
        assertEquals(favorite, opened)
    }

    @Test
    fun externalFavoriteDetailsCanUnfavoriteWithoutOpenButtonWhenUnavailable() {
        val favorite = ExternalFavorite(
            key = "legacy",
            title = "Offline Favorite",
            author = null,
            year = null,
            url = null,
            isbn = null,
            libvaultMd5 = null,
            format = "pdf",
            blossomSha256 = null,
            blossomUrl = null,
        )
        var unfavorited: ExternalFavorite? = null

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
                onOpenExternal = {},
                onUnfavoriteExternal = { unfavorited = it },
            )
        }

        composeRule.onNodeWithText("Offline Favorite").performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("Open book").assertDoesNotExist()
        composeRule.onNodeWithText("Unfavorite").performClick()
        assertEquals(favorite, unfavorited)
    }

    @Test
    fun favoriteMetadataUsesSourceFallbackForUnknownAuthorAndYear() {
        val book = CatalogBook(
            id = "meta-fallback",
            title = "Unknowns",
            author = "Unknown",
            epubUrl = "https://example.org/meta.epub",
            coverUrl = null,
            sourceUrl = null,
            format = BookFormat.Epub,
        )

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
            )
        }

        composeRule.onNodeWithText("Unknowns").performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("Author unknown").assertIsDisplayed()
        composeRule.onNodeWithText("Year unknown").assertIsDisplayed()
    }

    @Test
    fun searchFavoritesTrimsInputBeforeMatching() {
        val book = CatalogBook(
            id = "trimmed",
            title = "Trim Space",
            author = "Trim Author",
            epubUrl = "https://example.org/trim.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )

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
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("  trim ")
        composeRule.onNodeWithText("Trim Space").assertIsDisplayed()
    }

    @Test
    fun clearFilterReturnsAllFavorites() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "one",
                        title = "Alpha",
                        author = "Author A",
                        epubUrl = "https://example.org/a.epub",
                        coverUrl = null,
                    ),
                    CatalogBook(
                        id = "two",
                        title = "Beta",
                        author = "Author B",
                        epubUrl = "https://example.org/b.epub",
                        coverUrl = null,
                    ),
                ),
                favoriteIds = setOf("one", "two"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("alpha")
        composeRule.onNodeWithText("Alpha").assertIsDisplayed()
        composeRule.onNodeWithText("Beta").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Alpha").assertIsDisplayed()
        composeRule.onNodeWithText("Beta").assertIsDisplayed()
    }

    @Test
    fun errorCanRefreshEvenWhenBooksArePresent() {
        var refreshCount = 0

        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "book",
                        title = "Existing",
                        author = "Author",
                        epubUrl = "https://example.org/existing.epub",
                        coverUrl = null,
                    )
                ),
                favoriteIds = setOf("book"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = "network is down",
                onRefresh = { refreshCount++ },
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("network is down").performClick()
        assertEquals(1, refreshCount)
    }

    @Test
    fun openingFromReadingShelfCallsOpenCallbackAndShowsPercent() {
        var opened: CatalogBook? = null
        val reading = CatalogBook(
            id = "with-progress",
            title = "In Reading",
            author = "Book Author",
            epubUrl = "https://example.org/progress.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(reading),
                favoriteIds = setOf(reading.id),
                externalFavorites = emptyList(),
                progress = mapOf(reading.id to BookProgress(reading.id, 0.25, "", 123L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("25% read").assertIsDisplayed()
        composeRule.onNodeWithText("In Reading").performClick()
        assertEquals(reading, opened)
    }

    @Test
    fun clickIsIgnoredForFavoritesOpenItemWhenFavoriteIsOpening() {
        val opening = CatalogBook(
            id = "open-fav",
            title = "Opening Favorite",
            author = "Author",
            epubUrl = "https://example.org/opening-fav.epub",
            coverUrl = null,
        )
        var openCount = 0

        composeRule.setContent {
            LibraryScreen(
                books = listOf(opening),
                favoriteIds = setOf(opening.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                openingBookId = opening.id,
                error = null,
                onRefresh = {},
                onOpenBook = { openCount++ },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Opening Favorite").performClick()
        composeRule.onNodeWithText("Downloading and opening…").assertIsDisplayed()
        assertEquals(0, openCount)
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

    @Test
    fun loadingExternalFavoriteShowsMissingMetadataFallbacks() {
        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(
                    ExternalFavorite(
                        key = "ghost-meta",
                        title = "Ghost Favorite",
                        author = null,
                        year = null,
                        url = "https://publisher.example/ghost.pdf",
                        isbn = null,
                        libvaultMd5 = "c".repeat(64),
                        format = "mobi",
                        blossomSha256 = null,
                        blossomUrl = null,
                    )
                ),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Ghost Favorite").assertIsDisplayed()
        composeRule.onNodeWithText("Author unknown").assertIsDisplayed()
        composeRule.onNodeWithText("Year unknown").assertIsDisplayed()
        composeRule.onNodeWithText("MOBI · Not on Blossom").assertIsDisplayed()
    }

    @Test
    fun externalFavoriteCanBeUnfavoritedFromDetails() {
        val remote = ExternalFavorite(
            key = "external-unfav",
            title = "External To Remove",
            author = "Remote Author",
            year = "2020",
            url = "https://publisher.example/remote-unfav.epub",
            isbn = null,
            libvaultMd5 = "a".repeat(64),
            format = "epub",
            blossomSha256 = null,
            blossomUrl = null,
        )
        var unfavorited: ExternalFavorite? = null

        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(remote),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
                onUnfavoriteExternal = { unfavorited = it },
            )
        }

        composeRule.onNodeWithText("External To Remove").performTouchInput { longClick() }
        composeRule.onNodeWithText("Book details").assertIsDisplayed()
        composeRule.onNodeWithText("Format").assertIsDisplayed()
        composeRule.onNodeWithText("Unfavorite").performClick()
        assertEquals(remote, unfavorited)
    }

    @Test
    fun booksCanOpenWhileAnErrorBannerIsDisplayed() {
        val openable = CatalogBook(
            id = "error-open",
            title = "Still Opens",
            author = "Book Author",
            epubUrl = "https://example.org/open.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        var opened: CatalogBook? = null

        composeRule.setContent {
            LibraryScreen(
                books = listOf(openable),
                favoriteIds = setOf(openable.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = "network is down",
                onRefresh = {},
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("network is down").assertIsDisplayed()
        composeRule.onNodeWithText("Still Opens").assertIsDisplayed()
        composeRule.onNodeWithText("Still Opens").performClick()
        assertEquals(openable, opened)
    }

    @Test
    fun externalFavoriteFilterCanBeClearedAfterNoMatches() {
        val remote = ExternalFavorite(
            key = "ext-alpha",
            title = "Alpha Favorite",
            author = "Alice",
            year = "2023",
            url = "https://publisher.example/alpha.epub",
            isbn = null,
            libvaultMd5 = "d".repeat(64),
            format = "epub",
            blossomSha256 = "c".repeat(64),
            blossomUrl = "https://blossom.bfr.ee/" + "c".repeat(64),
        )
        val remote2 = ExternalFavorite(
            key = "ext-beta",
            title = "Beta Favorite",
            author = "Bob",
            year = "2024",
            url = "https://publisher.example/beta.epub",
            isbn = null,
            libvaultMd5 = "e".repeat(64),
            format = "epub",
            blossomSha256 = "d".repeat(64),
            blossomUrl = "https://blossom.bfr.ee/" + "d".repeat(64),
        )

        composeRule.setContent {
            LibraryScreen(
                books = emptyList(),
                favoriteIds = emptySet(),
                externalFavorites = listOf(remote, remote2),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("missing")
        composeRule.onNodeWithText("No favorites match “missing”.").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Alpha Favorite").assertIsDisplayed()
        composeRule.onNodeWithText("Beta Favorite").assertIsDisplayed()
    }

    @Test
    fun favoriteSearchIsCaseInsensitive() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "case",
                        title = "Case Study",
                        author = "Case Author",
                        epubUrl = "https://example.org/case.epub",
                        coverUrl = null,
                        format = BookFormat.Epub,
                    ),
                ),
                favoriteIds = setOf("case"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("cAsE")
        composeRule.onNodeWithText("Case Study").assertIsDisplayed()
    }

    @Test
    fun favoriteSearchRespectsWhitespaceTrim() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "space",
                        title = "Edge Case",
                        author = "Trim Author",
                        epubUrl = "https://example.org/space.epub",
                        coverUrl = null,
                        format = BookFormat.Pdf,
                    ),
                ),
                favoriteIds = setOf("space"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("  edge case  ")
        composeRule.onNodeWithText("Edge Case").assertIsDisplayed()
    }

    @Test
    fun favoritesSearchClearIconOnlyShowsWhenFilterIsActive() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "one",
                        title = "First",
                        author = "Author",
                        epubUrl = "https://example.org/first.epub",
                        coverUrl = null,
                        format = BookFormat.Epub,
                    ),
                ),
                favoriteIds = setOf("one"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithContentDescription("Clear filter").assertDoesNotExist()
        composeRule.onNodeWithText("Search favorites").performTextInput("first")
        composeRule.onNodeWithContentDescription("Clear filter").assertIsDisplayed()
    }

    @Test
    fun favoriteSearchNoMatchesThenClearButtonReturnsList() {
        composeRule.setContent {
            LibraryScreen(
                books = listOf(
                    CatalogBook(
                        id = "first",
                        title = "First",
                        author = "Author One",
                        epubUrl = "https://example.org/first.epub",
                        coverUrl = null,
                        format = BookFormat.Epub,
                    ),
                    CatalogBook(
                        id = "second",
                        title = "Second",
                        author = "Author Two",
                        epubUrl = "https://example.org/second.epub",
                        coverUrl = null,
                        format = BookFormat.Pdf,
                    ),
                ),
                favoriteIds = setOf("first", "second"),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Search favorites").performTextInput("missing")
        composeRule.onNodeWithText("No favorites match “missing”.").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("First").assertIsDisplayed()
        composeRule.onNodeWithText("Second").assertIsDisplayed()
    }

    @Test
    fun favoriteBookCanOpenFromFavoritesSection() {
        val favorite = CatalogBook(
            id = "fav-open",
            title = "Openable Favorite",
            author = "Author",
            epubUrl = "https://example.org/openable.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        var opened: CatalogBook? = null
        composeRule.setContent {
            LibraryScreen(
                books = listOf(favorite),
                favoriteIds = setOf(favorite.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Openable Favorite").assertIsDisplayed()
        composeRule.onNodeWithText("Openable Favorite").performClick()
        assertEquals(favorite, opened)
    }

    @Test
    fun bookWithNoReadingProgressDoesNotShowReadPercentBadge() {
        val book = CatalogBook(
            id = "empty-progress",
            title = "No Read Progress",
            author = "Author",
            epubUrl = "https://example.org/no-progress.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.0, "", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("No Read Progress").assertIsDisplayed()
        composeRule.onNodeWithText("0% read").assertDoesNotExist()
    }

    @Test
    fun progressingBookStillShowsReadPercent() {
        val book = CatalogBook(
            id = "read-progress",
            title = "Has Read Progress",
            author = "Author",
            epubUrl = "https://example.org/read-progress.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = mapOf(book.id to BookProgress(book.id, 0.09, "epubcfi(/6/2)", 1L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("9% read").assertIsDisplayed()
    }

    @Test
    fun externalFavoriteUnknownFormatFallsBackToPlaceholder() {
        val favorite = ExternalFavorite(
            key = "unknown-format",
            title = "Mysterious Format",
            author = "Library",
            year = null,
            url = "https://publisher.example/unknown",
            isbn = null,
            libvaultMd5 = "m".repeat(64),
            format = "   ",
            blossomSha256 = null,
            blossomUrl = null,
        )

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
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("FORMAT UNKNOWN · Not on Blossom").assertIsDisplayed()
    }

    @Test
    fun externalFavoriteShowsOpenUnavailableTextWhenNoBlossomSource() {
        val favorite = ExternalFavorite(
            key = "offline-detail",
            title = "No Source Favorite",
            author = "Reader",
            year = "2026",
            url = null,
            isbn = "9781111111111",
            libvaultMd5 = null,
            format = "pdf",
            blossomSha256 = null,
            blossomUrl = null,
        )

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
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("No Source Favorite").performTouchInput { longClick() }
        composeRule.onNodeWithText("Open book").assertDoesNotExist()
        composeRule.onNodeWithText("Unfavorite").assertIsDisplayed()
    }

    @Test
    fun errorWithFavoritesStillAllowsOpeningBook() {
        val book = CatalogBook(
            id = "error-favorite-open",
            title = "Favorite During Error",
            author = "Author",
            epubUrl = "https://example.org/error-favorite-open.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        var opened: CatalogBook? = null
        var refreshed = 0

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                favoriteIds = setOf(book.id),
                externalFavorites = emptyList(),
                progress = emptyMap(),
                loading = false,
                error = "sync failed",
                onRefresh = { refreshed++ },
                onOpenBook = { opened = it },
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("sync failed").performClick()
        composeRule.onNodeWithText("Favorite During Error").performClick()
        assertEquals(1, refreshed)
        assertEquals(book, opened)
    }

    @Test
    fun nonFavoriteReadingBookAppearsInReadingShelfAndFavoritesHintStaysVisible() {
        val reading = CatalogBook(
            id = "non-fav-reading",
            title = "Only Reading Shelf",
            author = "Author",
            epubUrl = "https://example.org/only-reading.epub",
            coverUrl = null,
            format = BookFormat.Epub,
        )
        composeRule.setContent {
            LibraryScreen(
                books = listOf(reading),
                favoriteIds = emptySet(),
                externalFavorites = emptyList(),
                progress = mapOf(reading.id to BookProgress(reading.id, 0.5, "epubcfi(/6/2)", 2L)),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = {},
                onOpenExternal = {},
            )
        }

        composeRule.onNodeWithText("Reading").assertIsDisplayed()
        composeRule.onNodeWithText("Only Reading Shelf").assertIsDisplayed()
        composeRule.onNodeWithText("50% read").assertIsDisplayed()
        composeRule.onNodeWithText("Heart a book in LibVault to keep it here.").assertIsDisplayed()
    }
}
