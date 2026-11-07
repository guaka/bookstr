package app.bookstr

import android.app.Application
import android.content.Intent
import android.content.ContextWrapper
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import java.io.File
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class BookSharingTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val book = CatalogBook("share", "A book", "Author", "", null)

    @Before fun resetProviderRootsForRobolectricsPerTestFilesDirectory() {
        ReflectionHelpers.getStaticField<MutableMap<String, Any>>(FileProvider::class.java, "sCache").clear()
    }

    @Test fun sharesEveryFormatAsReadableAttachmentWithTemporaryReadPermission() {
        val types = listOf("application/epub+zip", "application/pdf",
            "application/vnd.comicbook-rar", "application/vnd.comicbook+zip")
        BookFormat.entries.forEachIndexed { index, format ->
            val file = File(context.filesDir, "books/share.${format.extension}")
            file.parentFile!!.mkdirs()
            file.writeText("publication $format")
            val chooser = BookSharing.chooser(context, book.copy(format = format), file)
            assertEquals(Intent.ACTION_CHOOSER, chooser.action)
            val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
            assertEquals(Intent.ACTION_SEND, send.action)
            assertEquals(types[index], send.type)
            assertEquals(book.title, send.getStringExtra(Intent.EXTRA_SUBJECT))
            assertNull(send.`package`)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, send.flags)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,
                chooser.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val uri = send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!
            assertEquals("content", uri.scheme)
            assertEquals("${context.packageName}.books", uri.authority)
            assertEquals(uri, send.clipData!!.getItemAt(0).uri)
            assertEquals(uri, chooser.clipData!!.getItemAt(0).uri)
            assertEquals(file.readText(), context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() })
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)!!.use {
                assertTrue(it.moveToFirst())
                assertEquals("A book.${format.extension}", it.getString(0))
            }
        }
    }

    @Test fun sanitizesAttachmentNameWithoutChangingTitleOrBookContents() {
        val file = File(context.filesDir, "books/safe.epub")
        file.parentFile!!.mkdirs()
        file.writeText("unchanged")
        val title = "a/b\\c\n" + "x".repeat(150)
        val send = BookSharing.chooser(context, book.copy(title = title), file)
            .getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
        assertEquals(title, send.getStringExtra(Intent.EXTRA_SUBJECT))
        val uri = send.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)!!
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)!!.use {
            assertTrue(it.moveToFirst())
            assertEquals(("a_b_c_" + "x".repeat(150)).take(120) + ".epub", it.getString(0))
        }
        assertEquals("unchanged", file.readText())
    }

    @Test fun rejectsMissingPublicationsAndFilesOutsideTheBooksDirectory() {
        assertThrows(IllegalArgumentException::class.java) {
            BookSharing.chooser(context, book, File(context.filesDir, "missing.epub"))
        }
        val privateFile = File(context.filesDir, "settings.json").apply { writeText("private") }
        assertThrows(IllegalArgumentException::class.java) { BookSharing.chooser(context, book, privateFile) }
        val provider = context.packageManager.resolveContentProvider("${context.packageName}.books", 0)!!
        assertFalse(provider.exported)
        assertTrue(provider.grantUriPermissions)
    }

    @Test fun launchesChooserAndReportsRecoverableErrors() {
        val file = File(context.filesDir, "books/launch.epub")
        file.parentFile!!.mkdirs()
        file.writeText("book")
        var launched: Intent? = null
        var failure: Exception? = null
        val host = object : ContextWrapper(context) {
            override fun startActivity(intent: Intent) {
                failure?.let { throw it }
                launched = intent
            }
        }
        assertNull(BookSharing.share(host, book, file))
        assertEquals(Intent.ACTION_CHOOSER, launched!!.action)
        failure = android.content.ActivityNotFoundException("No sharing app available")
        assertEquals("No sharing app available", BookSharing.share(host, book, file))
        failure = IllegalStateException()
        assertEquals("Could not share this book", BookSharing.share(host, book, file))
        assertEquals("Download this book before sharing it",
            BookSharing.share(host, book, File(context.filesDir, "absent.epub")))
    }
}
