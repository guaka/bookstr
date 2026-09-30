package app.bookstr.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.Before

class MainNavigationTest {
    @get:Rule val compose = createComposeRule()

    @Before fun showMainNavigation() {
        compose.setContent {
            var selectedTab by remember { mutableIntStateOf(0) }
            BookstrNavigationBar(selectedTab) { selectedTab = it }
        }
    }

    @Test fun fourTabsMatchIosOrderAndNavigate() {
        val tabs = listOf("library", "search", "words", "settings")
        compose.onAllNodes(hasClickAction() and hasAnyAncestor(hasTestTag("navigation.bar")))
            .assertCountEquals(4)
        val centers = tabs.map { name ->
            compose.onNodeWithTag("tab.$name").assertIsDisplayed()
                .fetchSemanticsNode().boundsInRoot.center.x
        }
        assertTrue(centers.zipWithNext().all { (left, right) -> left < right })
        compose.onNodeWithContentDescription("Continue reading").assertDoesNotExist()

        tabs.forEach { name ->
            compose.onNodeWithTag("tab.$name").performClick().assertIsSelected()
        }
    }

    @Test fun navigationIconsUseTabletSizeOnTablet() {
        val widthDp = ApplicationProvider.getApplicationContext<Context>()
            .resources.configuration.smallestScreenWidthDp
        val expectedIconDp = if (widthDp >= 600) 32 else 24
        val icon = compose.onNodeWithContentDescription("Library", useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        val bar = compose.onNodeWithTag("navigation.bar").fetchSemanticsNode().boundsInRoot
        val pixelsPerDp = compose.density.density
        assertEquals(expectedIconDp * pixelsPerDp, icon.width, pixelsPerDp)
        assertEquals((if (widthDp >= 600) 64 else 56) * pixelsPerDp, bar.height, pixelsPerDp)
    }
}
