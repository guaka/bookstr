package app.bookstr

import android.graphics.Color
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.service.dreams.DreamService
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.core.content.ContextCompat
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking

internal data class DreamBookSelection(val session: ReaderSession, val file: File, val cfi: String?)

/** Shared by the service and its tests so the actual display policy is exercised. */
internal fun selectDreamBook(session: ReaderSession?, file: File?, progressCfi: String?): DreamBookSelection? {
    if (session == null || session.format != BookFormat.Epub || !BOOK_ID.matches(session.bookId)) return null
    if (file == null || !file.isFile) return null
    return DreamBookSelection(session, file, progressCfi?.takeIf(String::isNotBlank)
        ?: session.locator?.takeIf(String::isNotBlank))
}

internal fun shouldFollowDreamNarration(active: Boolean, playing: Boolean, selectedBookId: String?, narrationBookId: String?): Boolean =
    active && playing && selectedBookId != null && selectedBookId == narrationBookId

internal fun syncDreamNarration(context: Context, bookId: String) {
    // sync() is a no-op unless NarrationService is already running and never starts playback.
    NarrationService.sync(context, readerBookId = bookId)
}

internal fun dreamBookResponse(currentBookId: String?, file: File?, requestedPath: String): WebResourceResponse? {
    if (currentBookId == null || file == null || requestedPath != "$currentBookId.epub" || !file.isFile) return null
    return WebResourceResponse(
        "application/epub+zip", null, 200, "OK",
        mapOf("Content-Length" to file.length().toString(), "Cache-Control" to "no-store"),
        file.inputStream(),
    )
}

internal fun dreamReaderBootstrap(session: ReaderSession, cfi: String?, theme: String, font: String, alignment: String): String {
    val locator = cfi?.let(org.json.JSONObject::quote) ?: "null"
    return "setReaderTheme(${org.json.JSONObject.quote(theme)}); " +
        "setReaderTypography(${org.json.JSONObject.quote(font)}, ${org.json.JSONObject.quote(alignment)}, 0); " +
        "loadBookUrl(${org.json.JSONObject.quote(BOOK_URL_PREFIX + session.bookId + ".epub")}, " +
        "$locator, ${org.json.JSONObject.quote(theme)}, null, ${org.json.JSONObject.quote(session.bookId)});"
}

private val BOOK_ID = Regex("(?:[0-9a-f]{32}|[0-9a-f]{64})")
private const val BOOK_URL_PREFIX = "https://appassets.androidplatform.net/books/"

