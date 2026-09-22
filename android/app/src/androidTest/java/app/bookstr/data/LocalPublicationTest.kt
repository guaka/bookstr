package app.bookstr.data

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.BookstrApp
import app.bookstr.download.DownloadStore
import app.bookstr.download.DownloadJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class LocalPublicationTest {
    @Test fun completedTorrentBooksRecoverFromJournalWhenMetadataIsMissing() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val root = File(app.cacheDir, "journal-recovery-${System.nanoTime()}").also { it.mkdirs() }
        val context = object : ContextWrapper(app) { override fun getFilesDir(): File = root }
        val repository = CatalogRepository(context, app.database.bookProgressDao(), app.settingsRepository)
        try {
            val id = "a".repeat(32)
            val book = CatalogBook(id, "Recovered comic", "Author", "", null, libvaultMd5 = id, format = BookFormat.Cbz, language = "und")
            repository.publicationFile(id, BookFormat.Cbz).writeBytes(byteArrayOf(80, 75, 3, 4))
            val store = DownloadStore(File(root, "torrent-downloads"))
            store.update(DownloadJob(book, TorrentEdition(id, 42, "comics", 4), state = "complete"))
            assertEquals(book, repository.downloadedBooks(emptyList()).single())
            File(root, "torrent-downloads/jobs.json").delete()
            assertEquals(book, repository.downloadedBooks(emptyList()).single())
        } finally { root.deleteRecursively() }
    }

    @Test fun discoversAndReopensLocalBookWithoutInventingRemoteUrl() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val root = File(app.cacheDir, "local-publication-${System.nanoTime()}").also { it.mkdirs() }
        val context = object : ContextWrapper(app) { override fun getFilesDir(): File = root }
        val repository = CatalogRepository(context, app.database.bookProgressDao(), app.settingsRepository)
        try {
            val source = File(root, "fixture.epub")
            ZipOutputStream(source.outputStream()).use { zip ->
                mapOf(
                    "META-INF/container.xml" to """<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>""",
                    "book.opf" to """<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Offline fixture</dc:title><dc:creator>Local author</dc:creator></metadata></package>""",
                ).forEach { (name, content) -> zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray()); zip.closeEntry() }
            }
            val id = MessageDigest.getInstance("SHA-256").digest(source.readBytes()).joinToString("") { "%02x".format(it) }
            val target = repository.publicationFile(id, BookFormat.Epub)
            source.copyTo(target)
            val book = repository.downloadedBooks(emptyList()).single()
            assertEquals("Offline fixture", book.title)
            assertEquals("", book.epubUrl)
            assertEquals(target, repository.ensureDownloaded(book))
            val reopened = CatalogRepository(context, app.database.bookProgressDao(), app.settingsRepository)
                .downloadedBooks(emptyList()).single()
            assertEquals(book, reopened)
            assertTrue(target.isFile)
        } finally { root.deleteRecursively() }
    }
}
