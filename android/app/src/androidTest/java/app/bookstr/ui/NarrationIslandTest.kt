package app.bookstr.ui

import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.NarrationService
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.SemanticsActions
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NarrationIslandTest {
    @get:Rule val compose = createComposeRule()

    @Test fun islandTracksPlaybackWhileMountedOutsideReader() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var speedChange: Pair<String, Float>? = null
        compose.setContent { NarrationIsland(onSpeedChange = { language, rate -> speedChange = language to rate }) }
        compose.onNodeWithTag("narration.island").assertDoesNotExist()
        fun publish(active: Boolean, playing: Boolean) {
            context.sendBroadcast(
                Intent(NarrationService.ACTION_EVENT).setPackage(context.packageName)
                    .putExtra(NarrationService.EXTRA_SESSION_ACTIVE, active)
                    .putExtra(NarrationService.EXTRA_IS_PLAYING, playing)
                    .putExtra(NarrationService.EXTRA_IS_PREPARING, false)
                    .putExtra(NarrationService.EXTRA_BOOK_ID, "fixture-id")
                    .putExtra(NarrationService.EXTRA_BOOK_TITLE, "Fixture book")
                    .putExtra("language", "en")
                    .putExtra("rate", 0.52f),
            )
        }
        publish(true, true)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Fixture book").assertExists()
        compose.onNodeWithTag("narration.speed").assertExists()
        compose.onNodeWithContentDescription("Reading speed").assert(
            SemanticsMatcher.expectValue(
                SemanticsProperties.ProgressBarRangeInfo,
                ProgressBarRangeInfo(0.52f, 0.35f..0.60f),
            ),
        )
        compose.onNodeWithTag("narration.speed").performSemanticsAction(SemanticsActions.SetProgress) { it(0.40f) }
        compose.waitUntil(5_000) { speedChange != null }
        assertEquals("en", speedChange?.first)
        assertEquals(true, (speedChange?.second ?: 0.52f) < 0.52f)
        compose.onNodeWithContentDescription("Pause narration").assertExists()
        publish(true, false)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithContentDescription("Resume narration").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Resume narration").assertExists()
        publish(false, false)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isEmpty()
        }
    }

    @Test fun islandShowsAccessiblePreparationAndOpensTheActiveBook() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        var opened: List<String>? = null
        compose.setContent { NarrationIsland(onOpenBook = { id, title, author -> opened = listOf(id, title, author) }) }
        context.sendBroadcast(
            Intent(NarrationService.ACTION_EVENT).setPackage(context.packageName)
                .putExtra(NarrationService.EXTRA_SESSION_ACTIVE, true)
                .putExtra(NarrationService.EXTRA_IS_PLAYING, true)
                .putExtra(NarrationService.EXTRA_IS_PREPARING, true)
                .putExtra(NarrationService.EXTRA_BOOK_ID, "fixture-id")
                .putExtra(NarrationService.EXTRA_BOOK_TITLE, "Fixture book")
                .putExtra(NarrationService.EXTRA_BOOK_AUTHOR, "A. Author"),
        )
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("narration.preparing").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("narration.preparing").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, androidx.compose.ui.semantics.ProgressBarRangeInfo.Indeterminate),
        )
        compose.onNodeWithContentDescription("Preparing narration").assertExists()
        context.sendBroadcast(
            Intent(NarrationService.ACTION_EVENT).setPackage(context.packageName)
                .putExtra(NarrationService.EXTRA_SESSION_ACTIVE, true)
                .putExtra(NarrationService.EXTRA_IS_PLAYING, true)
                .putExtra(NarrationService.EXTRA_IS_PREPARING, false)
                .putExtra(NarrationService.EXTRA_BOOK_ID, "fixture-id")
                .putExtra(NarrationService.EXTRA_BOOK_TITLE, "Fixture book")
                .putExtra(NarrationService.EXTRA_BOOK_AUTHOR, "A. Author"),
        )
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("narration.preparing").fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithContentDescription("Pause narration").assertExists()
        compose.onNodeWithTag("narration.openBook").performClick()
        assertEquals(listOf("fixture-id", "Fixture book", "A. Author"), opened)
    }
}
