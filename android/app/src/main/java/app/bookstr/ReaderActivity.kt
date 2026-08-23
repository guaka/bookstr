package app.bookstr

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.util.Log
import android.view.KeyEvent
import android.view.ActionMode
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ConsoleMessage
import android.webkit.WebView
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import app.bookstr.data.ReaderTheme
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import app.bookstr.data.DictionaryDefinition
import app.bookstr.nostr.AmberIntentSession
import app.bookstr.ui.theme.BookstrThemeFromSettings
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import android.webkit.WebResourceResponse
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class ReaderActivity : ComponentActivity() {
    private var webView: WebView? = null
    private var readerLoading by mutableStateOf(true)
    private var readerError by mutableStateOf<String?>(null)
    private var readerProgress by mutableStateOf(0f)
    private var readerFurthestProgress by mutableStateOf(0f)
    private var readerSectionCount by mutableStateOf(1)
    private var readerSectionIndex by mutableStateOf(0)
    private var readerSections by mutableStateOf<List<ReaderSection>>(emptyList())
    private var showSections by mutableStateOf(false)
    private var knownWords by mutableStateOf<List<String>>(emptyList())
    private var bookId: String = ""
    private var bookTitle by mutableStateOf("")
    private var bookAuthor by mutableStateOf<String?>(null)
    private var bookYear by mutableStateOf<String?>(null)
    private var bookCoverUrl: String? = null
    private var initialCfi: String? = null
    private var highlightCfi: String? = null
    private var lastCfi: String? = null
    private var closingReader = false
    private var referenceJump = false
    private var readerInteracted = false
    private var referenceDecisionMade = false
    private var showProgressPrompt by mutableStateOf(false)
    private var isSpeaking by mutableStateOf(false)
    private var speechMessage by mutableStateOf<String?>(null)
    private var readerTheme: ReaderTheme = ReaderTheme.Paper
    private lateinit var amberSession: AmberIntentSession
    private val narrationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == NarrationService.ACTION_EVENT) handleNarrationEvent(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bookId = intent.getStringExtra(EXTRA_BOOK_ID) ?: run {
            finish()
            return
        }
        bookTitle = intent.getStringExtra(EXTRA_BOOK_TITLE) ?: "bookstr"
        bookAuthor = intent.getStringExtra(EXTRA_BOOK_AUTHOR)
        bookYear = intent.getStringExtra(EXTRA_BOOK_YEAR)
        bookCoverUrl = intent.getStringExtra(EXTRA_BOOK_COVER_URL)
        initialCfi = intent.getStringExtra(EXTRA_INITIAL_CFI)
        highlightCfi = intent.getStringExtra(EXTRA_HIGHLIGHT_CFI)
        referenceJump = !highlightCfi.isNullOrBlank()
        lastCfi = initialCfi
        readerTheme = ReaderTheme.fromKey(intent.getStringExtra(EXTRA_THEME))

        val app = application as BookstrApp
        if (!referenceJump) app.settingsRepository.saveReaderSession(
            ReaderSession(
                bookId,
                bookTitle,
                BookFormat.Epub,
                author = bookAuthor,
                year = bookYear,
                locator = lastCfi,
            ),
        )
        applyLockScreenPolicy(app.settingsRepository.keepReadingOnLockScreen)
        amberSession = AmberIntentSession(this)
        ContextCompat.registerReceiver(
            this,
            narrationReceiver,
            IntentFilter(NarrationService.ACTION_EVENT),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        lifecycleScope.launch {
            app.catalogRepository.getProgress(bookId)?.let {
                readerFurthestProgress = maxOf(it.progression, it.furthestProgression).toFloat()
            }
            knownWords = app.vocabularyRepository.all()
                .map { it.word.trim().lowercase() }
                .filter(String::isNotBlank)
                .distinct()
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemUi()

        setContent {
            BookstrThemeFromSettings(readerTheme = readerTheme) {
                Box(modifier = Modifier.fillMaxSize()) {
                    ReaderWebView(
                        onWebViewReady = { webView = it },
                        bookId = bookId,
                        initialCfi = initialCfi,
                        highlightCfi = highlightCfi,
                        knownWords = knownWords,
                        theme = readerTheme,
                        onReaderReady = {
                            readerLoading = false
                            webView?.evaluateJavascript("requestSpeechText(false);", null)
                            NarrationService.sync(this@ReaderActivity)
                        },
                        onMetadata = { title, author, year ->
                            title?.takeIf(String::isNotBlank)?.let { bookTitle = it }
                            author?.takeIf(String::isNotBlank)?.let { bookAuthor = it }
                            year?.takeIf(String::isNotBlank)?.let { bookYear = it }
                        },
                        onSections = { sections -> readerSections = sections },
                        onReaderError = { message ->
                            readerError = message
                            app.settingsRepository.clearReaderSession()
                        },
                        onWordSelected = { word, language, cfi, contextSentence ->
                            lifecycleScope.launch {
                                val saved = app.vocabularyRepository.saveSelection(
                                    word = word,
                                    language = language,
                                    bookId = bookId,
                                    bookTitle = bookTitle,
                                    cfi = cfi,
                                    contextSentence = contextSentence,
                                )
                                delay(1_000)
                                val latest = app.vocabularyRepository.all().firstOrNull {
                                    it.language == saved.language && it.word == saved.word
                                } ?: saved
                                app.nostrRepository.publishVocabularyWord(latest)
                            }
                        },
                        onDictionaryResult = { word, language, partOfSpeech, definitions, sourceUrl ->
                            lifecycleScope.launch {
                                app.vocabularyRepository.saveDefinition(
                                    word = word,
                                    language = language,
                                    partOfSpeech = partOfSpeech,
                                    definitions = definitions,
                                    sourceUrl = sourceUrl,
                                )
                            }
                        },
                        onDictionaryLookup = { word, language ->
                            lifecycleScope.launch {
                                val payload = runCatching {
                                    val cached = app.vocabularyRepository.all().firstOrNull {
                                        it.word == word && it.language == language && it.definitions.isNotEmpty()
                                    }
                                    val result = cached?.let {
                                        DictionaryDefinition(
                                            word = it.word,
                                            language = it.language,
                                            partOfSpeech = it.partOfSpeech,
                                            definitions = it.definitions,
                                            sourceUrl = it.sourceUrl,
                                        )
                                    } ?: app.dictionaryRepository.lookupPreferred(word, language)
                                    JSONObject()
                                        .put("word", result.word)
                                        .put("language", result.language)
                                        .put("partOfSpeech", result.partOfSpeech)
                                        .put("definitions", JSONArray(result.definitions))
                                        .put("sourceUrl", result.sourceUrl)
                                }.getOrElse { error ->
                                    JSONObject()
                                        .put("word", word)
                                        .put("error", error.message ?: "Definition unavailable")
                                }
                                webView?.evaluateJavascript(
                                    "window.receiveDictionaryResult(${JSONObject.quote(payload.toString())});",
                                    null,
                                )
                            }
                        },
                        onKnownWordTapped = { word ->
                            closingReader = true
                            startActivity(
                                Intent(this@ReaderActivity, MainActivity::class.java)
                                    .putExtra(MainActivity.EXTRA_OPEN_WORD, word)
                                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                            )
                            finish()
                        },
                        onReaderInteracted = {
                            if (referenceJump && !referenceDecisionMade) {
                                showProgressPrompt = true
                            } else if (!referenceJump) {
                                readerInteracted = true
                            }
                        },
                        onSpeechText = { text, language -> speakText(text, language) },
                        onProgress = { progression, cfi, sectionIndex, sectionCount ->
                            readerProgress = progression.coerceIn(0.0, 1.0).toFloat()
                            readerSectionIndex = sectionIndex.coerceAtLeast(0)
                            readerSectionCount = sectionCount.coerceAtLeast(1)
                            if (referenceJump && !readerInteracted) return@ReaderWebView
                            readerFurthestProgress = maxOf(readerFurthestProgress, readerProgress)
                            lastCfi = cfi
                            app.settingsRepository.saveReaderSession(
                                ReaderSession(
                                    bookId,
                                    bookTitle,
                                    BookFormat.Epub,
                                    author = bookAuthor,
                                    year = bookYear,
                                    locator = cfi,
                                ),
                            )
                            lifecycleScope.launch {
                                val saved = app.catalogRepository.saveProgress(bookId, progression, cfi)
                                readerFurthestProgress = saved.furthestProgression.toFloat()
                                app.nostrRepository.publishProgress(
                                    bookId = bookId,
                                    progression = progression,
                                    cfi = cfi,
                                    furthestProgression = saved.furthestProgression,
                                    title = bookTitle,
                                )
                            }
                        },
                    )

                    readerError?.let { message ->
                        Text(
                            text = message,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.error,
                            modifier = Modifier
                                .align(Alignment.Center)
                                .background(androidx.compose.material3.MaterialTheme.colorScheme.surface)
                                .padding(24.dp),
                        )
                    }

                    if (readerLoading && readerError == null) {
                        CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    }

                    ReaderChrome(
                        title = bookTitle,
                        author = bookAuthor,
                        year = bookYear,
                        isSpeaking = isSpeaking,
                        onBack = { closeReader() },
                        onSpeechClick = { toggleTextToSpeech() },
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                    speechMessage?.let { message ->
                        Text(
                            text = message,
                            fontSize = 12.sp,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .padding(top = 30.dp)
                                .background(
                                    androidx.compose.material3.MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                                )
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                    SegmentedReadingProgress(
                        progress = readerProgress,
                        furthestProgress = readerFurthestProgress,
                        sectionCount = readerSectionCount,
                        onClick = { showSections = true },
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .height(5.dp)
                            .zIndex(2f),
                    )
                    if (showSections) {
                        AlertDialog(
                            onDismissRequest = { showSections = false },
                            title = { Text("Sections") },
                            text = {
                                if (readerSections.isEmpty()) {
                                    Text("This EPUB does not provide a table of contents.")
                                } else {
                                    LazyColumn(modifier = Modifier.heightIn(max = 520.dp)) {
                                        items(readerSections, key = { it.index }) { section ->
                                            Text(
                                                text = section.label,
                                                color = if (section.index == readerSectionIndex)
                                                    androidx.compose.material3.MaterialTheme.colorScheme.primary
                                                else androidx.compose.material3.MaterialTheme.colorScheme.onSurface,
                                                fontWeight = if (section.index == readerSectionIndex)
                                                    androidx.compose.ui.text.font.FontWeight.Bold
                                                else androidx.compose.ui.text.font.FontWeight.Normal,
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .clickable {
                                                        showSections = false
                                                        webView?.evaluateJavascript(
                                                            "displaySection(${JSONObject.quote(section.href)});",
                                                            null,
                                                        )
                                                    }
                                                    .padding(vertical = 12.dp),
                                            )
                                        }
                                    }
                                }
                            },
                            confirmButton = {
                                TextButton(onClick = { showSections = false }) { Text("Close") }
                            },
                        )
                    }
                    if (showProgressPrompt) {
                        AlertDialog(
                            onDismissRequest = {
                                referenceDecisionMade = true
                                showProgressPrompt = false
                            },
                            title = { Text("Update reading position?") },
                            text = {
                                Text(
                                    "You opened this location from a saved word. " +
                                        "Use this as your current reading position?",
                                )
                            },
                            dismissButton = {
                                TextButton(
                                    onClick = {
                                        referenceDecisionMade = true
                                        showProgressPrompt = false
                                    },
                                ) { Text("Keep my position") }
                            },
                            confirmButton = {
                                TextButton(
                                    onClick = {
                                        referenceDecisionMade = true
                                        readerInteracted = true
                                        showProgressPrompt = false
                                        webView?.evaluateJavascript(
                                            "reportLocation(rendition.currentLocation());",
                                            null,
                                        )
                                    },
                                ) { Text("Continue here") }
                            },
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if (::amberSession.isInitialized) {
            amberSession.attach()
        }
        val app = application as BookstrApp
        applyLockScreenPolicy(app.settingsRepository.keepReadingOnLockScreen)
    }

    override fun onPause() {
        if (!closingReader && (!referenceJump || readerInteracted)) {
            (application as BookstrApp).settingsRepository.saveReaderSession(
                ReaderSession(
                    bookId,
                    bookTitle,
                    BookFormat.Epub,
                    author = bookAuthor,
                    year = bookYear,
                    locator = lastCfi,
                ),
            )
        }
        if (::amberSession.isInitialized) {
            amberSession.detach()
        }
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Deprecated("Uses the activity back dispatcher on newer Android versions")
    override fun onBackPressed() {
        closeReader()
    }

    private fun closeReader() {
        NarrationService.stop(this)
        closingReader = true
        finish()
    }

    private fun handleNarrationEvent(intent: Intent) {
        isSpeaking = intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false)
        speechMessage = intent.getStringExtra(NarrationService.EXTRA_MESSAGE)

        if (intent.getBooleanExtra(NarrationService.EXTRA_CLEAR_PROGRESS, false)) {
            clearSpeechProgress()
        }

        val pageDirection = intent.getIntExtra(NarrationService.EXTRA_PAGE_DIRECTION, 0)
        if (pageDirection != 0) {
            val move = if (pageDirection > 0) "nextPage();" else "prevPage();"
            webView?.evaluateJavascript(
                "$move setTimeout(function(){ requestSpeechText(); }, 340);",
                null,
            )
            return
        }

        if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)) {
            speechMessage = "Preparing text…"
            webView?.evaluateJavascript("requestSpeechText();", null)
        }

        val offset = intent.getIntExtra(NarrationService.EXTRA_OFFSET, -1)
        val length = intent.getIntExtra(NarrationService.EXTRA_LENGTH, 0)
        if (offset >= 0 && length > 0) {
            webView?.evaluateJavascript(
                "showSpeechProgress($offset, ${offset + length});",
            ) { encodedParagraph ->
                val paragraph = runCatching {
                    JSONArray("[$encodedParagraph]").optString(0)
                }.getOrDefault("")
                if (paragraph.isNotBlank()) {
                    NarrationService.updateParagraph(this, paragraph)
                }
            }
        }
    }

    private fun toggleTextToSpeech() {
        NarrationService.toggle(
            context = this,
            bookId = bookId,
            title = bookTitle,
            author = bookAuthor,
            coverUrl = bookCoverUrl,
        )
    }

    private fun speakText(text: String, languageTag: String) {
        val cleanText = text.lines()
            .map { line -> line.replace(Regex("\\s+"), " ").trim() }
            .filter(String::isNotBlank)
            .joinToString("\n")
        if (cleanText.isBlank()) {
            isSpeaking = false
            speechMessage = "No readable text is visible here."
            return
        }
        speechMessage = null
        NarrationService.speak(
            context = this,
            text = cleanText,
            language = languageTag,
            bookId = bookId,
            title = bookTitle,
            author = bookAuthor,
            coverUrl = bookCoverUrl,
        )
    }

    private fun clearSpeechProgress() {
        webView?.evaluateJavascript("clearSpeechProgress();", null)
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(narrationReceiver) }
        super.onDestroy()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (isSpeaking && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            return super.onKeyDown(keyCode, event)
        }
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
        if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
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
        private const val EXTRA_BOOK_AUTHOR = "book_author"
        private const val EXTRA_BOOK_YEAR = "book_year"
        private const val EXTRA_BOOK_COVER_URL = "book_cover_url"
        private const val EXTRA_INITIAL_CFI = "initial_cfi"
        private const val EXTRA_HIGHLIGHT_CFI = "highlight_cfi"
        private const val EXTRA_THEME = "theme"

        internal fun speechChunks(text: String): List<String> {
            val engineLimit = (TextToSpeech.getMaxSpeechInputLength() - 256).coerceAtLeast(1_000)
            val maxLength = minOf(engineLimit, 160)
            val chunks = mutableListOf<String>()
            text.split(Regex("\\n+")).map(String::trim).filter(String::isNotBlank).forEach { paragraph ->
                var remaining = paragraph
                while (remaining.length > maxLength) {
                    val window = remaining.take(maxLength)
                    val sentenceBreak = maxOf(
                        window.lastIndexOf(". "),
                        window.lastIndexOf("! "),
                        window.lastIndexOf("? "),
                    )
                    val splitAt = sentenceBreak.takeIf { it >= maxLength / 3 }
                        ?: window.lastIndexOf("; ").takeIf { it >= maxLength / 2 }
                        ?: window.lastIndexOf(" ").takeIf { it >= maxLength / 2 }
                        ?: maxLength
                    val consumed = splitAt + if (splitAt < maxLength) 1 else 0
                    chunks += remaining.take(consumed).trim()
                    remaining = remaining.drop(consumed).trimStart()
                }
                if (remaining.isNotBlank()) chunks += remaining
            }
            return chunks
        }

        internal fun preferredSpeechLocale(languageTag: String): Locale {
            val normalized = languageTag.trim().lowercase(Locale.ROOT)
            return if (normalized == "pt") {
                Locale.forLanguageTag("pt-PT")
            } else {
                Locale.forLanguageTag(normalized.ifBlank { "en" })
            }
        }

        fun intent(
            context: Context,
            bookId: String,
            bookTitle: String,
            author: String?,
            year: String?,
            initialCfi: String?,
            theme: ReaderTheme,
            highlightCfi: String? = null,
            coverUrl: String? = null,
        ): Intent =
            Intent(context, ReaderActivity::class.java).apply {
                putExtra(EXTRA_BOOK_ID, bookId)
                putExtra(EXTRA_BOOK_TITLE, bookTitle)
                putExtra(EXTRA_BOOK_AUTHOR, author)
                putExtra(EXTRA_BOOK_YEAR, year)
                putExtra(EXTRA_BOOK_COVER_URL, coverUrl)
                putExtra(EXTRA_INITIAL_CFI, initialCfi)
                putExtra(EXTRA_HIGHLIGHT_CFI, highlightCfi)
                putExtra(EXTRA_THEME, theme.key)
            }
    }
}

@Composable
private fun ReaderChrome(
    title: String,
    author: String?,
    year: String?,
    isSpeaking: Boolean,
    onBack: () -> Unit,
    onSpeechClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var clock by remember { mutableStateOf(LocalTime.now().format(TIME_FORMAT)) }
    LaunchedEffect(Unit) {
        while (true) {
            clock = LocalTime.now().format(TIME_FORMAT)
            delay(30_000)
        }
    }
    val detail = listOfNotNull(author?.takeIf(String::isNotBlank), year?.takeIf(String::isNotBlank))
        .joinToString(" · ")
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(24.dp)
            .background(androidx.compose.material3.MaterialTheme.colorScheme.primary.copy(alpha = 0.98f)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = androidx.compose.material3.MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            if (detail.isBlank()) title else "$title — $detail",
            fontSize = 11.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onPrimary,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        Box(
            modifier = Modifier
                .size(24.dp)
                .clickable(onClick = onSpeechClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (isSpeaking) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (isSpeaking) "Pause reading aloud" else "Read aloud",
                tint = androidx.compose.material3.MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            "$clock  EPUB",
            fontSize = 9.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.78f),
            modifier = Modifier.padding(horizontal = 8.dp),
        )
    }
}

private val TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

private data class ReaderSection(val index: Int, val label: String, val href: String)

@Composable
private fun SegmentedReadingProgress(
    progress: Float,
    furthestProgress: Float,
    sectionCount: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val track = androidx.compose.material3.MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
    val filled = androidx.compose.material3.MaterialTheme.colorScheme.primary
    val furthest = filled.copy(alpha = 0.58f)
    val divider = androidx.compose.material3.MaterialTheme.colorScheme.surface.copy(alpha = 0.9f)
    Canvas(modifier = modifier.clickable(onClick = onClick)) {
        drawRect(track)
        drawRect(furthest, size = size.copy(width = size.width * furthestProgress.coerceIn(0f, 1f)))
        drawRect(filled, size = size.copy(width = size.width * progress.coerceIn(0f, 1f)))
        if (sectionCount > 1) {
            for (section in 1 until sectionCount) {
                val x = size.width * section / sectionCount
                drawLine(
                    color = divider,
                    start = androidx.compose.ui.geometry.Offset(x, 0f),
                    end = androidx.compose.ui.geometry.Offset(x, size.height),
                    strokeWidth = 1f,
                )
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun ReaderWebView(
    onWebViewReady: (WebView) -> Unit,
    bookId: String,
    initialCfi: String?,
    highlightCfi: String?,
    knownWords: List<String>,
    theme: ReaderTheme,
    onReaderReady: () -> Unit,
    onMetadata: (String?, String?, String?) -> Unit,
    onSections: (List<ReaderSection>) -> Unit,
    onReaderError: (String) -> Unit,
    onWordSelected: (String, String, String, String) -> Unit,
    onDictionaryResult: (String, String, String, List<String>, String) -> Unit,
    onDictionaryLookup: (String, String) -> Unit,
    onKnownWordTapped: (String) -> Unit,
    onReaderInteracted: () -> Unit,
    onSpeechText: (String, String) -> Unit,
    onProgress: (Double, String, Int, Int) -> Unit,
) {
    val context = LocalContext.current
    val app = context.applicationContext as BookstrApp
    val latestKnownWords by rememberUpdatedState(knownWords)

    AndroidView(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 24.dp, bottom = 5.dp),
        factory = { ctx ->
            val epubFile = app.catalogRepository.epubFile(bookId)
            val publicationName = "$bookId.epub"
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
                .addPathHandler(
                    "/books/",
                    WebViewAssetLoader.PathHandler { path ->
                        if (path != publicationName || !epubFile.isFile) null
                        else WebResourceResponse(
                            "application/epub+zip",
                            null,
                            200,
                            "OK",
                            mapOf(
                                "Content-Length" to epubFile.length().toString(),
                                "Cache-Control" to "no-store",
                            ),
                            epubFile.inputStream(),
                        )
                    },
                )
                .build()

            object : WebView(ctx) {
                override fun startActionMode(callback: ActionMode.Callback): ActionMode? = null

                override fun startActionMode(callback: ActionMode.Callback, type: Int): ActionMode? = null
            }.apply {
                setBackgroundColor(
                    if (theme == ReaderTheme.Night) android.graphics.Color.rgb(18, 18, 18)
                    else android.graphics.Color.rgb(244, 240, 230),
                )
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.allowFileAccess = true
                settings.domStorageEnabled = true

                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                        Log.d(
                            "BookstrReader",
                            "${consoleMessage.messageLevel()}: ${consoleMessage.message()} " +
                                "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})",
                        )
                        return true
                    }
                }

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: android.webkit.WebResourceRequest,
                    ) = assetLoader.shouldInterceptRequest(request.url)

                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError,
                    ) {
                        super.onReceivedError(view, request, error)
                        if (request.url.path?.startsWith("/books/") == true) {
                            onReaderError("EPUB request failed: ${error.description}")
                        }
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        super.onPageFinished(view, url)
                        if (!url.endsWith("/assets/reader.html")) return
                        val cfiJs = initialCfi?.let(JSONObject::quote) ?: "null"
                        val highlightCfiJs = highlightCfi?.let(JSONObject::quote) ?: "null"
                        val themeJs = JSONObject.quote(theme.key)
                        val bookIdJs = JSONObject.quote(bookId)
                        val knownWordsJs = JSONObject.quote(JSONArray(latestKnownWords).toString())
                        val bookUrlJs = JSONObject.quote(
                            "https://appassets.androidplatform.net/books/$publicationName",
                        )
                        view.evaluateJavascript(
                            "setReaderTheme($themeJs); " +
                                "setKnownWords($knownWordsJs); " +
                                "loadBookUrl($bookUrlJs, $cfiJs, $themeJs, $highlightCfiJs, $bookIdJs);",
                            null,
                        )
                    }
                }

                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun onReaderReady() {
                            (ctx as? ComponentActivity)?.runOnUiThread { onReaderReady() }
                        }

                        @JavascriptInterface
                        fun onMetadata(json: String) {
                            try {
                                val obj = JSONObject(json)
                                val title = obj.optString("title").takeIf(String::isNotBlank)
                                val author = obj.optString("author").takeIf(String::isNotBlank)
                                val year = obj.optString("year").takeIf(String::isNotBlank)
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onMetadata(title, author, year)
                                }
                            } catch (_: Exception) {
                            }
                        }

                        @JavascriptInterface
                        fun onSections(json: String) {
                            try {
                                val array = JSONArray(json)
                                val sections = buildList {
                                    for (index in 0 until array.length()) {
                                        val obj = array.optJSONObject(index) ?: continue
                                        add(
                                            ReaderSection(
                                                index = obj.optInt("index", index),
                                                label = obj.optString("label", "Section ${index + 1}"),
                                                href = obj.optString("href"),
                                            ),
                                        )
                                    }
                                }.filter { it.href.isNotBlank() }
                                (ctx as? ComponentActivity)?.runOnUiThread { onSections(sections) }
                            } catch (_: Exception) {
                            }
                        }

                        @JavascriptInterface
                        fun onRelocated(json: String) {
                            try {
                                val obj = JSONObject(json)
                                val progression = obj.optDouble("progression", 0.0)
                                val cfi = obj.optString("cfi", "")
                                val sectionIndex = obj.optInt("sectionIndex", 0)
                                val sectionCount = obj.optInt("sectionCount", 1)
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onProgress(progression, cfi, sectionIndex, sectionCount)
                                }
                            } catch (_: Exception) {
                            }
                        }

                        @JavascriptInterface
                        fun onReaderError(message: String) {
                            (ctx as? ComponentActivity)?.runOnUiThread {
                                onReaderError("Could not open this book: $message")
                            }
                        }

                        @JavascriptInterface
                        fun onWordSelected(json: String) {
                            runCatching {
                                val obj = JSONObject(json)
                                val word = obj.optString("word")
                                if (word.isBlank()) return@runCatching
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onWordSelected(
                                        word,
                                        obj.optString("language", "en"),
                                        obj.optString("cfi"),
                                        obj.optString("contextSentence"),
                                    )
                                }
                            }
                        }

                        @JavascriptInterface
                        fun onDictionaryResult(json: String) {
                            runCatching {
                                val obj = JSONObject(json)
                                val word = obj.optString("word")
                                if (word.isBlank()) return@runCatching
                                val array = obj.optJSONArray("definitions") ?: JSONArray()
                                val definitions = List(array.length()) { index -> array.optString(index) }
                                    .filter(String::isNotBlank)
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onDictionaryResult(
                                        word,
                                        obj.optString("language", "en"),
                                        obj.optString("partOfSpeech"),
                                        definitions,
                                        obj.optString("sourceUrl"),
                                    )
                                }
                            }
                        }

                        @JavascriptInterface
                        fun onLookupDictionary(json: String) {
                            runCatching {
                                val obj = JSONObject(json)
                                val word = obj.optString("word")
                                if (word.isBlank()) return@runCatching
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onDictionaryLookup(word, obj.optString("language", "en"))
                                }
                            }
                        }

                        @JavascriptInterface
                        fun onKnownWordTapped(word: String) {
                            if (word.isBlank()) return
                            (ctx as? ComponentActivity)?.runOnUiThread { onKnownWordTapped(word) }
                        }

                        @JavascriptInterface
                        fun onReaderInteracted() {
                            (ctx as? ComponentActivity)?.runOnUiThread { onReaderInteracted() }
                        }

                        @JavascriptInterface
                        fun onSpeechText(json: String) {
                            runCatching {
                                val obj = JSONObject(json)
                                (ctx as? ComponentActivity)?.runOnUiThread {
                                    onSpeechText(
                                        obj.optString("text"),
                                        obj.optString("language", "en"),
                                    )
                                }
                            }
                        }
                    },
                    "AndroidBridge",
                )

                onWebViewReady(this)

                loadUrl("https://appassets.androidplatform.net/assets/reader.html")
            }
        },
        update = { view ->
            val wordsJs = JSONObject.quote(JSONArray(knownWords).toString())
            view.evaluateJavascript(
                "if (window.setKnownWords) window.setKnownWords($wordsJs);",
                null,
            )
        },
    )
}
