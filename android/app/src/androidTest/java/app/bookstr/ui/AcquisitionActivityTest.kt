package app.bookstr.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AcquisitionActivityTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val clean = object : ExternalResource() {
        override fun before() {
            ApplicationProvider.getApplicationContext<BookstrApp>().settingsRepository.apply {
                disconnectNostr(); clearReaderSession(); catalogConnection = null
            }
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(clean).around(compose)
    @Test fun navigatesSettingsSearchAndDownloadsWithoutAnAccount() {
        compose.onNodeWithContentDescription("Continue reading").assertDoesNotExist()
        compose.onNodeWithContentDescription("Settings").performClick()
        compose.onNodeWithText("Install Huddle or another NIP-55 signer to connect.").assertExists()
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").assertExists()
        compose.onNodeWithTag("search.downloads").performClick()
        compose.onNodeWithTag("downloads.sheet").assertExists()
    }
    @Test fun searchWithoutSignerShowsLibCatConnectionPrompt() {
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").performTextInput("Alice")
        compose.onNodeWithTag("search.submit").performClick()
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("Search failed: Connect a Nostr signer to search LibCat")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Search failed: Connect a Nostr signer to search LibCat").assertExists()
    }
    @Test fun catalogInvitationsRequireConfirmationAndPersistAcrossRecreation() {
        val uri = "bookstr://catalog?v=1&npub=npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h&name=Fixture&relay=wss%3A%2F%2Frelay.example"
        compose.runOnUiThread { compose.activity.startActivity(Intent(compose.activity, MainActivity::class.java).setData(Uri.parse(uri)).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
        compose.onNodeWithTag("catalog.confirm").assertExists()
        assertNull((compose.activity.application as BookstrApp).settingsRepository.catalogConnection)
        compose.onNodeWithTag("catalog.confirm").performClick()
        assertEquals("Fixture", (compose.activity.application as BookstrApp).settingsRepository.catalogConnection?.name)
        compose.onNodeWithTag("search.query").assertExists()
        compose.activityRule.scenario.recreate()
        assertEquals("Fixture", (compose.activity.application as BookstrApp).settingsRepository.catalogConnection?.name)
    }
}
