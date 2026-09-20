package app.bookstr.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.data.*
import app.bookstr.download.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import java.io.File
import java.security.MessageDigest

/** Exercise MainActivity's real callbacks with a deterministic catalog boundary. */
class AcquisitionActionsTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val content = java.io.ByteArrayOutputStream().also { output ->
        val document = android.graphics.pdf.PdfDocument()
        try {
            val page = document.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(72, 72, 1).create())
            document.finishPage(page)
            document.writeTo(output)
        } finally { document.close() }
    }.toByteArray()
    private val id = MessageDigest.getInstance("MD5").digest(content).joinToString("") { "%02x".format(it) }
    private val result = BookSearchResult(id, "libcat", "Direct download fixture", "Unknown author", language = "en", format = BookFormat.Pdf, libvaultMd5 = id)
    private lateinit var app: BookstrApp
    private lateinit var original: CatalogRepository
    private var resolutionError: Exception? = null
    private val setup = object : ExternalResource() {
        override fun before() {
            app = ApplicationProvider.getApplicationContext()
            app.settingsRepository.disconnectNostr()
            app.settingsRepository.clearReaderSession()
            app.settingsRepository.catalogConnection = null
            original = app.catalogRepository
            val catalog = object : CatalogRepository(app, app.database.bookProgressDao(), app.settingsRepository) {
                override suspend fun searchPage(query: String, offset: Int) = CatalogSearchPage(listOf(result), null)
                override suspend fun resolveEdition(book: CatalogBook): TorrentEdition {
                    resolutionError?.let { throw it }
                    return TorrentEdition(id, 1, "fiction", content.size.toLong())
                }
            }
            BookstrApp::class.java.getDeclaredField("catalogRepository").apply { isAccessible = true }.set(app, catalog)
            runBlocking { catalog.deletePublication(result.asCatalogBook()!!); catalog.clearProgress(id) }
            app.downloadStore.update(DownloadJob(result.asCatalogBook()!!, TorrentEdition(id, 1, "fiction", content.size.toLong()), "cancelled"))
            val root = app.downloadStore.root(id)
            File(root, "payload").writeBytes(content)
            val pieces = MessageDigest.getInstance("SHA-1").digest(content)
            val info = "d6:lengthi${content.size}e4:name${id.length + 4}:$id.pdf12:piece lengthi16384e6:pieces20:".toByteArray() + pieces + "7:privatei1ee".toByteArray()
            File(root, "book.torrent").writeBytes("d4:info".toByteArray() + info + "e".toByteArray())
        }
        override fun after() {
            BookstrApp::class.java.getDeclaredField("catalogRepository").apply { isAccessible = true }.set(app, original)
        }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(setup).around(compose)

    private fun search() {
        compose.onNodeWithContentDescription("Search").performClick()
        compose.onNodeWithTag("search.query").performTextInput("fixture")
        compose.onNodeWithTag("search.submit").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("search.open.$id").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun oneTapStartsDownloadAndDeletionRemovesTheActualPublication() {
        search()
        compose.onNodeWithTag("search.open.$id").performClick()
        compose.onNodeWithTag("edition.download").assertDoesNotExist()
        compose.onNodeWithTag("downloads.sheet").assertIsDisplayed()
        compose.waitUntil(15000) { app.downloadStore.find(id)?.state == "complete" }
        assertTrue(app.catalogRepository.publicationFile(id, BookFormat.Pdf).isFile)
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithTag("search.open.$id").performClick()
        compose.waitUntil(5000) { app.settingsRepository.readerSession()?.bookId == id }
        androidx.test.espresso.Espresso.pressBack()
        compose.onNodeWithContentDescription("Library").performClick()
        compose.onNodeWithTag("library.swipe.$id").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("library.delete.confirm").performClick()
        compose.waitUntil(5000) { !app.catalogRepository.publicationFile(id, BookFormat.Pdf).exists() }
        compose.onNodeWithTag("library.swipe.$id").assertDoesNotExist()
        assertEquals("cancelled", app.downloadStore.find(id)?.state)
    }

    @Test fun failedResolutionShowsErrorAndAllowsAnotherTap() {
        resolutionError = IllegalStateException("Fixture resolution failed")
        search()
        compose.onNodeWithTag("search.open.$id").performClick()
        compose.onNodeWithText("Fixture resolution failed").assertIsDisplayed()
        compose.onNodeWithTag("downloads.sheet").assertDoesNotExist()
        compose.onNodeWithTag("search.open.$id").assertIsEnabled()
        assertEquals("cancelled", app.downloadStore.find(id)?.state)
        resolutionError = IllegalStateException()
        compose.onNodeWithTag("search.open.$id").performClick()
        compose.onNodeWithText("Could not start download").assertIsDisplayed()
    }

    @Test fun catalogRejectsInvalidAcquisitionRequestsBeforeNetworkAccess() {
        assertThrows(IllegalArgumentException::class.java) { runBlocking { original.searchPage("", 0) } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking { original.resolveEdition(result.asCatalogBook()!!.copy(libvaultMd5 = null)) } }
    }

    @Test fun malformedLocalIdentityFailsSearchAndResolutionWithoutEnqueuing() {
        app.settingsRepository.connectNsec("invalid-test-key", "0".repeat(64))
        try {
            assertThrows(IllegalArgumentException::class.java) { runBlocking { original.searchPage("fixture", 0) } }
            assertThrows(IllegalArgumentException::class.java) { runBlocking { original.resolveEdition(result.asCatalogBook()!!) } }
            assertEquals("cancelled", app.downloadStore.find(id)?.state)
        } finally { app.settingsRepository.disconnectNostr() }
    }
}
