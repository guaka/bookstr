package app.bookstr.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.PdfReaderActivity
import app.bookstr.data.*
import app.bookstr.download.*
import app.bookstr.nostr.NostrCrypto
import app.bookstr.util.Bech32
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
    private var forceResolve = false
    private var resolutionCalls = 0
    private val setup = object : ExternalResource() {
        override fun before() {
            app = ApplicationProvider.getApplicationContext()
            app.settingsRepository.disconnectNostr()
            val secret = ByteArray(32) { 1 }
            app.settingsRepository.connectNsec(Bech32.encode("nsec", secret), NostrCrypto.publicKeyHex(secret))
            app.settingsRepository.clearReaderSession()
            app.settingsRepository.catalogConnection = null
            original = app.catalogRepository
            val catalog = object : CatalogRepository(app, app.database.bookProgressDao(), app.settingsRepository) {
                override suspend fun searchPage(query: String, offset: Int) = CatalogSearchPage(
                    listOf(if (forceResolve) result else result.copy(torrentEdition = TorrentEdition(id, 1, "fiction", content.size.toLong()))), null,
                )
                override suspend fun resolveEdition(book: CatalogBook): TorrentEdition {
                    resolutionCalls++
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

    @Suppress("DEPRECATION")
    @Test fun oneTapStartsDownloadAndDeletionRemovesTheActualPublication() {
        search()
        compose.onNodeWithTag("search.open.$id").performClick()
        assertEquals("Search metadata should avoid a second Libcat resolve request", 0, resolutionCalls)
        compose.onNodeWithTag("edition.download").assertDoesNotExist()
        compose.onNodeWithTag("downloads.sheet").assertIsDisplayed()
        compose.waitUntil(15000) { app.downloadStore.find(id)?.state == "complete" }
        assertTrue(app.catalogRepository.publicationFile(id, BookFormat.Pdf).isFile)
        val dismissSheet = hasAnyAncestor(hasTestTag("downloads.sheet")) and
            SemanticsMatcher.keyIsDefined(SemanticsActions.Dismiss)
        compose.onNode(dismissSheet, useUnmergedTree = true).performSemanticsAction(SemanticsActions.Dismiss)
        compose.waitUntil(5000) { compose.onAllNodesWithTag("downloads.sheet").fetchSemanticsNodes().isEmpty() }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val readerMonitor = instrumentation.addMonitor(PdfReaderActivity::class.java.name, null, false)
        try {
            compose.onNodeWithTag("search.open.$id").performClick()
            val reader = requireNotNull(instrumentation.waitForMonitorWithTimeout(readerMonitor, 10_000) as? PdfReaderActivity) {
                "Opening the downloaded publication must launch the PDF reader"
            }
            try {
                compose.waitUntil(5000) { app.settingsRepository.readerSession()?.bookId == id }
            } finally {
                // Global Back can be consumed by system UI before it reaches the reader.
                instrumentation.runOnMainSync { reader.onBackPressed() }
            }
        } finally {
            instrumentation.removeMonitor(readerMonitor)
        }
        compose.waitUntil(10_000) { compose.activityRule.scenario.state == Lifecycle.State.RESUMED }
        compose.onNodeWithTag("tab.library").performClick()
        compose.onNodeWithTag("library.swipe.$id").performTouchInput { swipeLeft() }
        compose.onNodeWithTag("library.delete.confirm").performClick()
        compose.waitUntil(5000) { !app.catalogRepository.publicationFile(id, BookFormat.Pdf).exists() }
        compose.onNodeWithTag("library.swipe.$id").assertDoesNotExist()
        assertEquals("cancelled", app.downloadStore.find(id)?.state)
    }

    @Test fun failedResolutionShowsErrorAndAllowsAnotherTap() {
        forceResolve = true
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
