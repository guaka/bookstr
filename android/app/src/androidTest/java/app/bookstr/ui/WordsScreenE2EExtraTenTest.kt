package app.bookstr.ui

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNode
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.VocabularyWord
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenE2EExtraTenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun sortMenuCanBeReopenedMultipleTimes() {
        var selectedSort = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit", firstSeenAt = 4),
                    word("en:banana", "banana", "Yellow fruit", firstSeenAt = 2),
                    word("en:cherry", "cherry", "Red fruit", firstSeenAt = 3),
                ),
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

        composeRule.onNodeWithText("A–Z").performClick()
        composeRule.onNodeWithText("Book, then word").performClick()
        assertEquals("book", selectedSort)

        composeRule.onNodeWithText("Book").performClick()
        composeRule.onNodeWithText("First saved").performClick()
        assertEquals("first", selectedSort)

        composeRule.onNodeWithText("First").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertEquals("count", selectedSort)
    }

    @Test
    fun filterDoesNotClearWhenSortingChangesCallbackOnly() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit", firstSeenAt = 1),
                    word("en:abacus", "abacus", "A toy", firstSeenAt = 2),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("app")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("abacus").assertDoesNotExist()

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Count").performClick()

        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("abacus").assertDoesNotExist()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("app")
    }

    @Test
    fun queryCanFilterByBookTitleAndThenOpenResult() {
        var openedWord: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit", bookTitle = "Fruit Handbook"),
                    word("en:pear", "pear", "A fruit", bookTitle = "Garden Notes"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { openedWord = it },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("garden")
        composeRule.onNodeWithText("pear").performClick()
        assertEquals("en:pear", openedWord?.key)
    }

    @Test
    fun queryCanBeReplacedByTextAndStillFilterBySecondTerm() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:moon", "moon", "night"),
                    word("en:sun", "sun", "day"),
                    word("en:star", "star", "night sky"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("moon")
        composeRule.onNodeWithText("moon").assertIsDisplayed()
        composeRule.onNodeWithText("sun").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Filter words").performTextInput("night")
        composeRule.onNodeWithText("moon").assertIsDisplayed()
        composeRule.onNodeWithText("star").assertIsDisplayed()
    }

    @Test
    fun deleteFlowCancelsAndDoesNotOpenWord() {
        var openedWord: VocabularyWord? = null
        var deletedWord: VocabularyWord? = null

        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:rose", "rose", "flower"),
                    word("en:tulip", "tulip", "flower"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { openedWord = it },
                onDeleteWord = { deletedWord = it },
            )
        }

        composeRule.onNodeWithText("rose").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()

        composeRule.onNodeWithText("rose").performClick()
        assertEquals("en:rose", openedWord?.key)
        assertEquals(null, deletedWord)
    }

    @Test
    fun deleteConfirmationThenOpenDifferentWordStillWorks() {
        var deleted: VocabularyWord? = null
        var opened: VocabularyWord? = null

        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:rose", "rose", "flower"),
                    word("en:tulip", "tulip", "flower"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it },
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("rose").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:rose", deleted?.key)
        composeRule.onNodeWithText("tulip").performClick()
        assertEquals("en:tulip", opened?.key)
    }

    @Test
    fun errorAndNoWordsShowsBothMessages() {
        composeRule.setContent {
            WordsScreen(
                words = emptyList(),
                error = "Error while loading words",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Error while loading words").assertIsDisplayed()
        composeRule.onNodeWithText("Select a word while reading. It will be saved here even when no definition is found.")
            .assertIsDisplayed()
    }

    @Test
    fun emptyListDoesNotShowNoMatchWhileFilteringBecauseBaseCopyShows() {
        composeRule.setContent {
            WordsScreen(
                words = emptyList(),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("missing")
        composeRule.onNodeWithText("Select a word while reading. It will be saved here even when no definition is found.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("No words match “missing”.").assertDoesNotExist()
    }

    @Test
    fun sortingAndFilteringCanReturnToEmptyFilterState() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit", firstSeenAt = 10),
                    word("en:banana", "banana", "Yellow fruit", firstSeenAt = 2),
                    word("en:almond", "almond", "Nut", firstSeenAt = 7),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("banana").assertDoesNotExist()

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("banana").assertIsDisplayed()
    }

    @Test
    fun filterWithSpacesThenClearIconThenReplaceValue() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:alpha", "alpha", "first"),
                    word("en:beta", "beta", "second"),
                    word("en:gamma", "gamma", "third"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("  alpha  ")
        composeRule.onNodeWithText("alpha").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("beta").assertIsDisplayed()

        composeRule.onNode(hasSetTextAction()).performTextInput("ga")
        composeRule.onNodeWithText("gamma").assertIsDisplayed()
        composeRule.onNodeWithText("alpha").assertDoesNotExist()
    }

    @Test
    fun canOpenSortMenuWhenFilterHasNoMatch() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:blue", "blue", "color"),
                    word("en:red", "red", "color"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("absent")
        composeRule.onNodeWithText("No words match “absent”.").assertIsDisplayed()
        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        composeRule.onNodeWithText("Count").assertIsDisplayed()
    }

    private fun word(
        key: String,
        word: String,
        definition: String,
        contextSentence: String = "",
        partOfSpeech: String = "",
        bookTitle: String = "Book",
        lookupCount: Int = 1,
        firstSeenAt: Long = 0L,
        lastSeenAt: Long = 0L,
    ): VocabularyWord = VocabularyWord(
        key = key,
        word = word,
        language = "en",
        syncId = "sync-$key",
        bookId = "book-$key",
        bookTitle = bookTitle,
        cfi = "cfi://$key",
        contextSentence = contextSentence,
        partOfSpeech = partOfSpeech,
        definitionsJson = JSONArray(listOf(definition)).toString(),
        sourceUrl = "",
        lookupCount = lookupCount,
        firstSeenAt = firstSeenAt,
        lastSeenAt = lastSeenAt,
        deleted = false,
    )
}
