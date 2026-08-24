package app.bookstr.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.VocabularyWord
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONArray

@RunWith(AndroidJUnit4::class)
class WordsScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun filtersWordsByDefinitionAndClearsTheFilter() {
        val apple = word(
            key = "en:apple",
            text = "apple",
            definition = "A fruit.",
            context = "An apple rested on the table.",
        )
        val zebra = word(
            key = "en:zebra",
            text = "zebra",
            definition = "A striped animal.",
            context = "A zebra crossed the road.",
        )

        composeRule.setContent {
            WordsScreen(
                words = listOf(apple, zebra),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).performTextInput("fruit")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("zebra").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("zebra").assertIsDisplayed()
    }

    @Test
    fun selectingSortOptionReportsTheNewSortKey() {
        var selectedSort: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:word", "word", "A thing.")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selectedSort = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()
        assertEquals("alphabetical", selectedSort)
    }

    @Test
    fun swipingAWordOpensConfirmationAndOnlyConfirmDeletesIt() {
        val saved = word("en:ephemeral", "ephemeral", "Short-lived.")
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(saved),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("ephemeral").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove word?").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").performClick()
        assertEquals(null, deleted)

        composeRule.onNodeWithText("ephemeral").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        assertEquals(saved, deleted)
    }

    @Test
    fun tappingAWordReportsTheWordToOpen() {
        val saved = word("en:reader", "reader", "Someone who reads.")
        var opened: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(saved),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("reader").performClick()
        assertEquals(saved, opened)
    }

    private fun word(
        key: String,
        text: String,
        definition: String,
        context: String = "",
    ) = VocabularyWord(
        key = key,
        word = text,
        language = "en",
        syncId = key,
        bookId = "book-1",
        bookTitle = "Test book",
        cfi = "epubcfi(/6/2)",
        contextSentence = context,
        partOfSpeech = "noun",
        definitionsJson = JSONArray(listOf(definition)).toString(),
        sourceUrl = "https://en.wiktionary.org/wiki/$text",
        lookupCount = 1,
        firstSeenAt = 1L,
        lastSeenAt = 1L,
        deleted = false,
    )
}
