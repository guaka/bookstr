package app.bookstr.data

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import app.bookstr.data.ShadowEncryptedSharedPreferences
import app.bookstr.data.ShadowMasterKeyBuilder
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files
import org.junit.Before

@RunWith(RobolectricTestRunner::class)
@Config(
    application = Application::class,
    sdk = [28],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedSharedPreferences::class],
)
class CatalogRepositoryIntegrationCoverageTest {
    private val roots = mutableListOf<File>()
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var settings: SettingsRepository
    private lateinit var previousSettings: List<Any?>

    @Before
    fun snapshotSettings() {
        settings = SettingsRepository(context)
        previousSettings = listOf(settings.authMode, settings.nsec, settings.pubkeyHex, settings.signerPackage)
    }

    @After
    fun cleanUp() {
        roots.forEach { it.deleteRecursively() }
        settings.authMode = previousSettings[0] as NostrAuthMode
        settings.nsec = previousSettings[1] as String?
        settings.pubkeyHex = previousSettings[2] as String?
        settings.signerPackage = previousSettings[3] as String?
    }

    @Test
    fun progressReadsDefaultsAndPreservesFurthestPosition() = runBlocking<Unit> {
        val repository = repository()
        val dao = repositories.last().second
        val present = CatalogBook("present", "Title", "Author", "", null)
        val missing = CatalogBook("missing", "Other", "Author", "", null)

        val empty = repository.getProgressForBooks(listOf(present, missing))
        assertEquals(0.0, empty.getValue("missing").progression, 0.0)
        assertEquals("", empty.getValue("missing").cfi)
        assertNull(repository.getProgress("present"))

        dao.upsert(BookProgress("present", 0.8, "furthest-cfi", 1L, 0.9))
        val saved = repository.saveProgress("present", 0.4, "current-cfi")
        assertEquals(0.4, saved.progression, 0.0)
        assertEquals(0.9, saved.furthestProgression, 0.0)
        assertEquals("current-cfi", repository.getProgress("present")?.cfi)
        assertEquals(setOf("present", "missing"), repository.getProgressForBooks(listOf(present, missing)).keys)

        repository.clearProgress("present")
        assertEquals(0.0, repository.getProgress("present")?.furthestProgression ?: -1.0, 0.0)
    }

