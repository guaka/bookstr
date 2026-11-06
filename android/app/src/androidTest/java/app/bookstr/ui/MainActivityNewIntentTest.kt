package app.bookstr.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivityNewIntentTest {
    private val compose = createEmptyComposeRule()
    private lateinit var app: BookstrApp
    private val clean = object : ExternalResource() {
        override fun before() {
            app = ApplicationProvider.getApplicationContext()
            check(app.downloadStore.jobs.value.none { it.active }) { "Intent fixtures require no active downloads" }
            app.settingsRepository.apply {
                disconnectNostr()
                clearReaderSession()
                catalogConnection = null
            }
        }

        override fun after() {
            app.settingsRepository.apply {
                disconnectNostr()
                clearReaderSession()
                catalogConnection = null
            }
        }
    }

    @get:Rule val rules: RuleChain = RuleChain.outerRule(clean).around(compose)

    private fun deliverIntent(activity: MainActivity, intent: Intent) {
        activity.startActivity(
            intent.setClass(activity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    @Test
    fun validCatalogInvitationReceivedInNewIntentCanBeConfirmed() {
        val invitation = "bookstr://catalog?v=1&npub=npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h" +
            "&name=Intent%20test%20catalog&relay=wss%3A%2F%2Frelay.example.test"

        ActivityScenario.launch<MainActivity>(Intent(app, MainActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                deliverIntent(activity, Intent(Intent.ACTION_VIEW, Uri.parse(invitation)))
            }

            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("catalog.confirm").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Intent test catalog").assertIsDisplayed()
            compose.onNodeWithText("wss://relay.example.test", substring = true).assertIsDisplayed()
            compose.onNodeWithTag("catalog.confirm").performClick()

            compose.waitUntil(5_000) { app.settingsRepository.catalogConnection?.uri == invitation }
            compose.onNodeWithTag("catalog.confirm").assertDoesNotExist()
            compose.onNodeWithTag("tab.search").assertIsSelected()
        }
    }

    @Test
    fun invalidInvitationCanBeDismissedAndNonBookstrIntentClearsPendingInvite() {
        val invalidInvitation = "bookstr://catalog?v=1&unknown=value"

        ActivityScenario.launch<MainActivity>(Intent(app, MainActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                deliverIntent(activity, Intent(Intent.ACTION_VIEW, Uri.parse(invalidInvitation)))
            }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Invalid catalog invitation").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Invalid catalog invitation").assertIsDisplayed()
            compose.onNodeWithText("This invitation cannot be opened.").assertIsDisplayed()
            compose.onNodeWithText("Cancel").performClick()
            compose.onNodeWithText("Invalid catalog invitation").assertDoesNotExist()

            scenario.onActivity { activity ->
                deliverIntent(activity, Intent(Intent.ACTION_VIEW, Uri.parse(invalidInvitation)))
            }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Invalid catalog invitation").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Invalid catalog invitation").assertIsDisplayed()
            scenario.onActivity { activity ->
                deliverIntent(
                    activity,
                    Intent(Intent.ACTION_VIEW, Uri.parse("https://example.test/not-a-bookstr-invitation"))
                        .putExtra(MainActivity.EXTRA_SELECT_TAB, 2),
                )
            }

            compose.onNodeWithText("Invalid catalog invitation").assertDoesNotExist()
            compose.onNodeWithTag("tab.settings").assertIsSelected()
        }
    }
}
