package app.bookstr

import android.app.Activity
import android.content.Intent
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebResourceRequest
import android.widget.Button
import android.widget.LinearLayout
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.bookstr.data.BookFormat
import app.bookstr.data.BookProgress
import app.bookstr.data.ReaderSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.rules.TemporaryFolder
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.Shadows.shadowOf
import java.io.File
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking

@RunWith(RobolectricTestRunner::class)
@Config(
    sdk = [35],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedPreferences::class],
    instrumentedPackages = ["androidx.security.crypto"],
)
class BookPagesDreamServiceTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    private val bookId = "0123456789abcdef0123456789abcdef"
    private val session = ReaderSession(
        bookId = bookId,
        bookTitle = "Example book",
        author = "Example author",
        format = BookFormat.Epub,
        locator = "session-cfi",
    )

    @Test
    fun savedEpubSelectionUsesPersistedProgressThenSessionLocator() {
        val file = temporaryFolder.newFile("$bookId.epub")

        val progressSelection = selectDreamBook(session, file, "progress-cfi")
        assertEquals("progress-cfi", progressSelection?.cfi)
        assertEquals(session, progressSelection?.session)
        assertEquals(file, progressSelection?.file)

        val sessionSelection = selectDreamBook(session, file, "  ")
        assertEquals("session-cfi", sessionSelection?.cfi)
    }

    @Test
    fun missingSessionFileOrUnsupportedFormatSelectsFallback() {
        val file = temporaryFolder.newFile("$bookId.epub")
        assertNull(selectDreamBook(null, file, "progress-cfi"))
        assertNull(selectDreamBook(session, null, "progress-cfi"))
        assertNull(selectDreamBook(session, File(temporaryFolder.root, "missing.epub"), "progress-cfi"))
        assertNull(selectDreamBook(session.copy(format = BookFormat.Pdf), file, "progress-cfi"))
        assertNull(selectDreamBook(session.copy(bookId = "../outside"), file, "progress-cfi"))
    }

    @Test
    fun narrationFollowRequiresActiveDreamPlayingStateAndMatchingBook() {
        assertTrue(shouldFollowDreamNarration(true, true, bookId, bookId))
        assertFalse(shouldFollowDreamNarration(false, true, bookId, bookId))
        assertFalse(shouldFollowDreamNarration(true, false, bookId, bookId))
        assertFalse(shouldFollowDreamNarration(true, true, bookId, "fedcba9876543210fedcba9876543210"))
        assertFalse(shouldFollowDreamNarration(true, true, null, bookId))
    }

    @Test
    fun serviceRequestsCurrentNarrationStateWithoutStartingPlayback() {
        val app = org.robolectric.RuntimeEnvironment.getApplication() as BookstrApp
        val wasRunning = ReflectionHelpers.getStaticField<Boolean>(NarrationService::class.java, "running")
        try {
            ReflectionHelpers.setStaticField(NarrationService::class.java, "running", true)
            syncDreamNarration(app, bookId)
            val request = shadowOf(app).nextStartedService
            assertEquals(NarrationService::class.java.name, request?.component?.className)
            assertEquals(bookId, request?.getStringExtra(NarrationService.EXTRA_BOOK_ID))
            assertTrue(request?.action?.endsWith("NARRATION_SYNC") == true)
            assertFalse(request?.getBooleanExtra(NarrationService.EXTRA_START_NARRATION, false) == true)
        } finally {
            ReflectionHelpers.setStaticField(NarrationService::class.java, "running", wasRunning)
        }
    }

    @Test
    fun bookAssetResponseServesOnlyTheSelectedExistingEpub() {
        val file = temporaryFolder.newFile("$bookId.epub").apply { writeText("bounded epub fixture") }
        val response = requireNotNull(dreamBookResponse(bookId, file, "$bookId.epub"))
        assertEquals("application/epub+zip", response.mimeType)
        assertEquals(file.length().toString(), response.responseHeaders?.get("Content-Length"))
        assertEquals("bounded epub fixture", response.data.bufferedReader().use { it.readText() })

        assertNull(dreamBookResponse(bookId, file, "other.epub"))
        assertNull(dreamBookResponse(null, file, "$bookId.epub"))
        assertNull(dreamBookResponse(bookId, null, "$bookId.epub"))
        file.delete()
        assertNull(dreamBookResponse(bookId, file, "$bookId.epub"))
    }

    @Test
    fun bootstrapUsesTheReaderAssetApiAndEscapesSavedLocation() {
        val cfi = "epubcfi(/6/2[id]!/4/1:4)"
        val script = dreamReaderBootstrap(session, cfi, "night", "georgia", "left")

        assertTrue(script.contains("setReaderTheme(\"night\")"))
        assertTrue(script.contains("setReaderTypography(\"georgia\", \"left\", 0)"))
        val arguments = loadBookArguments(script)
        assertEquals("https://appassets.androidplatform.net/books/$bookId.epub", arguments.getString(0))
        assertEquals(cfi, arguments.getString(1))
        assertTrue(script.contains("\"$bookId\")"))
        assertFalse(script.contains("saveProgress"))
        val readerHtml = File("../../shared/reader/reader.html").readText()
        assertTrue(readerHtml.contains("window.loadBookUrl"))
        assertTrue(readerHtml.contains(Regex("""window\.restoreReaderLocation\s*=\s*function\s*\(cfi\)""")))
    }

    @Test
    fun missingSessionUsesFallbackAndLifecycleDoesNotMutateProgress() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val controller = Robolectric.buildService(BookPagesDreamService::class.java).create()
        val service = controller.get()
        ReflectionHelpers.setField(service, "mWindow", activity.window)
        service.onAttachedToWindow()
        assertTrue(service.isFullscreen)
        assertFalse(service.isInteractive)

        val app = service.application as BookstrApp
        app.settingsRepository.clearReaderSession()
        val before = runBlocking { app.database.bookProgressDao().getAll() }
        service.onDreamingStarted()
        val queued = CountDownLatch(1)
        ReflectionHelpers.getField<ExecutorService>(service, "io").execute { queued.countDown() }
        assertTrue("Dream IO work should finish", queued.await(5, TimeUnit.SECONDS))
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        val content = service.window?.decorView?.findViewById<ViewGroup>(android.R.id.content)
        assertTrue(content?.getChildAt(0) is LinearLayout)
        assertNull(service.window?.findViewById<Button>(R.id.dream_open_page))
        assertFalse(service.isInteractive)
        assertEquals(before, runBlocking { app.database.bookProgressDao().getAll() })

        service.sendBroadcast(Intent(NarrationService.ACTION_EVENT).setPackage(service.packageName)
            .putExtra(NarrationService.EXTRA_IS_PLAYING, true)
            .putExtra(NarrationService.EXTRA_BOOK_ID, bookId))
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        assertTrue(ReflectionHelpers.getField<Boolean>(service, "narrationPlaying"))
        assertEquals(bookId, ReflectionHelpers.getField<String?>(service, "narrationBookId"))

        service.onDreamingStopped()
        service.onDetachedFromWindow()
        controller.destroy()
        activity.finish()
        assertFalse(shouldFollowDreamNarration(false, true, bookId, bookId))
    }

    @Test
    fun assetInterceptionAndDestroyCleanUpUseAttachedWebViewAndReceiver() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val controller = Robolectric.buildService(BookPagesDreamService::class.java).create()
        val service = controller.get()
        ReflectionHelpers.setField(service, "mWindow", activity.window)
        service.onAttachedToWindow()

        val webView = ReflectionHelpers.getField<WebView>(service, "webView")
        val client = Shadows.shadowOf(webView).webViewClient
        assertNull("The reader must wait for a book before loading", Shadows.shadowOf(webView).lastLoadedUrl)
        val readerAsset = client.shouldInterceptRequest(
            webView,
            webResourceRequest("https://appassets.androidplatform.net/assets/reader.html"),
        )
        assertTrue(readerAsset != null)
        assertNull(client.shouldInterceptRequest(
            webView,
            webResourceRequest("https://appassets.androidplatform.net/books/$bookId.epub"),
        ))
        assertTrue(ReflectionHelpers.getField<Boolean>(service, "receiverRegistered"))

        service.onDestroy()

        assertFalse(ReflectionHelpers.getField<Boolean>(service, "receiverRegistered"))
        assertNull(ReflectionHelpers.getField<WebView?>(service, "webView"))
        controller.destroy()
        activity.finish()
    }

    @Test
    fun savedEpubFollowsNarrationAndRemoteSelectOpensDisplayedPageSilently() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val controller = Robolectric.buildService(BookPagesDreamService::class.java).create()
        val service = controller.get()
        ReflectionHelpers.setField(service, "mWindow", activity.window)
        service.onAttachedToWindow()

        val app = service.application as BookstrApp
        val file = app.catalogRepository.epubFile(bookId).apply { writeText("fixture publication") }
        val savedSession = session.copy(locator = "session-locator")
        app.settingsRepository.saveReaderSession(savedSession)
        val initialProgress = BookProgress(bookId, 0.25, "saved-progress-cfi", 10L)
        runBlocking {
            app.database.bookProgressDao().upsert(initialProgress)
        }

        service.onDreamingStarted()
        awaitDreamIo(service)
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val webView = ReflectionHelpers.getField<WebView>(service, "webView")
        val webShadow = Shadows.shadowOf(webView)
        webShadow.webViewClient.onPageFinished(webView, "https://appassets.androidplatform.net/assets/reader.html")
        val epubResponse = webShadow.webViewClient.shouldInterceptRequest(
            webView,
            webResourceRequest("https://appassets.androidplatform.net/books/$bookId.epub"),
        )
        assertEquals("fixture publication", requireNotNull(epubResponse).data.bufferedReader().use { it.readText() })
        assertNull(webShadow.webViewClient.shouldInterceptRequest(
            webView,
            webResourceRequest("https://appassets.androidplatform.net/books/other.epub"),
        ))
        val initialScript = requireNotNull(webShadow.lastEvaluatedJavascript)
        val arguments = loadBookArguments(initialScript)
        assertEquals("https://appassets.androidplatform.net/books/$bookId.epub", arguments.getString(0))
        assertEquals("saved-progress-cfi", arguments.getString(1))

        service.sendBroadcast(Intent(NarrationService.ACTION_EVENT).setPackage(service.packageName)
            .putExtra(NarrationService.EXTRA_IS_PLAYING, true)
            .putExtra(NarrationService.EXTRA_BOOK_ID, bookId))
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        val narrationProgress = initialProgress.copy(progression = 0.4, cfi = "narration-progress-cfi", updatedAt = 20L)
        runBlocking { app.database.bookProgressDao().upsert(narrationProgress) }
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.SECONDS)
        awaitDreamIo(service)
        Shadows.shadowOf(Looper.getMainLooper()).idle()

        val followScript = requireNotNull(webShadow.lastEvaluatedJavascript)
        assertTrue(followScript.contains("window.restoreReaderLocation(\"narration-progress-cfi\")"))
        assertFalse(followScript.contains("displaySearchResult"))
        assertEquals(narrationProgress, runBlocking { app.database.bookProgressDao().get(bookId) })

        val openPage = requireNotNull(service.window?.findViewById<Button>(R.id.dream_open_page))
        assertTrue(service.isInteractive)
        assertTrue(openPage.hasFocus())
        assertEquals("Open Example book at this page", openPage.contentDescription)
        assertTrue(openPage.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER)))
        assertTrue(openPage.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER)))
        Shadows.shadowOf(Looper.getMainLooper()).idle()
        val reader = requireNotNull(shadowOf(app).nextStartedActivity)
        assertEquals(ReaderActivity::class.java.name, reader.component?.className)
        assertEquals(bookId, reader.getStringExtra("book_id"))
        assertEquals("narration-progress-cfi", reader.getStringExtra("initial_cfi"))
        assertFalse(reader.getBooleanExtra(NarrationService.EXTRA_START_NARRATION, true))
        assertEquals(narrationProgress, runBlocking { app.database.bookProgressDao().get(bookId) })

        service.onDreamingStopped()
        service.onDetachedFromWindow()
        controller.destroy()
        activity.finish()
        file.delete()
        app.settingsRepository.clearReaderSession()
    }

    @Test
    fun disabledScreensaverOptionsLeaveTheSavedPagePassiveAndStationary() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val controller = Robolectric.buildService(BookPagesDreamService::class.java).create()
        val service = controller.get()
        ReflectionHelpers.setField(service, "mWindow", activity.window)
        service.onAttachedToWindow()
        val app = service.application as BookstrApp
        val file = app.catalogRepository.epubFile(bookId).apply { writeText("fixture publication") }
        app.settingsRepository.saveReaderSession(session)
        app.settingsRepository.dreamOpenPageOnSelect = false
        app.settingsRepository.dreamFollowNarration = false
        try {
            service.onDreamingStarted()
            awaitDreamIo(service)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            val page = ReflectionHelpers.getField<WebView>(service, "webView")
            val webShadow = Shadows.shadowOf(page)
            webShadow.webViewClient.onPageFinished(page, "https://appassets.androidplatform.net/assets/reader.html")
            val initialScript = requireNotNull(webShadow.lastEvaluatedJavascript)
            assertEquals("session-cfi", loadBookArguments(initialScript).getString(1))
            assertFalse(service.isInteractive)
            assertNull(service.window?.findViewById<Button>(R.id.dream_open_page))

            service.sendBroadcast(Intent(NarrationService.ACTION_EVENT).setPackage(service.packageName)
                .putExtra(NarrationService.EXTRA_IS_PLAYING, true)
                .putExtra(NarrationService.EXTRA_BOOK_ID, bookId))
            runBlocking { app.database.bookProgressDao().upsert(BookProgress(bookId, 0.5, "new-cfi", 20L)) }
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(2, TimeUnit.SECONDS)
            awaitDreamIo(service)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            assertEquals(initialScript, webShadow.lastEvaluatedJavascript)
            assertNull(shadowOf(app).nextStartedActivity)
        } finally {
            service.onDreamingStopped()
            service.onDetachedFromWindow()
            controller.destroy()
            activity.finish()
            file.delete()
            app.settingsRepository.clearReaderSession()
        }
    }

    private fun loadBookArguments(script: String): org.json.JSONArray =
        org.json.JSONArray("[" + script.substringAfter("loadBookUrl(").substringBeforeLast(");") + "]")

    private fun awaitDreamIo(service: BookPagesDreamService) {
        val queued = CountDownLatch(1)
        ReflectionHelpers.getField<ExecutorService>(service, "io").execute { queued.countDown() }
        assertTrue("Dream IO work should finish", queued.await(5, TimeUnit.SECONDS))
    }

    private fun webResourceRequest(url: String): WebResourceRequest =
        Proxy.newProxyInstance(
            WebResourceRequest::class.java.classLoader,
            arrayOf(WebResourceRequest::class.java),
        ) { _, method, _ ->
            when (method.name) {
                "getUrl" -> Uri.parse(url)
                "isForMainFrame", "hasGesture", "isRedirect" -> false
                "getMethod" -> "GET"
                "getRequestHeaders" -> emptyMap<String, String>()
                else -> null
            }
        } as WebResourceRequest
}

/** Robolectric does not provide AndroidKeyStore; app instrumentation tests retain real crypto coverage. */
@Implements(MasterKey.Builder::class)
class ShadowMasterKeyBuilder {
    @Implementation
    fun build(): MasterKey = ReflectionHelpers.callConstructor(
        MasterKey::class.java,
        ReflectionHelpers.ClassParameter.from(String::class.java, "bookstr-robolectric-test-key"),
        ReflectionHelpers.ClassParameter.from(Any::class.java, null),
    )
}

/** Use sandbox preferences only for these service lifecycle tests. */
@Implements(EncryptedSharedPreferences::class)
class ShadowEncryptedPreferences {
    companion object {
        @JvmStatic
        @Implementation
        fun create(
            context: Context,
            fileName: String,
            masterKey: MasterKey,
            keyScheme: EncryptedSharedPreferences.PrefKeyEncryptionScheme,
            valueScheme: EncryptedSharedPreferences.PrefValueEncryptionScheme,
        ): SharedPreferences = context.getSharedPreferences(fileName, Context.MODE_PRIVATE)
    }
}
