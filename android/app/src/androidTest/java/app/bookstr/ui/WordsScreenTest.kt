package app.bookstr.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNode
import androidx.compose.ui.test.onAllNodesWithText
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
        composeRule.onAllNodesWithText("zebra").assertCountEquals(0)

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

    @Test
    fun emptyWordsStateAndErrorAreBothVisible() {
        composeRule.setContent {
            WordsScreen(
                words = emptyList(),
                error = "Could not sync words",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Could not sync words").assertIsDisplayed()
        composeRule.onNodeWithText(
            "Select a word while reading. It will be saved here even when no definition is found.",
        ).assertIsDisplayed()
    }

    @Test
    fun showsNoMatchesWhenFilterFindsNothing() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "count"),
                    word("en:two", "two", "number"),
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
    }

    @Test
    fun filtersWordsByContextSentence() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:light", "light", "a lamp", context = "The light was bright."),
                    word("en:dark", "dark", "absence", context = "The night was dark and still."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("bright")
        composeRule.onNodeWithText("light").assertIsDisplayed()
        composeRule.onNodeWithText("dark").assertDoesNotExist()
    }

    @Test
    fun filtersWordsByDefinition() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit used in pies.", context = "I ate an apple."),
                    word("en:stone", "stone", "A solid mineral.", context = "The stone was heavy."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("mineral")
        composeRule.onNodeWithText("stone").assertIsDisplayed()
        composeRule.onNodeWithText("apple").assertDoesNotExist()
    }

    @Test
    fun filtersWordsByBookTitle() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word(
                        key = "en:grace",
                        text = "grace",
                        definition = "A gesture of favor.",
                        bookTitle = "Grammar Guide",
                    ),
                    word("en:river", "river", "A body of water."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("grammar")
        composeRule.onNodeWithText("grace").assertIsDisplayed()
        composeRule.onNodeWithText("river").assertDoesNotExist()
    }

    @Test
    fun selectingSortOptionReportsMostSeenSort() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "digit"),
                    word("en:two", "two", "digit"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertEquals("count", selected)
    }

    @Test
    fun selectingSortOptionReportsBookSort() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "digit"),
                    word("en:two", "two", "digit"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Book, then word").performClick()
        assertEquals("book", selected)
    }

    @Test
    fun selectingSortOptionReportsFirstSavedSort() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "digit"),
                    word("en:two", "two", "digit"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("First saved").performClick()
        assertEquals("first", selected)
    }

    @Test
    fun selectingSortOptionReportsMostFrequentAfterRecentSortState() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "digit"),
                    word("en:two", "two", "digit"),
                ),
                error = null,
                sortKey = "book",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Book").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertEquals("count", selected)
    }

    @Test
    fun focusWordPrefillsFilterWhenProvided() {
        var open = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:focus", "focus", "concentrate"),
                    word("en:other", "other", "else"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "focus",
                focusRequestKey = 7,
                onSortChange = {},
                onOpenWord = { open = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNode(hasSetTextAction()).assertTextEquals("focus")
        composeRule.onNodeWithText("focus").performClick()
        assertEquals("en:focus", open)
    }

    @Test
    fun wordsWithoutDefinitionsShowNoDefinitionText() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    VocabularyWord(
                        key = "en:empty",
                        word = "empty",
                        language = "en",
                        syncId = "empty",
                        bookId = "book-2",
                        bookTitle = "Test book",
                        cfi = "epubcfi(/6/2)",
                        contextSentence = "An empty definition.",
                        partOfSpeech = "noun",
                        definitionsJson = "[]",
                        sourceUrl = "https://en.wiktionary.org/wiki/empty",
                        lookupCount = 2,
                        firstSeenAt = 1L,
                        lastSeenAt = 1L,
                        deleted = false,
                    )
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

        composeRule.onNodeWithText("No definition found").assertIsDisplayed()
    }

    @Test
    fun filterCanBeClearedFromNoMatchState() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", "alpha"),
                    word("en:second", "second", "beta"),
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
        composeRule.onNodeWithText("first").assertIsDisplayed()
        composeRule.onNodeWithText("second").assertIsDisplayed()
    }

    @Test
    fun canCancelDeleteWithoutRemovingWord() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:apple", "apple", "fruit")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()
        assertEquals(null, deleted)
        composeRule.onNodeWithText("apple").assertIsDisplayed()
    }

    @Test
    fun sortSelectionCanSwitchBetweenRecentAndCountFromDifferentStartPoint() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "a"),
                    word("en:two", "two", "b"),
                ),
                error = null,
                sortKey = "first",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("First").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        assertEquals("count", selected)
    }

    @Test
    fun filtersAreCaseInsensitiveForWordQuery() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:MiXeD", "MiXeD", "definition")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("mixed")
        composeRule.onNodeWithText("MiXeD").assertIsDisplayed()
    }

    @Test
    fun tappingFilteredWordOpensIt() {
        var opened: VocabularyWord? = null

        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:hello", "hello", "greeting"),
                    word("en:world", "world", "planet"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("wor")
        composeRule.onNodeWithText("world").performClick()
        assertEquals("en:world", opened?.key)
    }

    @Test
    fun removingFilteredWordClearsFilterIfItMatchesCurrentQuery() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:river", "river", "A stream."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()

        assertEquals("en:apple", deleted?.key)
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("river").assertIsDisplayed()
    }

    @Test
    fun errorAndNoMatchMessagesCanCoexist() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", "alpha"),
                    word("en:second", "second", "beta"),
                ),
                error = "sync failed",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("absent")
        composeRule.onNodeWithText("sync failed").assertIsDisplayed()
        composeRule.onNodeWithText("No words match “absent”.").assertIsDisplayed()
    }

    @Test
    fun filterCanBeClearedAfterDeletingDifferentWord() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:apricot", "apricot", "A yellow fruit."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("ap")
        composeRule.onNodeWithText("apricot").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("ap")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("apricot").assertDoesNotExist()
    }

    @Test
    fun canSwitchSortThenOpenWordFromResultList() {
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:zeta", "zeta", "after"),
                    word("en:alpha", "alpha", "before"),
                    word("en:omega", "omega", "last"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Book, then word").performClick()
        composeRule.onNodeWithText("alpha").performClick()
        assertEquals("en:alpha", opened)
    }

    @Test
    fun filtersTrimInputAndCanBeClearedFromMatchedState() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:zebra", "zebra", "An animal."),
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

        composeRule.onNode(hasSetTextAction()).performTextInput("  APPLE ")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("zebra").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("zebra").assertIsDisplayed()
    }

    @Test
    fun clearFilterButtonIsHiddenUntilTextIsEntered() {
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
        composeRule.onNodeWithText("Filter words").performTextInput("one")
        composeRule.onNodeWithContentDescription("Clear filter").assertIsDisplayed()
    }

    @Test
    fun focusWordWithoutAnyMatchShowsNoWordsMessage() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:first", "first", "alpha"),
                    word("en:second", "second", "beta"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "missing",
                focusRequestKey = 8,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("No words match “missing”.").assertIsDisplayed()
    }

    @Test
    fun emptyWordListShowsErrorAndEmptyCopyTogether() {
        composeRule.setContent {
            WordsScreen(
                words = emptyList(),
                error = "sync failed",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("sync failed").assertIsDisplayed()
        composeRule.onNodeWithText(
            "Select a word while reading. It will be saved here even when no definition is found.",
        ).assertIsDisplayed()
    }

    @Test
    fun selectingSortOptionReportsAlphabeticalFromCount() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:z", "zebra", "A striped animal"),
                    word("en:a", "apple", "A fruit"),
                ),
                error = null,
                sortKey = "count",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Count").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()
        assertEquals("alphabetical", selected)
    }

    @Test
    fun selectingSortOptionReportsRecentFromFirstSavedState() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:z", "zebra", "A striped animal"),
                    word("en:a", "apple", "A fruit"),
                ),
                error = null,
                sortKey = "first",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("First").performClick()
        composeRule.onNodeWithText("Recently seen").performClick()
        assertEquals("recent", selected)
    }

    @Test
    fun canOpenWordFromMostFrequentSortSelection() {
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:zeta", "zeta", "after"),
                    word("en:alpha", "alpha", "before"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Most frequently seen").performClick()
        composeRule.onNodeWithText("zeta").performClick()
        assertEquals("en:zeta", opened)
    }

    @Test
    fun deletingFilteredWordDoesNotClearFilterWhenNotAnExactMatch() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:apricot", "apricot", "A fruit."),
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
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        assertEquals("en:apple", deleted?.key)
        composeRule.onNode(hasSetTextAction()).assertTextEquals("app")
        composeRule.onNodeWithText("apple").assertDoesNotExist()
        composeRule.onNodeWithText("apricot").assertIsDisplayed()
    }

    @Test
    fun deletingFilteredWordClearsFilterWhenWordMatchesIgnoringCaseAndWhitespace() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:apricot", "apricot", "A fruit."),
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
    }

    @Test
    fun selectingSortCanMoveFromAlphabeticalToBookSortAndStillOpenWord() {
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:zeta", "zeta", "after"),
                    word("en:alpha", "alpha", "before"),
                    word("en:omega", "omega", "last"),
                ),
                error = null,
                sortKey = "alphabetical",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("A–Z").performClick()
        composeRule.onNodeWithText("Book, then word").performClick()
        composeRule.onNodeWithText("alpha").performClick()
        assertEquals("en:alpha", opened)
    }

    @Test
    fun filterCanBeClearedAfterCancellingDelete() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:alpha", "alpha", "a"),
                    word("en:apollo", "apollo", "b"),
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

        composeRule.onNodeWithText("Filter words").performTextInput("ap")
        composeRule.onNodeWithText("apollo").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("ap")
        composeRule.onNodeWithText("alpha").assertIsDisplayed()
        composeRule.onNodeWithText("apollo").assertIsDisplayed()
    }

    @Test
    fun filterMatchesContextCaseInsensitively() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:moon", "moon", "A sphere"),
                    word("en:sun", "sun", "A bright star", context = "The Sun rises."),
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

        composeRule.onNodeWithText("Filter words").performTextInput("SUN")
        composeRule.onNodeWithText("sun").assertIsDisplayed()
        composeRule.onNodeWithText("moon").assertDoesNotExist()
    }

    @Test
    fun filterCanToggleBetweenNoMatchAndMatch() {
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:apple", "apple", "A fruit."),
                    word("en:pear", "pear", "A fruit."),
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
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").assertIsDisplayed()
        composeRule.onNodeWithText("pear").assertDoesNotExist()
    }

    @Test
    fun errorStateStillSupportsWordOpen() {
        var opened: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:hello", "hello", "greeting")),
                error = "sync failed",
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = { opened = it },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("sync failed").performClick()
        composeRule.onNodeWithText("hello").performClick()
        assertEquals("en:hello", opened?.key)
    }

    @Test
    fun sortCanChangeToBookAndThenOpenWord() {
        var selected = ""
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:z", "zebra", "A striped animal", bookTitle = "Alpha"),
                    word("en:a", "apple", "A fruit", bookTitle = "Beta"),
                    word("en:m", "mango", "A fruit", bookTitle = "Alpha"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("Book, then word").performClick()
        assertEquals("book", selected)
        composeRule.onNodeWithText("apple").performClick()
        assertEquals("en:a", opened)
    }

    @Test
    fun sortCanChangeFromFirstToAlphabeticalAndOpenWord() {
        var selected = ""
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:z", "zebra", "A striped animal"),
                    word("en:a", "apple", "A fruit"),
                    word("en:m", "mango", "A fruit"),
                ),
                error = null,
                sortKey = "first",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("First").performClick()
        composeRule.onNodeWithText("Alphabetical (A–Z)").performClick()
        assertEquals("alphabetical", selected)
        composeRule.onNodeWithText("apple").performClick()
        assertEquals("en:a", opened)
    }

    @Test
    fun emptyWordsListShowsEmptyCopyWithoutNoMatchMessage() {
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

        composeRule.onNodeWithText("Filter words").performTextInput("any")
        composeRule.onNodeWithText(
            "Select a word while reading. It will be saved here even when no definition is found.",
        ).assertIsDisplayed()
        composeRule.onNodeWithText("No words match “any”.").assertDoesNotExist()
    }

    @Test
    fun openWordRemainsOpenableAfterFilterIsSetByFocusWord() {
        var opened: String? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:focus", "focus", "a point"),
                    word("en:other", "other", "another"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = "focus",
                focusRequestKey = 1,
                onSortChange = {},
                onOpenWord = { opened = it.key },
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("focus").performClick()
        assertEquals("en:focus", opened)
    }

    @Test
    fun queryCanBeClearedAfterDeletingLastFilteredWord() {
        var deleted: VocabularyWord? = null
        composeRule.setContent {
            WordsScreen(
                words = listOf(word("en:apple", "apple", "A fruit.")),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = {},
                onOpenWord = {},
                onDeleteWord = { deleted = it },
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("apple")
        composeRule.onNodeWithText("apple").performTouchInput { swipeLeft() }
        composeRule.onNodeWithText("Remove").performClick()
        assertEquals("en:apple", deleted?.key)
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText(
            "Select a word while reading. It will be saved here even when no definition is found.",
        ).assertIsDisplayed()
    }

    @Test
    fun sortMenuCanOpenFromMostSeenState() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:one", "one", "A"),
                    word("en:two", "two", "B"),
                ),
                error = null,
                sortKey = "count",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Count").performClick()
        composeRule.onNodeWithText("Most frequently seen").assertDoesNotExist()
        composeRule.onNodeWithText("Recently seen").performClick()
        assertEquals("recent", selected)
    }

    @Test
    fun sortingAndClearingFilterMaintainQueryAndCallback() {
        var selected = ""
        composeRule.setContent {
            WordsScreen(
                words = listOf(
                    word("en:red", "red", "a color", bookTitle = "B"),
                    word("en:blue", "blue", "a color", bookTitle = "A"),
                ),
                error = null,
                sortKey = "recent",
                focusWord = null,
                focusRequestKey = 0,
                onSortChange = { selected = it },
                onOpenWord = {},
                onDeleteWord = {},
            )
        }

        composeRule.onNodeWithText("Filter words").performTextInput("e")
        composeRule.onNodeWithText("Recent").performClick()
        composeRule.onNodeWithText("First saved").performClick()
        assertEquals("first", selected)
        composeRule.onNodeWithContentDescription("Clear filter").performClick()
        composeRule.onNode(hasSetTextAction()).assertTextEquals("")
        composeRule.onNodeWithText("red").assertIsDisplayed()
        composeRule.onNodeWithText("blue").assertIsDisplayed()
    }

    private fun word(
        key: String,
        text: String,
        definition: String,
        context: String = "",
        bookTitle: String = "Test book",
    ) = VocabularyWord(
        key = key,
        word = text,
        language = "en",
        syncId = key,
        bookId = "book-1",
        bookTitle = bookTitle,
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
