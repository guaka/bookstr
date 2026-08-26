package app.bookstr.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenE2EAnotherTenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun clearIconAppearsOnlyWhenFilterIsNotBlank() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:one", "one", "digit"), word("en:two", "two", "digit")),
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
        composeRule.onNodeWithText("Filter words").performTextInput("o")
        composeRule.onNodeWithContentDescription("Clear filter").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithContentDescription("Clear filter").assertDoesNotExist()
    }

    @Test
    fun canReplaceExistingQueryText() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:cat", "cat", "feline"), word("en:dog", "dog", "canine")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("cat")
        composeRule.onNodeWithText("cat").assertIsDisplayed()
        composeRule.onNodeWithText("dog").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Filter words").performTextInput("dog")
        composeRule.onNodeWithText("dog").assertIsDisplayed()
        composeRule.onNodeWithText("cat").assertDoesNotExist()
    }

    @Test
    fun queryCanBeProgrammaticallySetUsingFocusWordAndRetainedAcrossStateRead() {
        val focusWordState = mutableStateOf("first")
        val focusRequestKeyState = mutableStateOf(1)

        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:first", "first", "primary"), word("en:second", "second", "secondary")),
                error = null,
                sortKey = "recent",
                focusWord = focusWordState.value,
                focusRequestKey = focusRequestKeyState.value,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("first")
        composeRule.onNodeWithText("first").assertIsDisplayed()

        composeRule.runOnUiThread {
            focusWordState.value = "second"
            focusRequestKeyState.value += 1
        }
        composeRule.waitForIdle()

        composeRule.onNode(hasSetTextAction()).assertTextEquals("second")
        composeRule.onNodeWithText("second").assertIsDisplayed()
    }

    @Test
    fun sortBookOptionReportsBookSortKey() {
        var selectedSort = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:gamma", "gamma", "third"),
                    word("en:alpha", "alpha", "first"),
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
        composeRule.onNodeWithText("Book, then word").performClick()
        assertEquals("book", selectedSort)
        composeRule.onNodeWithText("Book").assertIsDisplayed()
    }

    @Test
    fun noMatchMessageDisappearsAfterClearWithoutAnyDeletes() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:alpha", "alpha", "first")),
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
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("No words match “missing”.").assertDoesNotExist()
    }

    @Test
    fun errorMessageRemainsWhenFilteringWords() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:alpha", "alpha", "first")),
                error = "Could not fetch words",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Could not fetch words").assertIsDisplayed()
        composeRule.onNodeWithText("Filter words").performTextInput("alpha")
        composeRule.onNodeWithText("alpha").assertIsDisplayed()
        composeRule.onNodeWithText("Could not fetch words").assertIsDisplayed()
    }

    @Test
    fun emptyListShowsEmptyHelpEvenWhenFilterTyped() {
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

        composeRule.onNodeWithText("Select a word while reading. It will be saved here even when no definition is found.")
            .assertIsDisplayed()
        composeRule.onNodeWithText("Filter words").performTextInput("anything")
        composeRule.onNodeWithText("No words match “anything”.").assertDoesNotExist()
    }

    @Test
    fun deleteConfirmationCancelAndThenDeleteWorkInSameSession() {
        var deletedCount = 0
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", "one"),
                    word("en:second", "second", "two"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deletedCount++ },
            )
        }

        composeRule.onNodeWithText("second").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()
        assertEquals(0, deletedCount)

        composeRule.onNodeWithText("second").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        assertEquals(1, deletedCount)
    }

    @Test
    fun deletingFilteredWordClearsFilterWhenDeletedMatchIgnoringCase() {
        var deletedWord: VocabularyWord? = null
        composeRule.setContent {
            val currentWords = remember {
                mutableStateOf(
                    listOf(
                        word("en:first", "first", "one"),
                        word("en:second", "second", "two"),
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
                onDeleteWord = {
                    deletedWord = it
                    currentWords.value = currentWords.value.filterNot { item -> item.key == it.key }
                },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("FIRST")
        composeRule.onNodeWithText("first").assertIsDisplayed()
        composeRule.onNodeWithText("first").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:first", deletedWord?.key)
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("second").assertIsDisplayed()
    }

    @Test
    fun shouldClearWordFilterRejectsPartialMatchAndCaseChange() {
        assertTrue(shouldClearWordFilter("hello", "hello"))
        assertTrue(shouldClearWordFilter(" HELLO ", "hello"))
        assertFalse(shouldClearWordFilter("ello", "hello"))
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
