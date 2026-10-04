package app.bookstr.ui

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReaderAuthorSearchIntentTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun readerAuthorIntentOpensSearchWithAuthorQuery() {
        val context = ApplicationProvider.getApplicationContext<BookstrApp>()
        context.settingsRepository.apply { disconnectNostr(); clearReaderSession() }
        val intent = Intent(context, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_SELECT_TAB, 3)
            .putExtra(MainActivity.EXTRA_SEARCH_QUERY, "Octavia Butler")
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            compose.onNodeWithTag("search.query").assertTextContains("Octavia Butler")
            compose.onNodeWithTag("signer.setup").assertExists()
            scenario.onActivity { it.finish() }
        }
    }
}
