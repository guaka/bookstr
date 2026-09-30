package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReaderBottomNavigationTest {
    @get:Rule val compose = createComposeRule()

    @Test fun tappingBottomRevealsFourDestinationsAndSelectsOne() {
        var selected = -1
        compose.setContent { ReaderBottomNavigation(onSelectTab = { selected = it }) }
        compose.onNodeWithTag("navigation.bar").assertDoesNotExist()
        compose.onNodeWithTag("reader.show-navigation").performClick()
        compose.onNodeWithTag("navigation.bar").assertIsDisplayed()
        compose.onNodeWithTag("tab.library").assertIsDisplayed()
        compose.onNodeWithTag("tab.search").assertIsDisplayed()
        compose.onNodeWithTag("tab.words").assertIsDisplayed()
        compose.onNodeWithTag("tab.settings").performClick()
        compose.runOnIdle { assertEquals(2, selected) }
    }

    @Test fun authorInReaderHeaderOpensSearchForThatAuthor() {
        var selected = ""
        compose.setContent {
            ReaderHeaderText("Fixture book", "Octavia Butler", "1987", onAuthorClick = { selected = it })
        }
        compose.onNodeWithTag("reader.author").performClick()
        compose.runOnIdle { assertEquals("Octavia Butler", selected) }
    }
}
