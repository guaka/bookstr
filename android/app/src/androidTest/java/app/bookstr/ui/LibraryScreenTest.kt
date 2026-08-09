package app.bookstr.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.CatalogBook
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
        )
        var opened: CatalogBook? = null

        composeRule.setContent {
            LibraryScreen(
                books = listOf(book),
                progress = emptyMap(),
                loading = false,
                error = null,
                onRefresh = {},
                onOpenBook = { opened = it },
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
                progress = emptyMap(),
                loading = false,
                error = "offline",
                onRefresh = { refreshed++ },
                onOpenBook = {},
            )
        }
        composeRule.onNodeWithText("offline").assertIsDisplayed().performClick()
        assertEquals(1, refreshed)
    }
}