/** Displays the last saved EPUB location without changing reading progress. */
class BookPagesDreamService : DreamService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private var webView: WebView? = null
    private var active = false
    private var loaded = false
    @Volatile private var narrationPlaying = false
    @Volatile private var narrationBookId: String? = null
    @Volatile private var lastDisplayedCfi: String? = null
    private var receiverRegistered = false

    private val narrationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            narrationPlaying = intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false)
            narrationBookId = intent.getStringExtra(NarrationService.EXTRA_BOOK_ID)
        }
    }

    private val followNarration = object : Runnable {
        override fun run() {
            if (!active) return
            val bookId = selectedBookId
            if (bookId != null && shouldFollowDreamNarration(active, narrationPlaying, bookId, narrationBookId)) {
                io.execute {
                    val cfi = runBlocking { (application as BookstrApp).database.bookProgressDao().get(bookId)?.cfi }
                    if (cfi.isNullOrBlank() || cfi == lastDisplayedCfi) return@execute
                    lastDisplayedCfi = cfi
                    mainHandler.post {
                        if (active && narrationPlaying && narrationBookId == bookId) {
                            webView?.evaluateJavascript(
                                "if (window.displaySearchResult) window.displaySearchResult(${org.json.JSONObject.quote(cfi)});",
                                null,
                            )
                        }
                    }
                }
            }
            mainHandler.postDelayed(this, FOLLOW_INTERVAL_MS)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        window?.statusBarColor = Color.BLACK
        val view = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
            }
        }
        webView = view
        setContentView(view)
        view.loadUrl(READER_URL)
        ContextCompat.registerReceiver(
            this,
            narrationReceiver,
            IntentFilter(NarrationService.ACTION_EVENT),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
        // The selected book is synchronized when it is loaded, which publishes current narration state.
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        active = true
        loaded = false
        mainHandler.removeCallbacks(followNarration)
        mainHandler.postDelayed(followNarration, FOLLOW_INTERVAL_MS)
        io.execute {
            val app = application as BookstrApp
            val session = app.settingsRepository.readerSession()
                ?.takeIf { it.format == BookFormat.Epub && BOOK_ID.matches(it.bookId) }
            val file = session?.let { app.catalogRepository.epubFile(it.bookId) }
            val progressCfi = session?.let { runBlocking { app.database.bookProgressDao().get(it.bookId)?.cfi } }
            val resolved = selectDreamBook(session, file, progressCfi)
            mainHandler.post {
                if (!active || loaded) return@post
                loaded = true
                if (resolved == null) showFallback()
                else {
                    lastDisplayedCfi = resolved.cfi
                    showBook(resolved.session, resolved.file, resolved.cfi)
                }
            }
        }
    }

    override fun onDreamingStopped() {
        active = false
        mainHandler.removeCallbacks(followNarration)
        webView?.stopLoading()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        active = false
        mainHandler.removeCallbacks(followNarration)
        if (receiverRegistered) {
            unregisterReceiver(narrationReceiver)
            receiverRegistered = false
        }
        disposeWebView()
        super.onDetachedFromWindow()
    }

    override fun onDestroy() {
        active = false
        mainHandler.removeCallbacks(followNarration)
        if (receiverRegistered) {
            unregisterReceiver(narrationReceiver)
            receiverRegistered = false
        }
        disposeWebView()
        io.shutdownNow()
        super.onDestroy()
    }

    private fun disposeWebView() {
        val view = webView ?: return
        (view.parent as? ViewGroup)?.removeView(view)
        view.stopLoading()
        view.destroy()
        webView = null
    }

    private val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/books/", WebViewAssetLoader.PathHandler { path ->
                dreamBookResponse(selectedBookId, selectedBookFile, path)
            })
            .build()
    }

    @Volatile private var selectedBookId: String? = null
    @Volatile private var selectedBookFile: File? = null

    private fun showBook(session: ReaderSession, file: File, cfi: String?) {
        selectedBookId = session.bookId
        selectedBookFile = file
        syncDreamNarration(this, session.bookId)
        webView?.settings?.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        webView?.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: android.webkit.WebResourceRequest) =
                assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                if (!url.endsWith("/assets/reader.html")) return
                val settings = (application as BookstrApp).settingsRepository
                val script = dreamReaderBootstrap(session, cfi, settings.theme.key, settings.readerFont.key, settings.readerAlignment.key)
                view.evaluateJavascript(
                    script,
                    null,
                )
                view.contentDescription = session.bookTitle
            }
        }
        webView?.setBackgroundColor(Color.rgb(244, 240, 230))
        webView?.loadUrl(READER_URL)
    }

    private fun showFallback() {
        disposeWebView()
        val icon = runCatching { packageManager.getApplicationIcon(packageName) }.getOrNull()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
        }
        if (icon != null) root.addView(ImageView(this).apply { setImageDrawable(icon) },
            LinearLayout.LayoutParams(96, 96))
        root.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            setTextColor(Color.WHITE)
            textSize = 24f
            gravity = Gravity.CENTER
            contentDescription = getString(R.string.app_name)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }

    companion object {
        private const val READER_URL = "https://appassets.androidplatform.net/assets/reader.html"
        private const val FOLLOW_INTERVAL_MS = 2_000L
    }
}
