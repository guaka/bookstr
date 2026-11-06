package app.bookstr.data

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class Fb2UnavailableEntryPointsTest {
    @get:Rule val folder = TemporaryFolder()

    private val validFb2 = """<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Preserved</book-title><author><first-name>Test</first-name></author></title-info></description><body><section><p>Existing text</p></section></body></FictionBook>""".toByteArray()

    @Test fun importAndDownloadRejectFb2WithoutTouchingFilesOrSavedMetadata() = runBlocking {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val files = folder.newFolder("app-files")
        val context = object : ContextWrapper(base) {
            override fun getFilesDir(): File = files
        }
        val settings = SettingsRepository(base)
        val id = "a".repeat(32)
        val savedProgress = BookProgress(id, 0.42, "fb2:section-2:4:17", 1234L, 0.51)
        val progress = object : BookProgressDao {
            override suspend fun get(bookId: String): BookProgress? = savedProgress.takeIf { bookId == id }
            override suspend fun getAll(): List<BookProgress> = listOf(savedProgress)
            override suspend fun upsert(progress: BookProgress) { error("rejection must not rewrite reading progress") }
        }
        val catalog = CatalogRepository(context, progress, settings)

        // Seed a legacy FB2 metadata record through normal discovery, then snapshot it.
        val seedId = MessageDigest.getInstance("SHA-256").digest(validFb2)
            .joinToString("") { "%02x".format(it) }
        val seed = catalog.publicationFile(seedId, BookFormat.Fb2).apply { writeBytes(validFb2) }
        catalog.downloadedBooks(emptyList())
        val metadata = File(files, "downloaded-books.json")
        val metadataBefore = metadata.readBytes()
        assertTrue(seed.isFile)

        val book = CatalogBook(id, "Legacy", "Author", "", null, format = BookFormat.Fb2)
        val existing = catalog.publicationFile(id, BookFormat.Fb2).apply { writeBytes(validFb2) }
        val partial = File(existing.parentFile, "${existing.name}.part").apply { writeText("partial legacy bytes") }
        val existingBytes = existing.readBytes()
        val partialBytes = partial.readBytes()
        val source = File(folder.root, "incoming.fb2").apply { writeBytes(validFb2) }

        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { catalog.importVerified(book, source) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { catalog.ensureDownloaded(book) }
        }

        assertArrayEquals(existingBytes, existing.readBytes())
        assertArrayEquals(partialBytes, partial.readBytes())
        assertTrue(source.isFile)
        assertArrayEquals(metadataBefore, metadata.readBytes())
        assertFalse(catalog.downloadedBooks(emptyList()).any { it.id == id })
        assertArrayEquals(metadataBefore, metadata.readBytes())
        assertEquals(savedProgress, progress.get(id))
    }
}
