package app.bookstr

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import app.bookstr.data.ReaderTheme
import app.bookstr.ui.theme.BookstrThemeFromSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import android.util.Base64

class ReaderActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var chromeVisible by mutableStateOf(false)
    private var keepOnLockScreen by mutableStateOf(false)
    private var bookId: String = ""
    private var bookTitle: String = ""
    private var initialCfi: String? = null
    private var readerTheme: ReaderTheme = ReaderTheme.Paper

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bookId = intent.getStringExtra(EXTRA_BOOK_ID) ?: run {
            finish()
            return
        }
        bookTitle = intent.getStringExtra(EXTRA_BOOK_TITLE) ?: "bookstr"
        initialCfi = intent.getStringExtra(EXTRA_INITIAL_CFI)
        readerTheme = ReaderTheme.fromKey(intent.getStringExtra(EXTRA_THEME))

        val app = application as BookstrApp
        keepOnLockScreen = app.settingsRepository.keepReadingOnLockScreen
        applyLockScreenPolicy(keepOnLockScreen)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemUi()

        setContent {
            BookstrThemeFromSettings(readerTheme = readerTheme) {
                Box(modifier = Modifier.fillMaxSize()) {
                    ReaderWebView(
                        onWebViewReady = { webView = it },
                        bookId = bookId,
                        initialCfi = initialCfi,
                        theme = readerTheme,
                        onToggleChrome = { chromeVisible = !chromeVisible },
                        onProgress = { progression, cfi ->
                            lifecycleScope.launch {
                                app.catalogRepository.saveProgress(bookId, progression, cfi)
                                app.nostrRepository.publishProgress(bookId, progression, cfi)
                            }
                        },
                    )

                    AnimatedVisibility(
                        visible = chromeVisible,
                        modifier = Modifier.align(Alignment.TopCenter),
                    ) {
                        ReaderChrome(
                            title = bookTitle,
                            keepOnLockScreen = keepOnLockScreen,
                            onKeepOnLockScreenChange = { enabled ->
                                keepOnLockScreen = enabled
                                app.settingsRepository.keepReadingOnLockScreen = enabled
                                applyLockScreenPolicy(enabled)
                            },
                            onBack = { finish() },
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val app = application as BookstrApp
        applyLockScreenPolicy(app.settingsRepository.keepReadingOnLockScreen)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> {
                webView?.evaluateJavascript("prevPage();", null)
                return true
            }
            KeyEvent.KEYCODE_VOLUME_DOWN -> {
                webView?.evaluateJavascript("nextPage();", null)
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun applyLockScreenPolicy(enabled: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(enabled)
            setTurnScreenOn(enabled)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                setInheritShowWhenLocked(enabled)
            }
        } else {
            @Suppress("DEPRECATION")
            if (enabled) {
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
                )
            } else {
                window.clearFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
                )
            }
        }
    }

    private fun hideSystemUi() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    companion object {
        private const val EXTRA_BOOK_ID = "book_id"
        private const val EXTRA_BOOK_TITLE = "book_title"
        private const val EXTRA_INITIAL_CFI = "initial_cfi"
        private const val EXTRA_THEME = "theme"

        fun intent(
            context: Context,
            bookId: String,
            bookTitle: String,
            initialCfi: String?,
            theme: ReaderTheme,
        ): Intent =
            Intent(context, ReaderActivity::class.java).apply {
                putExtra(EXTRA_BOOK_ID, bookId)
                putExtra(EXTRA_BOOK_TITLE, bookTitle)
                putExtra(EXTRA_INITIAL_CFI, initialCfi)
                putExtra(EXTRA_THEME, theme.key)
            }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReaderChrome(
    title: String,
    keepOnLockScreen: Boolean,
    onKeepOnLockScreenChange: (Boolean) -> Unit,
    onBack: () -> Unit,
) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
            }
        },
        actions = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(end = 8.dp),
            ) {
                Text("Lock", color = Color.White)
                Switch(
                    checked = keepOnLockScreen,
                    onCheckedChange = onKeepOnLockScreenChange,
                )
            }
        },
        modifier = Modifier.background(Color.Black.copy(alpha = 0.55f)),
    )
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ReaderWebView(
    onWebViewReady: (WebView) -> Unit,
    bookId: String,
    initialCfi: String?,
    theme: ReaderTheme,
    onToggleChrome: () -> Unit,
    onProgress: (Double, String) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as BookstrApp

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                .build()

            WebView(ctx).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.allowFileAccess = true
                settings.domStorageEnabled = true

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: android.webkit.WebResourceRequest,
                    ) = assetLoader.shouldInterceptRequest(request.url)
                }

                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun onToggleChrome() {
                            (ctx as? ComponentActivity)?.runOnUiThread { onToggleChrome() }
                        }

                        @JavascriptInterface
                        fun onRelocated(json: String) {
                            try {
                                val obj = JSONObject(json)
                                val progression = obj.optDouble("progression", 0.0)
                                val cfi = obj.optString("cfi", "")
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onProgress(progression, cfi)
                                }
                            } catch (_: Exception) {
                            }
                        }
                    },
                    "AndroidBridge",
                )

                onWebViewReady(this)

                loadUrl("https://appassets.androidplatform.net/assets/reader.html")

                (ctx as? ComponentActivity)?.lifecycleScope?.launch {
                    val epubFile = withContext(Dispatchers.IO) {
                        app.catalogRepository.epubFile(bookId)
                    }
                    if (!epubFile.exists()) return@launch
                    val base64 = withContext(Dispatchers.IO) {
                        Base64.encodeToString(epubFile.readBytes(), Base64.NO_WRAP)
                    }
                    val cfiJs = initialCfi?.let { org.json.JSONObject.quote(it) } ?: "null"
                    val themeJs = org.json.JSONObject.quote(theme.key)
                    evaluateJavascript(
                        "loadBook(${org.json.JSONObject.quote(base64)}, $cfiJs, $themeJs);",
                        null,
                    )
                }
            }
        },
    )
}
