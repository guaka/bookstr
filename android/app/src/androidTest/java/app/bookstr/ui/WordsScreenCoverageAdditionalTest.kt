package app.bookstr.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenCoverageAdditionalTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun filterCanBeClearedWhenNoMatches() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word(key = "en:apple", word = "apple", definition = "A fruit."),
                    word(key = "en:zebra", word = "zebra", definition = "A striped animal."),
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
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("zebra").assertIsDisplayed()
    }

    @Test
    fun deletingFilterMatchClearsQueryAndRemovesWordFromList() {
        var deletedWord: VocabularyWord? = null

        composeRule.setContent {
            val currentWords = remember {
                mutableStateOf(
                    listOf(
                        word("en:apple", "apple", definition = "A fruit."),
                        word("en:zebra", "zebra", definition = "A striped animal."),
                    ),
                )
            }
            WordsScreen(
                words = currentWords.value,
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deletedWord = it; currentWords.value = currentWords.value.filterNot { word -> word.key == it.key } },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertTrue(deletedWord?.word == "apple")
        composeRule.onNodeWithText("apple").assertDoesNotExist()
        composeRule.onNodeWithText("zebra").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("No words match").assertDoesNotExist()
    }

    @Test
    fun focusWordSeedsFilterWhenSet() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:gamma", "gamma", definition = "Third letter.")),
                error = null,
                sortKey = "recent",
                focusWord = "gamma",
                focusRequestKey = 42,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("gamma")
        composeRule.onNodeWithText("gamma").assertIsDisplayed()
    }

    @Test
    fun canSelectMostSeenSort() {
        var selectedSort: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:beta", "beta", definition = "Second."),
                    word("en:alpha", "alpha", definition = "First."),
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
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertTrue(selectedSort == "count")
        composeRule.onNodeWithText("Count").assertIsDisplayed()
    }

    @Test
    fun shouldClearWordFilterMatchesOnlyTrimmedAndCaseInsensitiveWord() {
        assertTrue(shouldClearWordFilter("  Hello", "hello"))
        assertTrue(shouldClearWordFilter("hello", "HELLO"))
        assertFalse(shouldClearWordFilter("hello there", "hello"))
        assertFalse(shouldClearWordFilter("hell", "hello"))
    }

    @Test
    fun canHandleBlankQueryAndManyWordsForMostSeenSelectionWithCountMenuState() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:stone", "stone", definition = "A mineral.", lookupCount = 5, lastSeenAt = 10),
                    word("en:water", "water", definition = "A liquid.", lookupCount = 1, lastSeenAt = 20),
                ),
                error = null,
                sortKey = "count",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Count").assertIsDisplayed()
        composeRule.onAllNodesWithText("stone").assertCountEquals(1)
        composeRule.onAllNodesWithText("water").assertCountEquals(1)
    }
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