    @Test
    fun verifiedImportRejectsBadBytesAndPersistsValidPdf() = runBlocking<Unit> {
        val repository = repository()
        val root = roots.last()
        val valid = File(root, "valid.pdf").apply { writeBytes("%PDF-1.7\nbook".toByteArray()) }
        val invalid = File(root, "invalid.pdf").apply { writeBytes("not-pdf".toByteArray()) }
        val book = CatalogBook("a".repeat(32), "A PDF", "Writer", "", null, format = BookFormat.Pdf)

        val imported = repository.importVerified(book, valid)
        assertTrue(imported.isFile)
        assertEquals(valid.readBytes().toList(), imported.readBytes().toList())
        assertEquals(valid.length(), repository.publicationSize(book))
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.importVerified(book.copy(id = "b".repeat(32)), invalid) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.importVerified(book.copy(id = "bad-id"), valid) }
        }
    }

    @Test
    fun ensureDownloadedWritesValidFileThenUsesCacheWithoutAnotherRequest() = runBlocking<Unit> {
        val repository = repository()
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(200).setBody("%PDF-1.7\nbook-data"))
        server.start()
        try {
            val book = CatalogBook("downloaded-pdf", "Downloaded", "Author", server.url("/book.pdf").toString(), null, format = BookFormat.Pdf)
            val first = repository.ensureDownloaded(book)
            val second = repository.ensureDownloaded(book)

            assertEquals(first, second)
            assertEquals("%PDF-1.7\nbook-data", first.readText())
            assertEquals(first.length(), repository.publicationSize(book))
            assertEquals("/book.pdf", requireNotNull(server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)) { "Expected HTTP request" }.path)
            assertNull(server.takeRequest(100, java.util.concurrent.TimeUnit.MILLISECONDS))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun ensureDownloadedResumesPartialFileWithRangeAndRejectsBadHttpResponse() = runBlocking<Unit> {
        val repository = repository()
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(206).setBody("F-1.7\nheadtail"))
        server.enqueue(MockResponse().setResponseCode(404))
        server.start()
        try {
            val book = CatalogBook("resumable-pdf", "Partial", "Author", server.url("/partial.pdf").toString(), null, format = BookFormat.Pdf)
            val target = repository.publicationFile(book.id, book.format)
            File(target.parentFile, "${target.name}.part").writeBytes("%PD".toByteArray())

            val completed = repository.ensureDownloaded(book)
            val request = requireNotNull(server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)) { "Expected HTTP request" }
            assertEquals("bytes=3-", request.getHeader("Range"))
            assertTrue(completed.readText().endsWith("headtail"))

            val failed = book.copy(id = "missing-pdf", epubUrl = server.url("/missing.pdf").toString())
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { repository.ensureDownloaded(failed) }
            }
            assertEquals("/missing.pdf", requireNotNull(server.takeRequest(2, java.util.concurrent.TimeUnit.SECONDS)) { "Expected HTTP request" }.path)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun blossomDownloadsRequireConfiguredSignerBeforeNetworkAccess() = runBlocking<Unit> {
        val repository = repository()
        val hash = "f".repeat(64)
        val protectedBook = CatalogBook(
            id = hash,
            title = "Protected",
            author = "Author",
            epubUrl = "https://${CatalogRepository.BLOSSOM_HOST}/$hash",
            coverUrl = null,
        )

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking { repository.ensureDownloaded(protectedBook) }
        }
        assertTrue(error.message.orEmpty().contains("approved Nostr identity"))
    }

    @Test
    fun downloadedBooksDiscoversPdfMetadataMatchesFavoritesAndCachesResult() = runBlocking<Unit> {
        val repository = repository()
        val bookId = "c".repeat(64)
        val local = repository.publicationFile(bookId, BookFormat.Pdf)
        local.writeBytes("%PDF-1.7\n/Title (  A Book! )\n/Author (Ada Writer)\n/CreationDate (D:20230417)".toByteArray())
        File(local.parentFile, "unrelated.mobi").writeText("unsupported publication")
        File(local.parentFile, "directory.epub").mkdir()
        val favorite = ExternalFavorite(
            key = "favorite-key",
            title = "a book",
            author = "Curated Author",
            year = "2022",
            url = "https://source.example/book",
            isbn = "isbn-1",
            libvaultMd5 = "d".repeat(32),
            format = "PDF",
            rightsStatus = RIGHTS_OPEN_LICENSE,
            license = "CC BY 4.0",
            rightsSource = "favorite",
        )

        val discovered = repository.downloadedBooks(listOf(favorite)).single()
        assertEquals(bookId, discovered.id)
        assertEquals("a book", discovered.title)
        assertEquals("Curated Author", discovered.author)
        assertEquals("2022", discovered.year)
        assertEquals(favorite.url, discovered.sourceUrl)
        assertEquals(favorite.isbn, discovered.isbn)
        assertEquals(favorite.libvaultMd5, discovered.libvaultMd5)
        assertEquals(BookFormat.Pdf, discovered.format)
        assertEquals(RIGHTS_OPEN_LICENSE, discovered.rightsStatus)

        local.writeBytes("changed metadata".toByteArray())
        val cached = repository.downloadedBooks(emptyList()).single()
        assertEquals("a book", cached.title)
        assertEquals("Curated Author", cached.author)
    }

    @Test
    fun deletePublicationRemovesTargetAndPartialAndEmitsWhenTargetWasPresent() = runBlocking<Unit> {
        val repository = repository()
        val book = CatalogBook("delete-me", "Title", "Author", "", null, format = BookFormat.Pdf)
        val target = repository.publicationFile(book.id, book.format)
        target.writeBytes("%PDF-".toByteArray())
        val partial = File(target.parentFile, "${target.name}.part").apply { writeText("partial") }
        val change = async(start = CoroutineStart.UNDISPATCHED) { repository.downloadedBookChanges.first() }

        assertTrue(repository.deletePublication(book))
        change.await()
        assertFalse(target.exists())
        assertFalse(partial.exists())
        assertTrue(repository.deletePublication(book))
        assertNull(repository.publicationSize(book))
    }

    @Test
    fun catalogSearchAndResolveGuardInvalidInputsBeforeNetwork() = runBlocking<Unit> {
        val repository = repository()
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.searchPage(" x ") }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.searchPage("valid query") }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { repository.resolveEdition(CatalogBook("id", "Title", "Author", "", null)) }
        }
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                repository.resolveEdition(
                    CatalogBook("id", "Title", "Author", "", null, libvaultMd5 = "e".repeat(32)),
                )
            }
        }
    }

    private val repositories = mutableListOf<Pair<CatalogRepository, MemoryProgressDao>>()

    private fun repository(): CatalogRepository {
        val root = Files.createTempDirectory("bookstr-catalog-test-").toFile()
        roots += root
        val filesContext = object : ContextWrapper(context) {
            override fun getFilesDir(): File = root
        }
        val settings = SettingsRepository(filesContext).apply {
            authMode = NostrAuthMode.None
            nsec = null
            pubkeyHex = null
            signerPackage = null
        }
        val dao = MemoryProgressDao()
        return CatalogRepository(filesContext, dao, settings).also { repositories += it to dao }
    }

    private class MemoryProgressDao : BookProgressDao {
        private val rows = linkedMapOf<String, BookProgress>()
        override suspend fun get(bookId: String): BookProgress? = rows[bookId]
        override suspend fun getAll(): List<BookProgress> = rows.values.sortedByDescending { it.updatedAt }
        override suspend fun upsert(progress: BookProgress) { rows[progress.bookId] = progress }
    }
}
