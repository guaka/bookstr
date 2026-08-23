package app.bookstr

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Point
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.Build
import android.os.ParcelFileDescriptor
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import app.bookstr.data.ReaderTheme
import app.bookstr.ui.theme.BookstrThemeFromSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import kotlin.math.abs
import kotlin.math.hypot
import java.time.LocalTime
import java.time.format.DateTimeFormatter

private data class PdfDictionaryUi(
    val word: String,
    val loading: Boolean,
    val partOfSpeech: String = "",
    val definitions: List<String> = emptyList(),
    val error: String? = null,
)

private data class PdfHighlightData(
    val bounds: List<android.graphics.RectF> = emptyList(),
    val pageWidth: Float = 1f,
    val pageHeight: Float = 1f,
)

class PdfReaderActivity : ComponentActivity() {
    private var descriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private var bookId: String = ""
    private var bookTitle: String = "PDF"
    private var bookAuthor: String? = null
    private var bookYear: String? = null
    private var currentPage = 0
    private var currentPageOffset = 0
    private var highlightWord: String? = null
    private var closingReader = false
    private var dictionary by mutableStateOf<PdfDictionaryUi?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemUi()
        bookId = intent.getStringExtra(EXTRA_BOOK_ID) ?: return finish()
        bookTitle = intent.getStringExtra(EXTRA_BOOK_TITLE) ?: "PDF"
        bookAuthor = intent.getStringExtra(EXTRA_BOOK_AUTHOR)
        bookYear = intent.getStringExtra(EXTRA_BOOK_YEAR)
        currentPage = intent.getIntExtra(EXTRA_PAGE_INDEX, 0).coerceAtLeast(0)
        currentPageOffset = intent.getIntExtra(EXTRA_PAGE_OFFSET, 0).coerceAtLeast(0)
        highlightWord = intent.getStringExtra(EXTRA_HIGHLIGHT_WORD)
        val app = application as BookstrApp
        applyLockScreenPolicy(app.settingsRepository.keepReadingOnLockScreen)
        app.settingsRepository.saveReaderSession(
            ReaderSession(
                bookId = bookId,
                bookTitle = bookTitle,
                format = BookFormat.Pdf,
                author = bookAuthor,
                year = bookYear,
                pageIndex = currentPage,
                pageOffset = currentPageOffset,
            ),
        )
        val file = app.catalogRepository.publicationFile(bookId, BookFormat.Pdf)
        if (!file.isFile) {
            app.settingsRepository.clearReaderSession()
            return finish()
        }

        val openedRenderer = runCatching {
            descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            PdfRenderer(descriptor!!)
        }.getOrElse { error ->
            app.settingsRepository.clearReaderSession()
            descriptor?.close()
            descriptor = null
            setContent {
                BookstrThemeFromSettings(readerTheme = app.settingsRepository.theme) {
                    PdfOpenError(
                        title = bookTitle,
                        message = error.message ?: "This PDF cannot be opened. It may be encrypted or damaged.",
                        onBack = { closeReader() },
                    )
                }
            }
            return
        }
        renderer = openedRenderer
        val pageRatios = pageRatios(openedRenderer)
        val readerTheme = app.settingsRepository.theme

