package app.bookstr.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenE2EAdditionalTenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun filterCanMatchByDefinitionIgnoringCase() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", definition = "A FRUIT."),
                    word("en:rock", "rock", definition = "A solid piece of stone."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("fruit")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("rock").assertDoesNotExist()
    }

    @Test
    fun filterCanMatchContextIgnoringCase() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:light", "light", definition = "a lamp", contextSentence = "The Light was bright."),
                    word("en:dark", "dark", definition = "absence", contextSentence = "The room is Dark tonight."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("DARK")
        composeRule.onNodeWithText("dark").assertIsDisplayed()
        composeRule.onNodeWithText("light").assertDoesNotExist()
    }

    @Test
    fun filterShowsNoMatchMessageAndThenRestoresWhenMatchFound() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:river", "river", definition = "flow"),
                    word("en:stone", "stone", definition = "rock"),
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
        composeRule.onNodeWithText("Filter words").performTextInput("river")
        composeRule.onNodeWithText("No words match “absent”.").assertDoesNotExist()
        composeRule.onNodeWithText("river").assertIsDisplayed()
    }

    @Test
    fun sortSelectionPublishesAlphabeticalKey() {
        var selectedSort = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:beta", "beta", definition = "second"),
                    word("en:alpha", "alpha", definition = "first"),
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
    }

    @Test
    fun sortSelectionPublishesFirstSavedKey() {
        var selectedSort = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:beta", "beta", definition = "second", firstSeenAt = 10L),
                    word("en:alpha", "alpha", definition = "first", firstSeenAt = 1L),
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
        composeRule.onNodeWithText("First saved").performClick()
        assertEquals("first", selectedSort)
    }

    @Test
    fun sortSelectionPublishesMostSeenKey() {
        var selectedSort = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:beta", "beta", definition = "second", lookupCount = 1),
                    word("en:alpha", "alpha", definition = "first", lookupCount = 99),
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
        assertEquals("count", selectedSort)
    }

    @Test
    fun filterCanBeClearedWithClearIconAndWordListReturns() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:dog", "dog", definition = "bark"),
                    word("en:cat", "cat", definition = "meow"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("zzz")
        composeRule.onNodeWithText("No words match “zzz”.").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("dog").assertIsDisplayed()
        composeRule.onNodeWithText("cat").assertIsDisplayed()
    }

    @Test
    fun errorStateStillAllowsFilterAndOpen() {
        var opened: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:hello", "hello", definition = "A greeting.")),
                error = "Sync failed",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Sync failed").assertIsDisplayed()
        composeRule.onNodeWithText("Filter words").performTextInput("hello")
        composeRule.onNodeWithText("hello").performClick()
        assertEquals("en:hello", opened?.key)
    }

    @Test
    fun openWordCallbackIsInvokedForFirstInListAfterFilterAndSort() {
        var opened: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", definition = "first", lookupCount = 1),
                    word("en:two", "two", definition = "second", lookupCount = 99),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("o")
        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        composeRule.onNodeWithText("one").performClick()
        assertEquals("en:one", opened?.key)
    }

    @Test
    fun focusWordSeedsFilterOnCompose() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:focus", "focus", definition = "concentrate")),
                error = null,
                sortKey = "recent",
                focusWord = "focus",
                focusRequestKey = 1,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("focus")
        composeRule.onNodeWithText("focus").assertIsDisplayed()
    }

    @Test
    fun focusWordCanBeUpdatedByRecompositionAndRetainsTrimmedValue() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", definition = "first"),
                    word("en:second", "second", definition = "second"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "   second   ",
                focusRequestKey = 5,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("   second   ")

        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", definition = "first"),
                    word("en:second", "second", definition = "second"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "third",
                focusRequestKey = 6,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("third")
    }

    @Test
    fun deleteWordConfirmationCanBeCancelled() {
        var openRequested = false
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:delete", "delete", definition = "remove")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { openRequested = true },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("delete").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove word?").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.onNodeWithText("delete").assertIsDisplayed()
        assertFalse(openRequested)
    }

    @Test
    fun deleteConfirmationThenConfirmClearsFilterAndDeletesWord() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            val currentWords = remember {
                mutableStateOf(
                    listOf(
                        word("en:alpha", "alpha", definition = "first"),
                        word("en:beta", "beta", definition = "second"),
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
                    deleted = it
                    currentWords.value = currentWords.value.filterNot { candidate -> candidate.key == it.key }
                },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("alpha")
        composeRule.onNodeWithText("alpha").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:alpha", deleted?.key)
        composeRule.onNodeWithText("alpha").assertDoesNotExist()
        composeRule.onNodeWithText("beta").assertIsDisplayed()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
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
