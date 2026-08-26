package app.bookstr.ui

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenE2EFourthBatchTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun clearIconIsNotVisibleBeforeTyping() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:one", "one", "first")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithContentDescription("Clear filter").assertDoesNotExist()
    }

    @Test
    fun clearIconAppearsAfterTypingAndCanBeUsed() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:one", "one", "first")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("o")
        composeRule.onNodeWithContentDescription("Clear filter").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
    }

    @Test
    fun queryWithLeadingAndTrailingWhitespaceStillFilters() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:omega", "omega", "end"),
                    word("en:alpha", "alpha", "start"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("  omega  ")
        composeRule.onNodeWithText("omega").assertIsDisplayed()
        composeRule.onNodeWithText("alpha").assertDoesNotExist()
    }

    @Test
    fun filterCaseInsensitiveByContextAndThenSortChange() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:night", "night", "A dark hour", contextSentence = "The Night was calm."),
                    word("en:day", "day", "A bright hour", contextSentence = "It was a DAY of sunshine."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("night")
        composeRule.onNodeWithText("night").assertIsDisplayed()
        composeRule.onNodeWithText("day").assertDoesNotExist()

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("First saved").performClick()

        composeRule.onNodeWithText("night").assertIsDisplayed()
        composeRule.onNodeWithText("day").assertDoesNotExist()
    }

    @Test
    fun canSwitchToCountFromRecentThenOpenFilteredWord() {
        var openedWord: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:cat", "cat", "pet"),
                    word("en:dog", "dog", "pet"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("pet")
        composeRule.onNodeWithText("cat").assertIsDisplayed()

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()

        composeRule.onNodeWithText("cat").performClick()
        assertEquals("en:cat", openedWord?.key)
    }

    @Test
    fun removeDialogCanBeCancelledAndWordStillVisible() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:river", "river", "water"),
                    word("en:lake", "lake", "water"),
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

        composeRule.onNodeWithText("river").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.onNodeWithText("river").assertIsDisplayed()
    }

    @Test
    fun errorDoesNotHideWordListOrFilterResults() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:moon", "moon", "light")),
                error = "Failed to sync",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Failed to sync").assertIsDisplayed()
        composeRule.onNodeWithText("Filter words").performTextInput("moon")
        composeRule.onNodeWithText("moon").assertIsDisplayed()
        composeRule.onNodeWithText("Failed to sync").assertIsDisplayed()
    }

    @Test
    fun queryNoResultsDoesNotCrashAfterOpeningSortMenu() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:moon", "moon", "light"),
                    word("en:star", "star", "sky"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("missing")
        composeRule.onNodeWithText("No words match “missing”.").assertIsDisplayed()

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()

        composeRule.onNodeWithText("No words match “missing”.").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("moon").assertIsDisplayed()
    }

    @Test
    fun deleteFilteredWordIsActuallyRemovedAndListUpdates() {
        var removed: VocabularyWord? = null
        composeRule.setContent {
            val words = remember {
                mutableStateOf(
                    listOf(
                        word("en:red", "red", "color"),
                        word("en:blue", "blue", "color"),
                    ),
                )
            }
            WordsScreen(
                words = words.value,
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {
                    removed = it
                    words.value = words.value.filterNot { word -> word.key == it.key }
                },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("red")
        composeRule.onNodeWithText("red").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:red", removed?.key)
        composeRule.onNodeWithText("red").assertDoesNotExist()
    }

    @Test
    fun shouldClearWordFilterMatchesTrimmedQueryAndCaseInsensitive() {
        assertTrue(shouldClearWordFilter("  hello ", "Hello"))
        assertTrue(shouldClearWordFilter("HELLO", "hello"))
        assertFalse(shouldClearWordFilter("hell", "hello"))
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
