package app.bookstr

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import app.bookstr.data.BookFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class ComicReaderActivity : ComponentActivity() {
    private lateinit var bookId: String
    private lateinit var archive: File
    private lateinit var format: BookFormat

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        bookId = intent.getStringExtra(EXTRA_BOOK_ID).orEmpty()
        val app = application as BookstrApp
        format = BookFormat.from(intent.getStringExtra(EXTRA_FORMAT), intent.getStringExtra(EXTRA_URL))
        archive = app.catalogRepository.publicationFile(bookId, format)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/books/", object : WebViewAssetLoader.PathHandler {
                override fun handle(path: String): WebResourceResponse? = if (path == archive.name && archive.isFile) {
                    WebResourceResponse("application/octet-stream", null, archive.inputStream())
                } else null
            })
            .build()
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = false
        web.addJavascriptInterface(object {
            @JavascriptInterface fun onComicProgress(pageIndex: Int, pageCount: Int) {
                val progression = if (pageCount > 1) pageIndex.toDouble() / (pageCount - 1).toDouble() else 0.0
                lifecycleScope.launch { app.catalogRepository.saveProgress(bookId, progression, "comic:$pageIndex:$pageCount") }
            }
        }, "BookstrComic")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = loader.shouldInterceptRequest(request.url)
            override fun onPageFinished(view: WebView, url: String) {
                if (!url.endsWith("/assets/comic-reader.html") || !archive.isFile) return
                lifecycleScope.launch {
                    val saved = app.catalogRepository.getProgress(bookId)
                    val encoded = withContext(Dispatchers.IO) { Base64.encodeToString(archive.readBytes(), Base64.NO_WRAP) }
                    val initial = saved?.cfi?.substringAfter("comic:")?.substringBefore(':')?.toIntOrNull() ?: saved?.progression?.toInt() ?: 0
                    view.evaluateJavascript("loadComic({format:${quote(format.extension)},bookTitle:${quote(intent.getStringExtra(EXTRA_TITLE) ?: "Comic")},base64:${quote(encoded)},initialPage:$initial})", null)
                }
            }
        }
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/comic-reader.html")
    }

    private fun quote(value: String) = org.json.JSONObject.quote(value)

    companion object {
        private const val EXTRA_BOOK_ID = "book_id"
        private const val EXTRA_FORMAT = "format"
        private const val EXTRA_URL = "url"
        private const val EXTRA_TITLE = "title"
        fun intent(context: android.content.Context, bookId: String, format: BookFormat, title: String, url: String? = null) =
            android.content.Intent(context, ComicReaderActivity::class.java).apply {
                putExtra(EXTRA_BOOK_ID, bookId); putExtra(EXTRA_FORMAT, format.extension)
                putExtra(EXTRA_TITLE, title); putExtra(EXTRA_URL, url)
            }
    }
}
