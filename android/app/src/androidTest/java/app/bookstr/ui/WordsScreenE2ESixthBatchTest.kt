package app.bookstr.ui

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
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
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WordsScreenE2ESixthBatchTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun unknownSortKeyFallsBackToRecentSort() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:new", "new", definition = "recent", lastSeenAt = 40L),
                    word("en:old", "old", definition = "historical", lastSeenAt = 1L),
                ),
                error = null,
                sortKey = "not-a-real-key",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").assertIsDisplayed()
        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertEquals("count", selected)
        composeRule.onNodeWithText("new").assertIsDisplayed()
    }

    @Test
    fun focusWordSpacesAreTrimmedForMatching() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", definition = "A fruit."),
                    word("en:pear", "pear", definition = "A fruit."),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "  apple  ",
                focusRequestKey = 1,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("  apple  ")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("pear").assertDoesNotExist()
    }

    @Test
    fun focusWordCanChangeWithFocusRequestKey() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:alpha", "alpha", definition = "first"),
                    word("en:bravo", "bravo", definition = "second"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "alpha",
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }
        composeRule.onNode(hasSetTextAction()).assertTextEquals("alpha")

        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:alpha", "alpha", definition = "first"),
                    word("en:bravo", "bravo", definition = "second"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "bravo",
                focusRequestKey = 1,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }
        composeRule.onNode(hasSetTextAction()).assertTextEquals("bravo")
        composeRule.onNodeWithText("bravo").assertIsDisplayed()
    }

    @Test
    fun filterCanMatchContextOrDefinitionAndClearFilterFromNoMatch() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:light", "light", definition = "a lamp", context = "The room is dim."),
                    word("en:heavy", "heavy", definition = "weight", context = "The heavy load."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("dim")
        composeRule.onNodeWithText("light").assertIsDisplayed()
        composeRule.onNodeWithText("heavy").assertDoesNotExist()
        composeRule.onNodeWithText("Filter words").performTextInput("  ")
        composeRule.onNodeWithText("light").assertIsDisplayed()
        composeRule.onNodeWithText("heavy").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("light").assertIsDisplayed()
        composeRule.onNodeWithText("heavy").assertIsDisplayed()
    }

    @Test
    fun deleteConfirmationCanBeCancelledAndListRemains() {
        val words = mutableStateOf(
            listOf(
                word("en:rose", "rose", definition = "flower"),
                word("en:tulip", "tulip", definition = "flower"),
            ),
        )

        composeRule.setContent {
            WordsScreen(
                words = words.value,
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { wordToDelete -> words.value = words.value.filterNot { it.key == wordToDelete.key } },
            )
        }

        composeRule.onNodeWithText("rose").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.onNodeWithText("rose").assertIsDisplayed()
        composeRule.onNodeWithText("tulip").assertIsDisplayed()
    }

    @Test
    fun sortingPersistsAfterFilterChange() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:two", "two", definition = "b", lastSeenAt = 3L, firstSeenAt = 20L),
                    word("en:one", "one", definition = "a", lastSeenAt = 7L, firstSeenAt = 10L),
                    word("en:three", "three", definition = "c", lastSeenAt = 1L, firstSeenAt = 30L),
                ),
                error = null,
                sortKey = "first",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("o")
        composeRule.onNodeWithText("one").assertIsDisplayed()
        composeRule.onNodeWithText("two").assertDoesNotExist()
        composeRule.onNodeWithText("three").assertDoesNotExist()

        composeRule.onNodeWithText("First").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()
        composeRule.onNodeWithText("one").assertIsDisplayed()
        composeRule.onNodeWithText("two").assertDoesNotExist()
    }

    @Test
    fun errorStateDoesNotBlockDeleteFlow() {
        var removed: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:one", "one", definition = "first")),
                error = "Could not sync",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { removed = it },
            )
        }

        composeRule.onNodeWithText("Could not sync").assertIsDisplayed()
        composeRule.onNodeWithText("one").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        assertEquals("en:one", removed?.key)
    }

    @Test
    fun listCanShowMultipleMatchesAcrossDefinitionAndWordFields() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:moon", "moon", definition = "A celestial body"),
                    word("en:sun", "sun", definition = "A glowing sphere", context = "The sun is hot"),
                    word("en:night", "night", definition = "The moon is visible"),
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
        composeRule.onNodeWithText("night").assertIsDisplayed()
        composeRule.onNodeWithText("sun").assertDoesNotExist()
    }

    @Test
    fun clearIconAppearsForQueryAndClearsOnTap() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:rain", "rain", definition = "water"),
                    word("en:sun", "sun", definition = "heat"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("ri")
        composeRule.onNodeWithContentDescription("Clear filter").assertIsDisplayed()
        composeRule.onNodeWithText("rain").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Filter words").assertIsDisplayed()
        composeRule.onNodeWithText("rain").assertIsDisplayed()
        composeRule.onNodeWithText("sun").assertIsDisplayed()
    }

    @Test
    fun removeFilteredWordClearsFilterOnlyForExactMatch() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", definition = "red"),
                    word("en:applaud", "applaud", definition = "clap"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("app")
        composeRule.onNodeWithText("applaud").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        composeRule.onNode(hasSetTextAction()).assertTextEquals("app")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("applaud").assertDoesNotExist()
        assertEquals("en:applaud", deleted?.key)
    }

    @Test
    fun deleteFilteredExactMatchClearsFilter() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", definition = "red"),
                    word("en:apricot", "apricot", definition = "yellow"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("  Apple ")
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:apple", deleted?.key)
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("apricot").assertIsDisplayed()
        composeRule.onNodeWithText("apple").assertDoesNotExist()
        composeRule.onNodeWithText("No words match").assertDoesNotExist()
    }

    @Test
    fun canFilterByContextWithSortMenuOpen() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:brook", "brook", definition = "stream"),
                    word("en:forest", "forest", definition = "woodland"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("stream")
        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()
        composeRule.onNodeWithText("brook").assertIsDisplayed()
        composeRule.onNodeWithText("forest").assertDoesNotExist()
    }

    @Test
    fun noMatchTextDisappearsAfterDeleteMatch() {
        composeRule.setContent {
            val current = remember {
                mutableStateOf(
                    listOf(
                        word("en:apple", "apple", definition = "red"),
                        word("en:apricot", "apricot", definition = "yellow"),
                    ),
                )
            }
            WordsScreen(
                words = current.value,
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { wordToDelete -> current.value = current.value.filterNot { it.key == wordToDelete.key } },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("x")
        composeRule.onNodeWithText("No words match “x”.").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        composeRule.onNodeWithText("No words match “apple”.").assertDoesNotExist()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("apricot").assertIsDisplayed()
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
