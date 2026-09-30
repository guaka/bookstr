package app.bookstr.ui

import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.NarrationService
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NarrationIslandTest {
    @get:Rule val compose = createComposeRule()

    @Test fun islandTracksPlaybackWhileMountedOutsideReader() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        compose.setContent { NarrationIsland() }
        compose.onNodeWithTag("narration.island").assertDoesNotExist()
        fun publish(active: Boolean, playing: Boolean) {
            context.sendBroadcast(
                Intent(NarrationService.ACTION_EVENT).setPackage(context.packageName)
                    .putExtra(NarrationService.EXTRA_SESSION_ACTIVE, active)
                    .putExtra(NarrationService.EXTRA_IS_PLAYING, playing)
                    .putExtra(NarrationService.EXTRA_BOOK_TITLE, "Fixture book"),
            )
        }
        publish(true, true)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("narration.island").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Fixture book").assertExists()
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
}
