package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.data.NostrAuthMode
import app.bookstr.util.Bech32
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
        compose.onNodeWithContentDescription("Settings").performClick()
        compose.onNodeWithText("Keep screen awake while reading").assertExists()
        compose.onNodeWithText("Install Huddle or another NIP-55 signer to connect.").assertExists()
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").assertExists()
        compose.onNodeWithTag("search.downloads").performClick()
        compose.onNodeWithTag("downloads.sheet").assertExists()
    }
    @Test fun searchWithoutSignerOffersSetupInsteadOfFailure() {
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").performTextInput("Alice")
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithTag("signer.setup").assertExists()
        compose.onNodeWithTag("signer.choice.generate").assertExists()
        compose.onNodeWithTag("signer.choice.import").assertExists()
        compose.onNodeWithTag("signer.choice.connect").assertExists()
        compose.onNodeWithTag("signer.setup-confirm").performClick()
        compose.onNodeWithTag("signer.generated-key").assertExists()
        compose.onNodeWithTag("signer.setup-confirm").performClick()
        compose.onNodeWithTag("signer.setup").assertDoesNotExist()
        assertEquals(NostrAuthMode.Nsec, (compose.activity.application as BookstrApp).settingsRepository.authMode)
    }
    @Test fun invalidImportedKeyKeepsChooserOpen() {
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").performTextInput("Alice")
        compose.onNodeWithTag("search.submit").performClick()
        compose.onNodeWithTag("signer.choice.import").performClick()
        compose.onNodeWithTag("signer.import-key").performTextInput("not a key")
        compose.onNodeWithTag("signer.setup-confirm").performClick()
        compose.onNodeWithTag("signer.setup-error").assertExists()
        assertEquals(NostrAuthMode.None, (compose.activity.application as BookstrApp).settingsRepository.authMode)
        compose.onNodeWithTag("signer.import-key").performTextReplacement(Bech32.encode("nsec", ByteArray(32) { 1 }))
        compose.onNodeWithTag("signer.setup-confirm").performClick()
        assertEquals(NostrAuthMode.Nsec, (compose.activity.application as BookstrApp).settingsRepository.authMode)
    }
}
