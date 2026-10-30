package app.bookstr

import android.app.Activity
import android.app.ActivityOptions
import android.app.Instrumentation
import android.content.ComponentName
import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.app.PendingIntent
import android.support.v4.media.MediaBrowserCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ActivityScenario
import androidx.core.content.ContextCompat
import app.bookstr.data.BookFormat
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class NarrationMediaBrowserTest {
    @Test
    fun browserListsDownloadedMetadataAndOnlyEpubsHaveForegroundReaderIntents() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val context = app
        val metadataFile = File(context.filesDir, "downloaded-books.json")
        val previousMetadata = metadataFile.takeIf(File::isFile)?.readText()
        val id = UUID.randomUUID().toString().replace("-", "")
        val pdfId = UUID.randomUUID().toString().replace("-", "")
        val epubFile = app.catalogRepository.publicationFile(id, BookFormat.Epub).apply {
            parentFile?.mkdirs()
            writeTestEpub(this)
        }
        val booksDir = epubFile.parentFile ?: error("Book directory is unavailable")
        val pdfFile = File(booksDir, "$pdfId.pdf").apply { writeBytes("%PDF-1.7".toByteArray()) }
        val loaded = CountDownLatch(1)
        val connected = CountDownLatch(1)
        var result = emptyList<MediaBrowserCompat.MediaItem>()
        var browser: MediaBrowserCompat? = null
        var openedReader: Activity? = null
        var readerMonitor: Instrumentation.ActivityMonitor? = null
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val readerRequest = CountDownLatch(1)
        val speechTextReady = CountDownLatch(1)
        var bufferingObserved = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) != id) return
                if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)) {
                    bufferingObserved = intent.getBooleanExtra(NarrationService.EXTRA_IS_PREPARING, false) &&
                        intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false)
                    readerRequest.countDown()
                }
                if (intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false) &&
                    intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false)
                ) speechTextReady.countDown()
            }
        }
        try {
            val staleCfi = "epubcfi(/6/2[chapter]!/4/2/1:0)"
            val latestCfi = "epubcfi(/6/2[chapter]!/4/2/1:20)"
            runBlocking { app.catalogRepository.saveProgress(id, 0.05, staleCfi) }
            val catalog = runCatching { JSONObject(previousMetadata ?: "{}").optJSONArray("books") }
                .getOrNull() ?: JSONArray()
            catalog.put(bookMetadata(id, "A downloaded EPUB", "epub"))
            catalog.put(bookMetadata(pdfId, "A downloaded PDF", "pdf"))
            metadataFile.writeText(JSONObject().put("books", catalog).toString())

            val callback = object : MediaBrowserCompat.ConnectionCallback() {
                override fun onConnected() {
                    connected.countDown()
                    val activeBrowser = checkNotNull(browser)
                    activeBrowser.subscribe(
                        activeBrowser.root,
                        object : MediaBrowserCompat.SubscriptionCallback() {
                            override fun onChildrenLoaded(
                                parentId: String,
                                children: MutableList<MediaBrowserCompat.MediaItem>,
                            ) {
                                result = children
                                loaded.countDown()
                            }
                        },
                    )
                }

                override fun onConnectionFailed() {
                    connected.countDown()
                }
            }
            instrumentation.runOnMainSync {
                browser = MediaBrowserCompat(
                    context,
                    ComponentName(context, NarrationService::class.java),
                    callback,
                    null,
                )
                browser?.connect()
            }
            assertTrue("service connection timed out", connected.await(10, TimeUnit.SECONDS))
            assertTrue("catalog load timed out", loaded.await(10, TimeUnit.SECONDS))

            assertTrue("Missing fixture EPUB; catalog was ${result.map { it.description.mediaId }}", result.any { it.description.mediaId == id })
            val epub = result.single { it.description.mediaId == id }
            val pdf = result.single { it.description.mediaId == pdfId }
            assertEquals("A downloaded EPUB", epub.description.title)
            assertEquals("epub", epub.description.extras?.getString(BookstrMediaCatalog.EXTRA_FORMAT))
            assertTrue(epub.isPlayable)
            assertTrue(epub.description.extras?.getBoolean(BookstrMediaCatalog.EXTRA_PLAYABLE) == true)
            val openReader = checkNotNull(
                epub.description.extras?.getParcelable<PendingIntent>(BookstrMediaCatalog.EXTRA_OPEN_READER),
            )
            assertEquals(context.packageName, openReader.creatorPackage)
            assertTrue("Reader launch PendingIntent must be immutable", openReader.isImmutable)

            // Exercise the cross-app contract from a foreground tap, not only the serialized
            // MediaDescription. The reader owns the decision to request narration after load.
            runBlocking { app.catalogRepository.saveProgress(id, 0.55, latestCfi) }
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(NarrationService.ACTION_EVENT),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            readerMonitor = instrumentation.addMonitor(ReaderActivity::class.java.name, null, false)
            ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use { foreground ->
                foreground.onActivity { activity ->
                    if (android.os.Build.VERSION.SDK_INT >= 34) {
                        val options = ActivityOptions.makeBasic()
                            .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                            .toBundle()
                        openReader.send(activity, 0, null, null, null, null, options)
                    } else {
                        openReader.send(activity, 0, null)
                    }
                }
                openedReader = instrumentation.waitForMonitorWithTimeout(checkNotNull(readerMonitor), 10_000)
                assertNotNull("Reader PendingIntent did not open the Bookstr reader", openedReader)
                assertTrue(
                    "External reader launch must opt into narration after EPUB readiness",
                    openedReader!!.intent.getBooleanExtra(NarrationService.EXTRA_START_NARRATION, false),
                )
                assertTrue("Ready reader did not request narration text", readerRequest.await(30, TimeUnit.SECONDS))
                assertTrue("Reader request did not publish buffering/play state", bufferingObserved)
                assertTrue("Reader text did not reach the narration service", speechTextReady.await(30, TimeUnit.SECONDS))
                val cfiField = ReaderActivity::class.java.getDeclaredField("initialCfi").apply { isAccessible = true }
                assertEquals("Reader must prefer the latest saved position over its stale catalog snapshot", latestCfi, cfiField.get(openedReader))
            }

            assertEquals("A downloaded PDF", pdf.description.title)
            assertEquals("pdf", pdf.description.extras?.getString(BookstrMediaCatalog.EXTRA_FORMAT))
            assertFalse(pdf.isPlayable)
            assertFalse(pdf.description.extras?.getBoolean(BookstrMediaCatalog.EXTRA_PLAYABLE) == true)
            assertEquals(null, pdf.description.extras?.getParcelable<android.app.PendingIntent>(BookstrMediaCatalog.EXTRA_OPEN_READER))
        } finally {
            instrumentation.runOnMainSync {
                browser?.disconnect()
                openedReader?.finish()
            }
            readerMonitor?.let(instrumentation::removeMonitor)
            runCatching { context.unregisterReceiver(receiver) }
            context.stopService(android.content.Intent(context, NarrationService::class.java))
            epubFile.delete()
            pdfFile.delete()
            runBlocking { app.catalogRepository.clearProgress(id) }
            if (previousMetadata == null) metadataFile.delete() else metadataFile.writeText(previousMetadata)
        }
    }

    private fun bookMetadata(id: String, title: String, format: String) = JSONObject()
        .put("id", id)
        .put("title", title)
        .put("author", "Test author")
        .put("format", format)
        .put("epubUrl", "https://fixture.invalid/$id.$format")

    private fun writeTestEpub(target: File) {
        ZipOutputStream(target.outputStream()).use { zip ->
            val mime = "application/epub+zip".toByteArray()
            val crc = CRC32().apply { update(mime) }
            zip.putNextEntry(ZipEntry("mimetype").apply {
                method = ZipEntry.STORED
                size = mime.size.toLong()
                compressedSize = mime.size.toLong()
                this.crc = crc.value
            })
            zip.write(mime)
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("META-INF/container.xml"))
            zip.write("""<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("OEBPS/content.opf"))
            zip.write("""<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">${target.nameWithoutExtension}</dc:identifier><dc:title>Reader fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>""".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("OEBPS/chapter.xhtml"))
            val paragraph = "This downloaded EPUB contains readable narration text. "
            val text = buildString { repeat(20) { append(paragraph) } }
            zip.write("""<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Reader fixture</title></head><body><p>$text</p></body></html>""".toByteArray())
            zip.closeEntry()
        }
    }
}