        setContent {
            BookstrThemeFromSettings(readerTheme = readerTheme) {
                PdfDocument(
                    title = bookTitle,
                    author = bookAuthor,
                    year = bookYear,
                    renderer = openedRenderer,
                    pageRatios = pageRatios,
                    initialPage = currentPage.coerceAtMost((pageRatios.size - 1).coerceAtLeast(0)),
                    initialPageOffset = currentPageOffset,
                    initialZoom = app.settingsRepository.pdfZoom(bookId),
                    highlightWord = highlightWord,
                    nightMode = readerTheme == ReaderTheme.Night,
                    dictionary = dictionary,
                    onDismissDictionary = { dictionary = null },
                    onWordSelected = { word, context, page ->
                        saveAndLookupPdfWord(app, word, context, page)
                    },
                    onZoomChanged = { app.settingsRepository.savePdfZoom(bookId, it) },
                    onPositionChanged = { page, offset ->
                        currentPage = page
                        currentPageOffset = offset
                        val progression = if (pageRatios.isEmpty()) 0.0 else {
                            ((page + (offset / 2400.0).coerceIn(0.0, 0.99)) / pageRatios.size)
                                .coerceIn(0.0, 1.0)
                        }
                        lifecycleScope.launch {
                            val saved = app.catalogRepository.saveProgress(
                                bookId,
                                progression,
                                "pdf:$page:$offset",
                            )
                            app.nostrRepository.publishProgress(
                                bookId = bookId,
                                progression = progression,
                                cfi = "pdf:$page:$offset",
                                furthestProgression = saved.furthestProgression,
                                title = bookTitle,
                            )
                        }
                    },
                    onBack = { closeReader() },
                )
            }
        }
    }

    override fun onDestroy() {
        renderer?.close()
        descriptor?.close()
        renderer = null
        descriptor = null
        super.onDestroy()
    }

    override fun onPause() {
        if (!closingReader && bookId.isNotBlank()) {
            (application as BookstrApp).settingsRepository.saveReaderSession(
                ReaderSession(
                    bookId = bookId,
                    bookTitle = bookTitle,
                    format = BookFormat.Pdf,
                    author = bookAuthor,
                    year = bookYear,
                    pageIndex = currentPage,
                    pageOffset = currentPageOffset,
                ),
            )
        }
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        applyLockScreenPolicy((application as BookstrApp).settingsRepository.keepReadingOnLockScreen)
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
        closingReader = true
        finish()
    }

    private fun saveAndLookupPdfWord(app: BookstrApp, word: String, context: String, page: Int) {
        dictionary = PdfDictionaryUi(word = word, loading = true)
        lifecycleScope.launch {
            val language = app.dictionaryRepository.languageFor(context)
            val selected = app.vocabularyRepository.saveSelection(
                word = word,
                language = language,
                bookId = bookId,
                bookTitle = bookTitle,
                cfi = "pdf:$page:0",
                contextSentence = context,
            )
            try {
                val result = app.dictionaryRepository.lookup(word, context)
                val saved = app.vocabularyRepository.saveDefinition(
                    word = word,
                    language = language,
                    partOfSpeech = result.partOfSpeech,
                    definitions = result.definitions,
                    sourceUrl = result.sourceUrl,
                )
                if (saved != null) app.nostrRepository.publishVocabularyWord(saved)
                dictionary = PdfDictionaryUi(
                    word = word,
                    loading = false,
                    partOfSpeech = result.partOfSpeech,
                    definitions = result.definitions,
                )
            } catch (error: Exception) {
                app.nostrRepository.publishVocabularyWord(selected)
                dictionary = PdfDictionaryUi(
                    word = word,
                    loading = false,
                    error = error.message ?: "Definition unavailable",
                )
            }
        }
    }

    private fun hideSystemUi() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
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

    companion object {
        private const val EXTRA_BOOK_ID = "book_id"
        private const val EXTRA_BOOK_TITLE = "book_title"
        private const val EXTRA_BOOK_AUTHOR = "book_author"
        private const val EXTRA_BOOK_YEAR = "book_year"
        private const val EXTRA_PAGE_INDEX = "page_index"
        private const val EXTRA_PAGE_OFFSET = "page_offset"
        private const val EXTRA_HIGHLIGHT_WORD = "highlight_word"

        fun intent(
            context: Context,
            bookId: String,
            bookTitle: String,
            author: String? = null,
            year: String? = null,
            pageIndex: Int = 0,
            pageOffset: Int = 0,
            highlightWord: String? = null,
        ): Intent =
            Intent(context, PdfReaderActivity::class.java).apply {
                putExtra(EXTRA_BOOK_ID, bookId)
                putExtra(EXTRA_BOOK_TITLE, bookTitle)
                putExtra(EXTRA_BOOK_AUTHOR, author)
                putExtra(EXTRA_BOOK_YEAR, year)
                putExtra(EXTRA_PAGE_INDEX, pageIndex)
                putExtra(EXTRA_PAGE_OFFSET, pageOffset)
                putExtra(EXTRA_HIGHLIGHT_WORD, highlightWord)
            }

        private fun pageRatios(renderer: PdfRenderer): List<Float> =
            (0 until renderer.pageCount).map { index ->
                runCatching {
                    synchronized(renderer) {
                        renderer.openPage(index).use { page -> page.height.toFloat() / page.width.coerceAtLeast(1) }
                    }
                }.getOrDefault(DEFAULT_PAGE_RATIO)
            }

        private const val DEFAULT_PAGE_RATIO = 1.414f
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PdfOpenError(title: String, message: String, onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to library")
                    }
                },
                actions = {
                    Text(
                        "PDF",
                        style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(end = 14.dp),
                    )
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Could not open this PDF")
                Text(message, modifier = Modifier.padding(top = 8.dp))
                Button(onClick = onBack, modifier = Modifier.padding(top = 16.dp)) { Text("Back") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, FlowPreview::class)
@Composable
private fun PdfDocument(
    title: String,
    author: String?,
    year: String?,
    renderer: PdfRenderer,
    pageRatios: List<Float>,
    initialPage: Int,
    initialPageOffset: Int,
    initialZoom: Float,
    highlightWord: String?,
    nightMode: Boolean,
    dictionary: PdfDictionaryUi?,
    onDismissDictionary: () -> Unit,
    onWordSelected: (String, String, Int) -> Unit,
    onZoomChanged: (Float) -> Unit,
    onPositionChanged: (Int, Int) -> Unit,
    onBack: () -> Unit,
) {
    val listState = androidx.compose.foundation.lazy.rememberLazyListState(
        initialFirstVisibleItemIndex = initialPage,
        initialFirstVisibleItemScrollOffset = initialPageOffset,
    )
    val gestureScope = rememberCoroutineScope()
    var zoom by remember { mutableFloatStateOf(initialZoom.coerceIn(1f, 5f)) }
    var horizontalPan by remember { mutableFloatStateOf(0f) }
    var horizontalDrag by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(zoom) {
        delay(350L)
        onZoomChanged(zoom)
    }
    androidx.compose.runtime.LaunchedEffect(listState) {
        androidx.compose.runtime.snapshotFlow {
            listState.firstVisibleItemIndex to listState.firstVisibleItemScrollOffset
        }.distinctUntilChanged().debounce(300).collect { (page, offset) ->
            onPositionChanged(page, offset)
        }
    }
    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(
                    if (nightMode) androidx.compose.ui.graphics.Color.Black
                    else androidx.compose.ui.graphics.Color(0xFF525659),
                )
                .graphicsLayer {
                    translationX = if (zoom <= 1.01f) horizontalDrag else 0f
                }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        var transforming = false
                        do {
                            val event = awaitPointerEvent()
                            if (event.changes.count { it.pressed } >= 2) transforming = true
                            if (transforming) {
                                val oldZoom = zoom
                                val nextZoom = (oldZoom * event.calculateZoom()).coerceIn(1f, 5f)
                                if (nextZoom != oldZoom) {
                                    val centroid = event.calculateCentroid()
                                    val scaleChange = nextZoom / oldZoom
                                    val centerX = size.width / 2f
                                    val nextLimit = size.width * (nextZoom - 1f) / 2f
                                    horizontalPan = if (nextZoom <= 1.01f) 0f else {
                                        (centroid.x - centerX -
                                            (centroid.x - centerX - horizontalPan) * scaleChange)
                                            .coerceIn(-nextLimit, nextLimit)
                                    }
                                    val page = listState.firstVisibleItemIndex
                                    val offset = listState.firstVisibleItemScrollOffset
                                    val anchoredOffset = (
                                        (offset + centroid.y) * scaleChange - centroid.y
                                    ).roundToInt().coerceAtLeast(0)
                                    zoom = nextZoom
                                    listState.requestScrollToItem(page, anchoredOffset)
                                }
                                event.changes.forEach { it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                    }
                }
                .pointerInput(zoom, listState) {
                    detectHorizontalDragGestures(
                        onDragStart = { horizontalDrag = 0f },
                        onHorizontalDrag = { change, amount ->
                            change.consume()
                            horizontalDrag += amount
                            if (zoom > 1.01f) {
                                val limit = size.width * (zoom - 1f) / 2f
                                horizontalPan = (horizontalPan + amount).coerceIn(-limit, limit)
                            }
                        },
                        onDragEnd = {
                            if (zoom <= 1.01f && abs(horizontalDrag) > size.width * 0.15f) {
                                val current = listState.firstVisibleItemIndex
                                val target = if (horizontalDrag < 0) {
                                    (current + 1).coerceAtMost(pageRatios.lastIndex)
                                } else {
                                    (current - 1).coerceAtLeast(0)
                                }
                                if (target == current) {
                                    horizontalDrag = 0f
                                } else {
                                    val start = horizontalDrag
                                    val outgoing = if (target > current) -size.width.toFloat()
                                    else size.width.toFloat()
                                    gestureScope.launch {
                                        Animatable(start).animateTo(outgoing, tween(90)) {
                                            horizontalDrag = value
                                        }
                                        listState.scrollToItem(target)
                                        val incoming = -outgoing
                                        horizontalDrag = incoming
                                        Animatable(incoming).animateTo(0f, tween(105)) {
                                            horizontalDrag = value
                                        }
                                        horizontalDrag = 0f
                                    }
                                }
                            } else {
                                horizontalDrag = 0f
                            }
                        },
                        onDragCancel = { horizontalDrag = 0f },
                    )
                },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            items(pageRatios.size, key = { it }) { pageIndex ->
                PdfPage(
                    renderer,
                    pageIndex,
                    pageRatios[pageIndex],
                    nightMode,
                    zoom,
                    horizontalPan,
                    onWordSelected,
                    highlightWord.takeIf { pageIndex == initialPage },
                )
            }
        }
        PdfReaderChrome(
            title = title,
            author = author,
            year = year,
            onBack = onBack,
            modifier = Modifier.align(Alignment.TopCenter),
        )
        dictionary?.let { state ->
            Card(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface,
                ),
            ) {
                androidx.compose.foundation.layout.Column(modifier = Modifier.padding(16.dp)) {
                    Text(state.word, style = androidx.compose.material3.MaterialTheme.typography.titleLarge)
                    if (state.partOfSpeech.isNotBlank()) Text(
                        state.partOfSpeech,
                        color = androidx.compose.material3.MaterialTheme.colorScheme.secondary,
                    )
                    when {
                        state.loading -> Text("Looking up…", modifier = Modifier.padding(top = 8.dp))
                        state.definitions.isNotEmpty() -> state.definitions.take(4).forEach {
                            Text("• $it", modifier = Modifier.padding(top = 6.dp))
                        }
                        else -> Text(
                            state.error ?: "No definition found",
                            modifier = Modifier.padding(top = 8.dp),
                            color = androidx.compose.material3.MaterialTheme.colorScheme.secondary,
                        )
                    }
                    Button(onClick = onDismissDictionary, modifier = Modifier.padding(top = 10.dp)) {
                        Text("Close")
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfReaderChrome(
    title: String,
    author: String?,
    year: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var clock by remember { mutableStateOf(LocalTime.now().format(PDF_TIME_FORMAT)) }
    LaunchedEffect(Unit) {
        while (true) {
            clock = LocalTime.now().format(PDF_TIME_FORMAT)
            delay(30_000)
        }
    }
    val detail = listOfNotNull(author?.takeIf(String::isNotBlank), year?.takeIf(String::isNotBlank))
        .joinToString(" · ")
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(24.dp)
            .background(androidx.compose.material3.MaterialTheme.colorScheme.surface.copy(alpha = 0.98f)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(24.dp).clickable(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = androidx.compose.material3.MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
        }
        Text(
            if (detail.isBlank()) title else "$title — $detail",
            fontSize = 11.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        Text(
            "$clock  PDF",
            fontSize = 9.sp,
            color = androidx.compose.material3.MaterialTheme.colorScheme.secondary,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
    }
}

private val PDF_TIME_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

@Composable
private fun PdfPage(
    renderer: PdfRenderer,
    pageIndex: Int,
    ratio: Float,
    nightMode: Boolean,
    zoom: Float,
    horizontalPan: Float,
    onWordSelected: (String, String, Int) -> Unit,
    highlightWord: String?,
) {
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val widthPx = with(density) { configuration.screenWidthDp.dp.roundToPx() }.coerceIn(1, 1600)
    val height = configuration.screenWidthDp.dp * ratio
    val nightColorFilter = remember(nightMode) {
        if (!nightMode) null
        else ColorFilter.colorMatrix(
            ColorMatrix(
                floatArrayOf(
                    -0.2126f, -0.7152f, -0.0722f, 0f, 255f,
                    -0.2126f, -0.7152f, -0.0722f, 0f, 255f,
                    -0.2126f, -0.7152f, -0.0722f, 0f, 255f,
                    0f, 0f, 0f, 1f, 0f,
                ),
            ),
        )
    }
    val renderResult by produceState<Result<Bitmap>?>(null, renderer, pageIndex, widthPx) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                synchronized(renderer) {
                    renderer.openPage(pageIndex).use { page ->
                        val heightPx = (widthPx * page.height.toFloat() / page.width.coerceAtLeast(1))
                            .roundToInt()
                            .coerceAtLeast(1)
                        Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888).also { rendered ->
                            rendered.eraseColor(Color.WHITE)
                            page.render(rendered, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        }
                    }
                }
            }
        }
    }
    val highlights by produceState(PdfHighlightData(), renderer, pageIndex, highlightWord) {
        value = if (Build.VERSION.SDK_INT < 35 || highlightWord.isNullOrBlank()) PdfHighlightData()
        else withContext(Dispatchers.IO) {
            runCatching {
                synchronized(renderer) {
                    renderer.openPage(pageIndex).use { page ->
                        PdfHighlightData(
                            bounds = page.searchText(highlightWord).flatMap { it.bounds },
                            pageWidth = page.width.toFloat(),
                            pageHeight = page.height.toFloat(),
                        )
                    }
                }
            }.getOrDefault(PdfHighlightData())
        }
    }

    val bitmap = renderResult?.getOrNull()
    DisposableEffect(bitmap) {
        onDispose { bitmap?.recycle() }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(height * zoom)
            .padding(bottom = 6.dp)
            .background(androidx.compose.ui.graphics.Color.White)
            .clipToBounds(),
        contentAlignment = Alignment.Center,
    ) {
        val rendered = bitmap
        if (renderResult == null) {
            CircularProgressIndicator()
        } else if (rendered == null) {
            Text("Could not render page ${pageIndex + 1}")
        } else {
            Image(
                bitmap = rendered.asImageBitmap(),
                contentDescription = "Page ${pageIndex + 1}",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(height)
                    .graphicsLayer {
                        scaleX = zoom
                        scaleY = zoom
                        translationX = horizontalPan
                    },
                contentScale = ContentScale.FillWidth,
                colorFilter = nightColorFilter,
            )
            if (highlights.bounds.isNotEmpty()) {
                Canvas(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(height)
                        .graphicsLayer {
                            scaleX = zoom
                            scaleY = zoom
                            translationX = horizontalPan
                        },
                ) {
                    highlights.bounds.forEach { bounds ->
                        drawRect(
                            color = androidx.compose.ui.graphics.Color(0x99FFD54F),
                            topLeft = androidx.compose.ui.geometry.Offset(
                                bounds.left / highlights.pageWidth * size.width,
                                bounds.top / highlights.pageHeight * size.height,
                            ),
                            size = androidx.compose.ui.geometry.Size(
                                bounds.width() / highlights.pageWidth * size.width,
                                bounds.height() / highlights.pageHeight * size.height,
                            ),
                        )
                    }
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 35 && rendered != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(pageIndex, zoom, horizontalPan) {
                    detectTapGestures(
                        onLongPress = { position ->
                        val imageHeight = size.width * ratio
                        val normalizedX = (
                            (position.x - size.width / 2f - horizontalPan) / zoom + size.width / 2f
                            ) / size.width
                        val normalizedY = position.y / (imageHeight * zoom)
                        val selected = runCatching {
                            extractPdfWord(
                                renderer,
                                pageIndex,
                                normalizedX.coerceIn(0f, 1f),
                                normalizedY.coerceIn(0f, 1f),
                            )
                        }.getOrNull()
                        if (selected != null) onWordSelected(selected.first, selected.second, pageIndex)
                        },
                    )
                },
            )
        }
    }
}

@androidx.annotation.RequiresApi(35)
private fun extractPdfWord(
    renderer: PdfRenderer,
    pageIndex: Int,
    normalizedX: Float,
    normalizedY: Float,
): Pair<String, String>? = synchronized(renderer) {
    renderer.openPage(pageIndex).use { page ->
        val x = normalizedX * page.width
        val y = normalizedY * page.height
        val contents = page.textContents
        val content = contents.minByOrNull { item ->
            item.bounds.minOfOrNull { bounds ->
                if (bounds.contains(x, y)) 0.0
                else hypot(
                    (x - x.coerceIn(bounds.left, bounds.right)).toDouble(),
                    (y - y.coerceIn(bounds.top, bounds.bottom)).toDouble(),
                )
            } ?: Double.MAX_VALUE
        } ?: return@use null
        val text = content.text.replace(Regex("\\s+"), " ").trim()
        if (text.isBlank()) return@use null
        val nearestBounds = content.bounds.minByOrNull { bounds ->
            hypot(
                (x - x.coerceIn(bounds.left, bounds.right)).toDouble(),
                (y - y.coerceIn(bounds.top, bounds.bottom)).toDouble(),
            )
        }
        val fraction = nearestBounds?.let { ((x - it.left) / it.width().coerceAtLeast(1f)).coerceIn(0f, 1f) } ?: 0.5f
        val character = (fraction * text.length).toInt().coerceIn(0, text.lastIndex)
        val matches = Regex("[\\p{L}]+(?:['’-][\\p{L}]+)*").findAll(text).toList()
        val match = matches.firstOrNull { character in it.range }
            ?: matches.minByOrNull { minOf(abs(character - it.range.first), abs(character - it.range.last)) }
            ?: return@use null
        match.value.lowercase() to text.take(500)
    }
}
