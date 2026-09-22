package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.data.BookFormat
import org.junit.Rule
import org.junit.Test

class CachedFavoritesActivityTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun cachedFavoritesRemainVisibleWithoutRemoteDownloadSources() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val settings = app.settingsRepository
        val id = "c".repeat(64)
        val file = app.catalogRepository.publicationFile(id, BookFormat.Pdf)
        file.writeText("%PDF-1.4\n%%EOF")
        settings.disconnectNostr()
        settings.clearReaderSession()
        settings.relays = emptyList()
        settings.connectAmber("d".repeat(64), "fixture.signer")
        settings.cacheNostrFavorites("d".repeat(64), """[["libvault","${"a".repeat(32)}"],["libvault-book","${"a".repeat(32)}","Cached external","Author","epub"]]""")
        try {
            ActivityScenario.launch(MainActivity::class.java).use {
                compose.waitUntil(10000) { compose.onAllNodesWithText("Cached external").fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText("Cached external").performClick()
                compose.onNodeWithText("This favorite has no local download.").assertIsDisplayed()
            }
        } finally {
            settings.disconnectNostr()
            file.delete()
        }
    }
}
