package app.bookstr.ui

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import app.bookstr.BookPagesDreamService
import app.bookstr.BookstrApp
import app.bookstr.NarrationService
import app.bookstr.ReaderActivity
import app.bookstr.data.BookFormat
import app.bookstr.data.BookProgress
import app.bookstr.data.ReaderSession
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class BookPagesDreamTest {
    @Test fun remoteSelectOpensTheScreensaverPageInTheReader() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "0123456789abcdef0123456789abcdef"
        val epub = app.catalogRepository.epubFile(bookId)
        val savedCfi = "epubcfi(/6/4[second]!/4/2/1:0)"
        val dreamSettings = mapOf(
            "screensaver_enabled" to "1",
            "screensaver_components" to ComponentName(app, BookPagesDreamService::class.java).flattenToString(),
        )
        val previousSettings = dreamSettings.keys.associateWith {
            Settings.Secure.getString(app.contentResolver, it)
        }
        val monitor = instrumentation.addMonitor(ReaderActivity::class.java.name, null, false)
        var reader: Activity? = null
        try {
            ZipOutputStream(epub.outputStream()).use { zip ->
                fun entry(name: String, value: String) {
                    zip.putNextEntry(ZipEntry(name))
                    zip.write(value.toByteArray())
                    zip.closeEntry()
                }
                entry("mimetype", "application/epub+zip")
                entry("META-INF/container.xml", """
                    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                      <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
                    </container>
                """.trimIndent())
                entry("book.opf", """
                    <package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
                      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:identifier id="id">dream-test</dc:identifier><dc:title>Screensaver fixture</dc:title>
                        <dc:language>en</dc:language>
                      </metadata>
                      <manifest>
                        <item id="first" href="first.xhtml" media-type="application/xhtml+xml"/>
                        <item id="second" href="second.xhtml" media-type="application/xhtml+xml"/>
                      </manifest>
                      <spine><itemref idref="first"/><itemref idref="second"/></spine>
                    </package>
                """.trimIndent())
                entry("first.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><body><p>First chapter.</p></body></html>""")
                entry("second.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Saved chapter.</p></body></html>""")
            }
            app.settingsRepository.saveReaderSession(ReaderSession(bookId, "Screensaver fixture", BookFormat.Epub))
            runBlocking { app.database.bookProgressDao().upsert(BookProgress(bookId, 0.5, savedCfi, System.currentTimeMillis())) }
            dreamSettings.forEach { (key, value) -> device.executeShellCommand("settings put secure $key $value") }

            app.startActivity(Intent(Settings.ACTION_DREAM_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            val preview = checkNotNull(
                device.wait(Until.findObject(By.res("com.android.settings", "dream_preview_button")), 5_000)
                    ?: device.wait(Until.findObject(By.text("Start now")), 10_000),
            ) { "Android Settings should offer a screensaver preview" }
            preview.click()
            assertTrue(
                "The Bookstr screensaver should offer the saved page",
                device.wait(Until.hasObject(By.res(app.packageName, "dream_open_page")), 20_000),
            )
            device.pressDPadCenter()

            val openedReader = checkNotNull(instrumentation.waitForMonitorWithTimeout(monitor, 15_000)) {
                "Remote Select should open the EPUB reader"
            }
            reader = openedReader
            assertEquals(bookId, openedReader.intent.getStringExtra("book_id"))
            assertEquals(savedCfi, openedReader.intent.getStringExtra("initial_cfi"))
            assertFalse(openedReader.intent.getBooleanExtra(NarrationService.EXTRA_START_NARRATION, true))
        } finally {
            instrumentation.removeMonitor(monitor)
            instrumentation.runOnMainSync { reader?.finish() }
            device.pressHome()
            previousSettings.forEach { (key, value) ->
                if (value == null) device.executeShellCommand("settings delete secure $key")
                else device.executeShellCommand("settings put secure $key $value")
            }
            app.settingsRepository.clearReaderSession()
            epub.delete()
            runBlocking { app.catalogRepository.clearProgress(bookId) }
        }
    }
}
