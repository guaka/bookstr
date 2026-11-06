package app.bookstr.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.PdfReaderActivity
import app.bookstr.data.BookFormat
import android.graphics.pdf.PdfDocument
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import java.util.UUID
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertEquals
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

    private fun withActivity(intent: Intent = Intent(app, MainActivity::class.java), block: (ActivityScenario<MainActivity>) -> Unit) {
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            lateinit var launchIntent: Intent
            scenario.onActivity { launchIntent = it.intent }
            try {
                block(scenario)
            } finally {
                // ActivityScenario matches lifecycle events against its launch intent. The app
                // correctly replaces that intent in onNewIntent; restore it only for teardown.
                scenario.onActivity { it.intent = launchIntent }
            }
        }
    }

    @Test
    fun savedWordsReportMissingPublicationsAndOpenAnAvailablePdf() {
        val suffix = UUID.randomUUID().toString()
        val previousSort = app.settingsRepository.wordSort
        app.settingsRepository.wordSort = "recent"
        val missing = runBlocking { app.vocabularyRepository.saveSelection(
            "missing-$suffix", "en", "missing-$suffix", "Missing", "pdf:0:0", "Missing fixture",
        ) }
        val available = runBlocking { app.vocabularyRepository.saveSelection(
            "available-$suffix", "en", "available-$suffix", "Available PDF", "pdf:0:0", "Available fixture",
        ) }
        val file = app.catalogRepository.publicationFile(available.bookId, BookFormat.Pdf)
        val pdf = PdfDocument()
        try {
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(200, 300, 1).create())
            pdf.finishPage(page)
            file.outputStream().use(pdf::writeTo)
        } finally {
            pdf.close()
        }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = instrumentation.addMonitor(PdfReaderActivity::class.java.name, null, false)
        try {
            withActivity(Intent(app, MainActivity::class.java).putExtra(MainActivity.EXTRA_SELECT_TAB, 1)) {
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("word.open.${missing.key}").fetchSemanticsNodes().isNotEmpty()
                }
                compose.onNodeWithTag("word.open.${missing.key}").performClick()
                compose.onNodeWithText("This book is no longer downloaded. Open it from Library first.").assertIsDisplayed()
                compose.onNodeWithTag("word.open.${available.key}").performClick()
                val reader = instrumentation.waitForMonitorWithTimeout(monitor, 10_000)
                assertNotNull("A saved PDF word must open the PDF reader", reader)
                instrumentation.runOnMainSync { reader?.finish() }
            }
        } finally {
            instrumentation.removeMonitor(monitor)
            app.settingsRepository.wordSort = previousSort
            file.delete()
            runBlocking {
                app.vocabularyRepository.remove(missing.key)
                app.vocabularyRepository.remove(available.key)
            }
        }
    }

    private fun deliverIntent(activity: MainActivity, intent: Intent) {
        activity.startActivity(
            intent.setClass(activity, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    private fun assertIntentDeliveredToResumedActivity(
        scenario: ActivityScenario<MainActivity>,
        expectedUri: String,
    ) {
        scenario.onActivity { activity ->
            assertEquals(expectedUri, activity.intent.dataString)
            assertEquals(Lifecycle.State.RESUMED, activity.lifecycle.currentState)
        }
    }

    @Test
    fun validCatalogInvitationReceivedInNewIntentCanBeConfirmed() {
        val invitation = "bookstr://catalog?v=1&npub=npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h" +
            "&name=Intent%20test%20catalog&relay=wss%3A%2F%2Frelay.example.test"

        withActivity { scenario ->
            scenario.onActivity { activity ->
                deliverIntent(activity, Intent(Intent.ACTION_VIEW, Uri.parse(invitation)))
            }

            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("catalog.confirm").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Intent test catalog").assertIsDisplayed()
            assertIntentDeliveredToResumedActivity(scenario, invitation)
            compose.onNodeWithText("wss://relay.example.test", substring = true).assertIsDisplayed()
            compose.onNodeWithTag("catalog.confirm").performClick()

            compose.waitUntil(5_000) { app.settingsRepository.catalogConnection?.uri == invitation }
            assertIntentDeliveredToResumedActivity(scenario, invitation)
            compose.onNodeWithTag("catalog.confirm").assertDoesNotExist()
            compose.onNodeWithTag("tab.search").assertIsSelected()
        }
    }

    @Test
    fun invalidInvitationCanBeDismissedAndNonBookstrIntentClearsPendingInvite() {
        val invalidInvitation = "bookstr://catalog?v=1&unknown=value"

        withActivity { scenario ->
            scenario.onActivity { activity ->
                deliverIntent(activity, Intent(Intent.ACTION_VIEW, Uri.parse(invalidInvitation)))
            }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithText("Invalid catalog invitation").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Invalid catalog invitation").assertIsDisplayed()
            compose.onNodeWithText("This invitation cannot be opened.").assertIsDisplayed()
            assertIntentDeliveredToResumedActivity(scenario, invalidInvitation)
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
