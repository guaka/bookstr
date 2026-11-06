package app.bookstr.data

import android.content.ContextWrapper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import java.io.File

@RunWith(AndroidJUnit4::class)
class CatalogRepositoryFb2GateTest {
    @get:Rule val folder = TemporaryFolder()

    @Test fun importAndDownloadRejectFb2BeforeChangingExistingFileOrMetadata() {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val files = folder.newFolder("app-files")
        val context = object : ContextWrapper(base) {
            override fun getFilesDir(): File = files
        }
        val progress = object : BookProgressDao {
            override suspend fun get(bookId: String): BookProgress? = null
            override suspend fun getAll(): List<BookProgress> = emptyList()
            override suspend fun upsert(progress: BookProgress) = Unit
        }
        val catalog = CatalogRepository(context, progress, SettingsRepository(base))
        val id = "a".repeat(32)
        val book = CatalogBook(id, "Legacy", "Author", "", null, format = BookFormat.Fb2)
        val target = catalog.publicationFile(id, BookFormat.Fb2).apply { writeText("existing FB2") }
        val partial = File(target.parentFile, "${target.name}.part").apply { writeText("partial bytes") }
        val targetBefore = target.readBytes()
        val partialBefore = partial.readBytes()
        val source = File(folder.root, "incoming.fb2").apply { writeText("incoming data") }
        val metadata = File(files, "downloaded-books.json").apply { writeText("preserved metadata") }
        val metadataBefore = metadata.readBytes()

        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { catalog.importVerified(book, source) }
        }
        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { catalog.ensureDownloaded(book) }
        }

        assertArrayEquals(targetBefore, target.readBytes())
        assertArrayEquals(partialBefore, partial.readBytes())
        assertArrayEquals(metadataBefore, metadata.readBytes())
        assertTrue(source.isFile)
    }
}
