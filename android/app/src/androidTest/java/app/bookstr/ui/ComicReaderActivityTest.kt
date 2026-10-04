package app.bookstr.ui

import android.graphics.Bitmap
import android.graphics.Color
import android.view.ViewGroup
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.BookstrApp
import app.bookstr.ComicReaderActivity
import app.bookstr.data.BookFormat
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class ComicReaderActivityTest {
    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun evaluate(scenario: ActivityScenario<ComicReaderActivity>, script: String): String {
        val value = AtomicReference<String>()
        val done = CountDownLatch(1)
        scenario.onActivity { activity ->
            val web = findWebView(activity.findViewById(android.R.id.content)) ?: error("Comic WebView was not found")
            web.evaluateJavascript(script) { value.set(it); done.countDown() }
        }
        assertTrue("WebView evaluation completed", done.await(5, TimeUnit.SECONDS))
        return value.get()
    }
    private fun awaitPage(scenario: ActivityScenario<ComicReaderActivity>, page: Int) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45)
        var state = ""
        while (System.nanoTime() < deadline) {
            state = evaluate(scenario, "JSON.stringify({count:document.getElementById('count')?.textContent||'',ready:!!document.querySelector('#stage img')?.naturalWidth,error:document.getElementById('message')?.textContent})")
            val decoded = org.json.JSONTokener(state).nextValue()
            if (decoded !is String) { Thread.sleep(50); continue }
            val json = org.json.JSONObject(decoded)
            if (json.optString("count").startsWith("$page / ") && json.optBoolean("ready")) return
            Thread.sleep(50)
        }
        fail("Comic page $page did not load: $state")
    }
    private fun writeFixture(target: File, paddingBytes: Long, pageCount: Int = 2) {
        val image = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
        image.eraseColor(Color.BLUE)
        val png = ByteArrayOutputStream().also { image.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        image.recycle()
        ZipOutputStream(target.outputStream()).use { zip ->
            for (name in (pageCount downTo 1).map { "page-%02d.png".format(it) }) {
                zip.putNextEntry(ZipEntry(name)); zip.write(png); zip.closeEntry()
            }
            if (paddingBytes > 0) {
                val block = ByteArray(65536)
                val crc = CRC32()
                repeat((paddingBytes / block.size).toInt()) { crc.update(block) }
                zip.putNextEntry(ZipEntry("padding.bin").apply {
                    method = ZipEntry.STORED; size = paddingBytes; compressedSize = paddingBytes; this.crc = crc.value
                })
                repeat((paddingBytes / block.size).toInt()) { zip.write(block) }
                zip.closeEntry()
            }
        }
    }
    @Test fun streamedArchiveLoadsAndPersistsPageProgress() = exercise(0)
    @Test fun largeArchiveLoadsWithoutBase64CopiesInTheAppHeap() = exercise(48L * 1024 * 1024)

    @Test fun comicReaderKeepsScreenAwakeOnlyWhenReadingSettingEnabled() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val previous = app.settingsRepository.keepReadingOnLockScreen
        val target = app.catalogRepository.publicationFile("comic-awake-fixture", BookFormat.Cbz)
        writeFixture(target, 0)
        try {
            for (enabled in listOf(true, false)) {
                app.settingsRepository.keepReadingOnLockScreen = enabled
                ActivityScenario.launch<ComicReaderActivity>(ComicReaderActivity.intent(app, "comic-awake-fixture", BookFormat.Cbz, "Awake")).use { scenario ->
                    scenario.onActivity { activity ->
                        val awake = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
                        assertEquals(enabled, awake)
                    }
                }
            }
        } finally {
            app.settingsRepository.keepReadingOnLockScreen = previous
            target.delete()
        }
    }

    @Test fun wideLayoutShowsFacingPagesAndTurnsBySpread() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "comic-spread-fixture"
        val target = app.catalogRepository.publicationFile(bookId, BookFormat.Cbz)
        writeFixture(target, 0, pageCount = 4)
        try {
            ActivityScenario.launch<ComicReaderActivity>(ComicReaderActivity.intent(app, bookId, BookFormat.Cbz, "Spreads")).use { scenario ->
                val readyDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (System.nanoTime() < readyDeadline && evaluate(scenario,
                        "document.querySelector('#stage img')!==null&&document.getElementById('count').textContent.endsWith('/ 4')") != "true") {
                    Thread.sleep(50)
                }
                evaluate(scenario, "window.matchMedia=()=>({matches:true,addEventListener:()=>{}});show(1)")
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (System.nanoTime() < deadline && evaluate(scenario,
                        "document.querySelectorAll('#stage img').length===2&&document.getElementById('count').textContent.includes('2–3')") != "true") {
                    Thread.sleep(50)
                }
                assertEquals("true", evaluate(scenario,
                    "document.querySelectorAll('#stage img').length===2&&document.getElementById('count').textContent.includes('2–3')"))
                evaluate(scenario, "turn(1)")
                assertEquals("\"4 / 4\"", evaluate(scenario, "document.getElementById('count').textContent"))
            }
        } finally { target.delete() }
    }

    private fun exercise(paddingBytes: Long) {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val bookId = "comic-stream-regression-$paddingBytes"
        val target = app.catalogRepository.publicationFile(bookId, BookFormat.Cbz)
        val fixture = InstrumentationRegistry.getArguments().getString("comicFixture")
        if (fixture != null && paddingBytes > 0) File(fixture).copyTo(target, overwrite = true)
        else writeFixture(target, paddingBytes)
        kotlinx.coroutines.runBlocking { app.catalogRepository.clearProgress(bookId) }
        try {
            ActivityScenario.launch<ComicReaderActivity>(ComicReaderActivity.intent(app, bookId, BookFormat.Cbz, "Comic fixture")).use { scenario ->
                awaitPage(scenario, 1)
                evaluate(scenario, "document.getElementById('next').click()")
                awaitPage(scenario, 2)
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (System.nanoTime() < deadline && kotlinx.coroutines.runBlocking { app.catalogRepository.getProgress(bookId) }?.cfi?.startsWith("comic:1:") != true) Thread.sleep(50)
                assertTrue(kotlinx.coroutines.runBlocking { app.catalogRepository.getProgress(bookId) }!!.cfi.startsWith("comic:1:"))
            }
            ActivityScenario.launch<ComicReaderActivity>(ComicReaderActivity.intent(app, bookId, BookFormat.Cbz, "Comic fixture")).use { awaitPage(it, 2) }
        } finally {
            target.delete()
            kotlinx.coroutines.runBlocking { app.catalogRepository.clearProgress(bookId) }
        }
    }
}
