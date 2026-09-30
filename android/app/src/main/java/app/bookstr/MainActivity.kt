package app.bookstr

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.testTag
import app.bookstr.data.CatalogConnection
import app.bookstr.data.CatalogSearchPage
import app.bookstr.download.DownloadService
import app.bookstr.ui.DownloadsSheet
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.bookstr.data.CatalogBook
import app.bookstr.data.BookSearchResult
import app.bookstr.data.SharedFavoriteRef
import app.bookstr.data.CatalogRepository
import app.bookstr.data.BookFormat
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.RIGHTS_UNKNOWN
import app.bookstr.nostr.AmberIntentSession
import app.bookstr.nostr.ExternalSigner
import app.bookstr.nostr.Nip55
import app.bookstr.nostr.NostrCrypto
import app.bookstr.ui.BookstrNavigationBar
import app.bookstr.ui.LibraryScreen
import app.bookstr.ui.SearchScreen
import app.bookstr.ui.SettingsScreen
import app.bookstr.ui.WordsScreen
import app.bookstr.ui.theme.BookstrThemeFromSettings
import app.bookstr.util.Bech32
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private var pendingInvitation by mutableStateOf<String?>(null)
    private var showDownloads by mutableStateOf(false)
    private lateinit var amberSession: AmberIntentSession
    private var requestedWord by mutableStateOf<String?>(null)
    private var wordRequestKey by mutableStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemUi()

        amberSession = AmberIntentSession(this)
        pendingInvitation = intent.dataString?.takeIf { it.startsWith("bookstr:") }
        showDownloads = intent.getBooleanExtra("open_downloads", false)
        requestedWord = intent.getStringExtra(EXTRA_OPEN_WORD)

        if (intent.getBooleanExtra(EXTRA_PIN_SHORTCUT, false)) {
            window.decorView.post { requestHomeShortcut() }
        }

        val app = application as BookstrApp
        val settings = app.settingsRepository
        val catalog = app.catalogRepository
        val nostr = app.nostrRepository
        val favoritesRepository = app.nostrFavoritesRepository
        val vocabularyRepository = app.vocabularyRepository
        val dictionaryRepository = app.dictionaryRepository

        if (savedInstanceState == null && pendingInvitation == null && !showDownloads) {
            settings.readerSession()?.let { session ->
                val publication = catalog.publicationFile(session.bookId, session.format)
                if (publication.isFile) {
                    startActivity(
                        if (session.format == BookFormat.Cbr || session.format == BookFormat.Cbz) {
                            ComicReaderActivity.intent(this@MainActivity, session.bookId, session.format, session.bookTitle)
                        } else if (session.format == BookFormat.Pdf) {
                            PdfReaderActivity.intent(
                                context = this@MainActivity,
                                bookId = session.bookId,
                                bookTitle = session.bookTitle,
                                author = session.author,
                                year = session.year,
                                pageIndex = session.pageIndex,
                                pageOffset = session.pageOffset,
                            )
                        } else if (session.format == BookFormat.Fb2) {
                            Fb2ReaderActivity.intent(
                                context = this@MainActivity,
                                bookId = session.bookId,
                                bookTitle = session.bookTitle,
                                author = session.author,
                                year = session.year,
                                locator = session.locator,
                                rightsStatus = session.rightsStatus,
                                license = session.license,
                                licenseUrl = session.licenseUrl,
                                rightsSource = session.rightsSource,
                            )
                        } else {
                            ReaderActivity.intent(
                                context = this@MainActivity,
                                bookId = session.bookId,
                                bookTitle = session.bookTitle,
                                author = session.author,
                                year = session.year,
                                initialCfi = session.locator,
                                theme = settings.theme,
                                rightsStatus = session.rightsStatus,
                                license = session.license,
                                licenseUrl = session.licenseUrl,
                                rightsSource = session.rightsSource,
                            )
                        },
                    )
                } else {
                    settings.clearReaderSession()
                }
            }
        }

        setContent {
            var theme by remember { mutableStateOf(settings.theme) }
            var readerFont by remember { mutableStateOf(settings.readerFont) }
            var readerAlignment by remember { mutableStateOf(settings.readerAlignment) }
            BookstrThemeFromSettings(readerTheme = theme) {
                var selectedTab by remember { mutableStateOf(if (requestedWord.isNullOrBlank()) 0 else 1) }
                var books by remember { mutableStateOf<List<CatalogBook>>(emptyList()) }
                var favoriteIds by remember { mutableStateOf(emptySet<String>()) }
                var externalFavorites by remember {
                    mutableStateOf(emptyList<app.bookstr.data.ExternalFavorite>())
                }
                var progress by remember { mutableStateOf(emptyMap<String, app.bookstr.data.BookProgress>()) }
                var words by remember { mutableStateOf(emptyList<app.bookstr.data.VocabularyWord>()) }
                var backfillingWords by remember { mutableStateOf(false) }
                var loading by remember { mutableStateOf(false) }
                var openingBookId by remember { mutableStateOf<String?>(null) }
                var error by remember { mutableStateOf<String?>(null) }
                var nextOffset by remember { mutableStateOf<Int?>(null) }
                var searchedQuery by remember { mutableStateOf("") }
                val downloadJobs by app.downloadStore.jobs.collectAsState()
                var searchQuery by remember { mutableStateOf("") }
                var searchResults by remember { mutableStateOf<List<BookSearchResult>>(emptyList()) }
                var searching by remember { mutableStateOf(false) }
                var searchMessage by remember { mutableStateOf<String?>(null) }

                var authMode by remember { mutableStateOf(settings.authMode) }
                var npubDisplay by remember { mutableStateOf(npubFromSettings(settings.pubkeyHex)) }
                var nsec by remember { mutableStateOf(settings.nsec.orEmpty()) }
                var showNsec by remember { mutableStateOf(authMode == NostrAuthMode.Nsec) }
                var relays by remember { mutableStateOf(settings.relays.joinToString("\n")) }
                var keepOnLock by remember { mutableStateOf(settings.keepReadingOnLockScreen) }
                var syncing by remember { mutableStateOf(false) }
                var connectingAmber by remember { mutableStateOf(false) }
                var syncMessage by remember { mutableStateOf<String?>(null) }
                var dictionaryPacks by remember { mutableStateOf(dictionaryRepository.packs()) }
                var dictionaryPackBusy by remember { mutableStateOf<String?>(null) }
                var dictionaryPackProgress by remember { mutableStateOf<Float?>(null) }
                var dictionarySource by remember { mutableStateOf(settings.dictionarySource) }
                var dictionaryTarget by remember { mutableStateOf(settings.dictionaryTarget) }
                var dictionaryMessage by remember { mutableStateOf<String?>(null) }
                var wordSortKey by remember { mutableStateOf(settings.wordSort) }
                val amberAvailable = remember { Nip55.isSignerAvailable(this@MainActivity) }

                val scope = rememberCoroutineScope()
                val lifecycleOwner = LocalLifecycleOwner.current

                DisposableEffect(lifecycleOwner, books) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) {
                            scope.launch {
                                if (books.isNotEmpty()) progress = catalog.getProgressForBooks(books)
                                words = vocabularyRepository.all()
                            }
                        }
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
                }

                suspend fun applyFavorites(
                    shared: app.bookstr.data.SharedFavorites,
                    knownBooks: List<CatalogBook> = emptyList(),
                ) {
                    val blossomBooks = shared.external
                        .mapNotNull(CatalogRepository::fromBlossomFavorite)
                        .associateBy { it.libvaultMd5 }
                    val downloadedBooks = catalog.downloadedBooks(shared.external)
                    val downloadedFavoriteIds = downloadedBooks.filter { downloaded ->
                        shared.external.any { favorite ->
                            (!downloaded.libvaultMd5.isNullOrBlank() &&
                                downloaded.libvaultMd5.equals(favorite.libvaultMd5, ignoreCase = true)) ||
                                (downloaded.title.equals(favorite.title, ignoreCase = true) &&
                                    downloaded.format.extension.equals(favorite.format, ignoreCase = true))
                        }
                    }.map { it.id }.toSet()
                    books = (knownBooks + blossomBooks.values + downloadedBooks).distinctBy { it.id }
                    favoriteIds = shared.bookIds + blossomBooks.values.map { it.id } + downloadedFavoriteIds
                    externalFavorites = shared.external.filter { favorite ->
                        favorite.libvaultMd5 !in blossomBooks && downloadedBooks.none { downloaded ->
                            (!downloaded.libvaultMd5.isNullOrBlank() &&
                                downloaded.libvaultMd5.equals(favorite.libvaultMd5, ignoreCase = true)) ||
                                (downloaded.title.equals(favorite.title, ignoreCase = true) &&
                                    downloaded.format.extension.equals(favorite.format, ignoreCase = true))
                        }
                    }
                    progress = catalog.getProgressForBooks(books)
                }

                suspend fun applyLocalBooks() {
                    books = catalog.downloadedBooks(emptyList())
                    progress = catalog.getProgressForBooks(books)
                }

                fun refreshLibrary() {
                    scope.launch {
                        loading = true
                        error = null
                        val errors = mutableListOf<String>()
                        favoritesRepository.cached(emptyList())?.let { applyFavorites(it) }
                            ?: applyLocalBooks()
                        if (settings.hasNostrIdentity()) {
                            try {
                                val shared = favoritesRepository.fetch(emptyList())
                                externalFavorites = shared.external
                                applyFavorites(shared)
                            } catch (e: Exception) {
                                Log.w("BookstrLibrary", "Favorite sync failed", e)
                                errors += "Favorites: ${e.message ?: "failed to sync"}"
                            }
                            try {
                                nostr.syncAllFromRelays(books.map { it.id })
                                progress = catalog.getProgressForBooks(books)
                                words = vocabularyRepository.all()
                            } catch (e: Exception) {
                                Log.w("BookstrLibrary", "Reading and word sync failed", e)
                                errors += "Reading sync: ${e.message ?: "failed"}"
                            }
                        } else {
                            favoriteIds = emptySet()
                            externalFavorites = emptyList()
                            applyLocalBooks()
                        }
                        try {
                            progress = catalog.getProgressForBooks(books)
                        } catch (e: Exception) {
                            errors += "Progress: ${e.message ?: "failed to load"}"
                        } finally {
                            error = errors.takeIf { it.isNotEmpty() }?.joinToString("\n")
                            loading = false
                        }
                    }
                }

                fun refreshMissingWordDefinitions(sourceLanguage: String? = null) {
                    if (backfillingWords) return
                    scope.launch {
                        backfillingWords = true
                        try {
                            val candidates = vocabularyRepository.all().filter { word ->
                                if (sourceLanguage != null) {
                                    word.language.substringBefore('-').equals(sourceLanguage, ignoreCase = true)
                                } else {
                                    word.definitions.isEmpty() ||
                                        dictionaryRepository.hasInstalledPackFor(word.language)
                                }
                            }
                            for (word in candidates) {
                                runCatching {
                                    val result = dictionaryRepository.lookupPreferred(word.word, word.language)
                                    vocabularyRepository.saveDefinition(
                                        word = word.word,
                                        language = word.language,
                                        partOfSpeech = result.partOfSpeech,
                                        definitions = result.definitions,
                                        sourceUrl = result.sourceUrl,
                                    )?.let { nostr.publishVocabularyWord(it) }
                                }
                            }
                            words = vocabularyRepository.all()
                        } finally {
                            backfillingWords = false
                        }
                    }
                }

                fun openBook(book: CatalogBook) {
                    if (openingBookId != null) return
                    openingBookId = book.id
                    scope.launch {
                        try {
                            catalog.ensureDownloaded(book)
                            books = (books + book).distinctBy { it.id }
                            if (book.format == BookFormat.Cbr || book.format == BookFormat.Cbz) {
                                startActivity(ComicReaderActivity.intent(this@MainActivity, book.id, book.format, book.title, book.epubUrl))
                            } else if (book.format == BookFormat.Pdf) {
                                startActivity(
                                    PdfReaderActivity.intent(
                                        context = this@MainActivity,
                                        bookId = book.id,
                                        bookTitle = book.title,
                                        author = book.author,
                                        year = book.year,
                                    ),
                                )
                            } else if (book.format == BookFormat.Fb2) {
                                val localProgress = catalog.getProgressForBooks(listOf(book))[book.id]
                                startActivity(
                                    Fb2ReaderActivity.intent(
                                        context = this@MainActivity,
                                        bookId = book.id,
                                        bookTitle = book.title,
                                        author = book.author,
                                        year = book.year,
                                        locator = localProgress?.cfi,
                                        rightsStatus = book.rightsStatus,
                                        license = book.license,
                                        licenseUrl = book.licenseUrl,
                                        rightsSource = book.rightsSource,
                                    ),
                                )
                            } else {
                                val localProgress = catalog.getProgressForBooks(listOf(book))[book.id]
                                startActivity(
                                    ReaderActivity.intent(
                                        context = this@MainActivity,
                                        bookId = book.id,
                                        bookTitle = book.title,
                                        author = book.author,
                                        year = book.year,
                                        initialCfi = localProgress?.cfi,
                                        theme = settings.theme,
                                        coverUrl = book.coverUrl,
                                        rightsStatus = book.rightsStatus,
                                        license = book.license,
                                        licenseUrl = book.licenseUrl,
                                        rightsSource = book.rightsSource,
                                    ),
                                )
                            }
                        } catch (e: Exception) {
                            error = e.message ?: "Failed to open book"
                            if (selectedTab == 3) searchMessage = "Could not open: ${e.message ?: "download failed"}"
                        } finally {
                            openingBookId = null
                        }
                    }
                }

                fun runSearch(loadMore: Boolean = false) {
                    val query = searchQuery.trim()
                    if (query.length < 2 || searching) {
                        searchMessage = if (query.isNotEmpty() && query.length < 2) {
                            "Type at least 2 characters to search."
                        } else searchMessage
                        return
                    }
                    scope.launch {
                        searching = true
                        searchMessage = "Searching…"
                        try {
                            val offset = if (loadMore) nextOffset ?: return@launch else 0
                            val identity = settings.pubkeyHex
                            val connection = settings.catalogConnection?.uri
                            if (!loadMore) { searchResults = emptyList(); nextOffset = null }
                            val page = catalog.searchPage(query, offset)
                            if (query != searchQuery.trim() || identity != settings.pubkeyHex || connection != settings.catalogConnection?.uri) return@launch
                            searchResults = if (loadMore) CatalogSearchPage.merge(searchResults, page.books) else page.books
                            nextOffset = page.nextOffset
                            searchedQuery = query
                            searchMessage = if (searchResults.isEmpty()) {
                                "No matches. Try a shorter query."
                            } else {
                                "${searchResults.size} result${if (searchResults.size == 1) "" else "s"}"
                            }
                        } catch (e: Exception) {
                            if (!loadMore) searchResults = emptyList()
                            searchMessage = "Search failed: ${e.message ?: "check your connection"}"
                        } finally {
                            searching = false
                        }
                    }
                }

                fun matchingSearchFavorite(result: BookSearchResult) = externalFavorites.firstOrNull { favorite ->
                    favorite.key == result.id ||
                        (!result.downloadUrl.isNullOrBlank() && favorite.url == result.downloadUrl) ||
                        (favorite.title.equals(result.title, ignoreCase = true) &&
                            favorite.author.orEmpty().equals(result.author, ignoreCase = true))
                }

                fun matchingSearchBook(result: BookSearchResult) = books.firstOrNull { book ->
                    book.id == result.id ||
                        (book.title.equals(result.title, ignoreCase = true) &&
                            book.author.equals(result.author, ignoreCase = true))
                }

                fun isSearchFavorite(result: BookSearchResult): Boolean =
                    result.id in favoriteIds ||
                        matchingSearchBook(result)?.id?.let { it in favoriteIds } == true ||
                        matchingSearchFavorite(result) != null

                LaunchedEffect(Unit) {
                    words = vocabularyRepository.all()
                    refreshLibrary()
                }

                LaunchedEffect(requestedWord, wordRequestKey) {
                    if (!requestedWord.isNullOrBlank()) {
                        selectedTab = 1
                        words = vocabularyRepository.all()
                    }
                }

                LaunchedEffect(downloadJobs.map { it.state }) {
                    if (downloadJobs.any { it.state == "complete" }) {
                        books = (books + catalog.downloadedBooks(externalFavorites)).distinctBy { it.id }
                        progress = catalog.getProgressForBooks(books)
                    }
                }
                LaunchedEffect(authMode, npubDisplay) { searchResults = emptyList(); nextOffset = null }
                if (showDownloads) DownloadsSheet(downloadJobs, onDismiss = { showDownloads = false },
                    onAction = { action, id -> DownloadService.dispatch(this@MainActivity, action, id) },
                    onOpen = { showDownloads = false; openBook(it.book) })
                pendingInvitation?.let { raw ->
                    val connection = runCatching { CatalogConnection.parse(raw) }.getOrNull()
                    AlertDialog(onDismissRequest = { pendingInvitation = null },
                        title = { Text(connection?.name ?: "Invalid catalog invitation") },
                        text = { Text(connection?.let { "${it.pubkey}\n${it.relays.joinToString("\n")}" } ?: "This invitation cannot be opened.") },
                        confirmButton = { if (connection != null) TextButton(onClick = {
                            settings.catalogConnection = connection; pendingInvitation = null; searchResults = emptyList(); nextOffset = null; selectedTab = 3
                        }, modifier = Modifier.testTag("catalog.confirm")) { Text("Connect") } },
                        dismissButton = { TextButton(onClick = { pendingInvitation = null }) { Text("Cancel") } })
                }
                Scaffold(
                    bottomBar = {
                        BookstrNavigationBar(selectedTab = selectedTab) { tab ->
                            selectedTab = tab
                            if (tab == 1) refreshMissingWordDefinitions()
                        }
                    },
                ) { padding ->
                    Box(modifier = Modifier.padding(padding)) {
                        when (selectedTab) {
                            0 -> LibraryScreen(
                                books = books,
                                favoriteIds = favoriteIds,
                                externalFavorites = externalFavorites,
                                progress = progress,
                                loading = loading,
                                openingBookId = openingBookId,
                                error = error,
                                onRefresh = { refreshLibrary() },
                                onOpenBook = ::openBook,
                                onOpenExternal = { favorite ->
                                    error = "This favorite has not been published to Blossom yet."
                                },
                                publicationSize = { book -> catalog.publicationSize(book) },
                                onUnfavoriteBook = { book ->
                                    scope.launch {
                                        try {
                                            val updated = favoritesRepository.removeFavorite(book, books)
                                            applyFavorites(updated, books)
                                            error = null
                                        } catch (e: Exception) {
                                            error = e.message ?: "Could not unfavorite this book"
                                        }
                                    }
                                },
                                onUnfavoriteExternal = { favorite ->
                                    scope.launch {
                                        try {
                                            val updated = favoritesRepository.removeFavorite(favorite, books)
                                            applyFavorites(updated, books)
                                            error = null
                                        } catch (e: Exception) {
                                            error = e.message ?: "Could not unfavorite this book"
                                        }
                                    }
                                },
                                onDeleteBook = { book ->
                                    scope.launch {
                                        if (!catalog.deletePublication(book)) {
                                            error = "Could not delete the downloaded file"
                                        } else {
                                            catalog.clearProgress(book.id)
                                            app.downloadStore.markPublicationDeleted(book.id)
                                            books = books.filterNot { it.id == book.id }
                                            nostr.publishProgress(
                                                bookId = book.id,
                                                progression = 0.0,
                                                cfi = "",
                                                title = book.title,
                                                author = book.author,
                                            )
                                            progress = catalog.getProgressForBooks(books)
                                            error = null
                                        }
                                    }
                                },
                            )

                            1 -> WordsScreen(
                                words = words,
                                error = error,
                                sortKey = wordSortKey,
                                focusWord = requestedWord,
                                focusRequestKey = wordRequestKey,
                                onSortChange = {
                                    wordSortKey = it
                                    settings.wordSort = it
                                },
                                onOpenWord = { word ->
                                    val isPdf = word.cfi.startsWith("pdf:")
                                    val isFb2 = word.cfi.startsWith("fb2:")
                                    val format = when {
                                        isPdf -> BookFormat.Pdf
                                        isFb2 -> BookFormat.Fb2
                                        else -> BookFormat.Epub
                                    }
                                    val publication = catalog.publicationFile(word.bookId, format)
                                    if (!publication.isFile) {
                                        error = "This book is no longer downloaded. Open it from Library first."
                                    } else {
                                        val book = books.firstOrNull { it.id == word.bookId }
                                        startActivity(if (isPdf) {
                                            val parts = word.cfi.split(':')
                                            PdfReaderActivity.intent(
                                                context = this@MainActivity,
                                                bookId = word.bookId,
                                                bookTitle = word.bookTitle,
                                                author = book?.author,
                                                year = book?.year,
                                                pageIndex = parts.getOrNull(1)?.toIntOrNull() ?: 0,
                                                pageOffset = parts.getOrNull(2)?.toIntOrNull() ?: 0,
                                                highlightWord = word.word,
                                            )
                                        } else if (isFb2) {
                                            Fb2ReaderActivity.intent(
                                                context = this@MainActivity,
                                                bookId = word.bookId,
                                                bookTitle = word.bookTitle,
                                                author = book?.author,
                                                year = book?.year,
                                                locator = word.cfi,
                                                rightsStatus = book?.rightsStatus,
                                                license = book?.license,
                                                licenseUrl = book?.licenseUrl,
                                                rightsSource = book?.rightsSource,
                                            )
                                        } else {
                                            ReaderActivity.intent(
                                                context = this@MainActivity,
                                                bookId = word.bookId,
                                                bookTitle = word.bookTitle,
                                                author = book?.author,
                                                year = book?.year,
                                                initialCfi = word.cfi.takeIf(String::isNotBlank),
                                                theme = settings.theme,
                                                highlightCfi = word.cfi.takeIf(String::isNotBlank),
                                                coverUrl = book?.coverUrl,
                                                rightsStatus = book?.rightsStatus ?: RIGHTS_UNKNOWN,
                                                license = book?.license,
                                                licenseUrl = book?.licenseUrl,
                                                rightsSource = book?.rightsSource,
                                            )
                                        })
                                    }
                                },
                                onDeleteWord = { word ->
                                    scope.launch {
                                        vocabularyRepository.remove(word.key)?.let {
                                            nostr.publishVocabularyWord(it)
                                        }
                                        words = vocabularyRepository.all()
                                    }
                                },
                            )

                            2 -> SettingsScreen(
                                authMode = authMode,
                                signerLabel = Nip55.signerLabel(this@MainActivity, settings.signerPackage),
                                npubDisplay = npubDisplay,
                                amberAvailable = amberAvailable,
                                nsec = nsec,
                                showNsec = showNsec,
                                relays = relays,
                                theme = theme,
                                readerFont = readerFont,
                                readerAlignment = readerAlignment,
                                keepOnLockScreen = keepOnLock,
                                syncing = syncing,
                                connectingAmber = connectingAmber,
                                syncMessage = syncMessage,
                                dictionaryPacks = dictionaryPacks,
                                dictionaryPackBusy = dictionaryPackBusy,
                                dictionaryPackProgress = dictionaryPackProgress,
                                dictionaryMessage = dictionaryMessage,
                                initialDictionarySource = dictionarySource,
                                initialDictionaryTarget = dictionaryTarget,
                                onDictionaryPairChange = { source, target ->
                                    dictionarySource = source
                                    dictionaryTarget = target
                                    settings.dictionarySource = source
                                    settings.dictionaryTarget = target
                                },
                                onConnectAmber = {
                                    scope.launch {
                                        connectingAmber = true
                                        syncMessage = null
                                        try {
                                            val (pubkey, _) = ExternalSigner.connectViaIntent(settings)
                                            authMode = settings.authMode
                                            npubDisplay = npubFromHex(pubkey)
                                            nsec = ""
                                            showNsec = false
                                            syncMessage =
                                                "Connected via ${Nip55.signerLabel(this@MainActivity, settings.signerPackage)}."
                                            refreshLibrary()
                                        } catch (e: Exception) {
                                            syncMessage = e.message ?: "Failed to connect signer"
                                        } finally {
                                            connectingAmber = false
                                        }
                                    }
                                },
                                onDisconnectNostr = {
                                    settings.disconnectNostr()
                                    authMode = NostrAuthMode.None
                                    npubDisplay = ""
                                    nsec = ""
                                    showNsec = false
                                    syncMessage = "Disconnected — Nostr sync is off"
                                },
                                onShowNsecChange = { showNsec = it },
                                onNsecChange = { value ->
                                    nsec = value
                                    if (value.isBlank()) {
                                        settings.disconnectNostr()
                                        authMode = NostrAuthMode.None
                                        npubDisplay = ""
                                        return@SettingsScreen
                                    }
                                    try {
                                        val sk = NostrCrypto.parsePrivateKey(value)
                                        val pubkey = NostrCrypto.publicKeyHex(sk)
                                        settings.connectNsec(value, pubkey)
                                        authMode = NostrAuthMode.Nsec
                                        npubDisplay = npubFromHex(pubkey)
                                        syncMessage = null
                                    } catch (e: Exception) {
                                        syncMessage = e.message ?: "Invalid nsec"
                                    }
                                },
                                onRelaysChange = {
                                    relays = it
                                    settings.relays = it.split('\n', ',').map { r -> r.trim() }.filter { r -> r.isNotEmpty() }
                                },
                                onThemeChange = {
                                    theme = it
                                    settings.theme = it
                                },
                                onReaderFontChange = {
                                    readerFont = it
                                    settings.readerFont = it
                                },
                                onReaderAlignmentChange = {
                                    readerAlignment = it
                                    settings.readerAlignment = it
                                },
                                onKeepOnLockScreenChange = {
                                    keepOnLock = it
                                    settings.keepReadingOnLockScreen = it
                                },
                                onInstallDictionaryPack = { pack ->
                                    scope.launch {
                                        dictionaryPackBusy = pack.id
                                        dictionaryPackProgress = 0f
                                        dictionaryMessage = "Downloading ${pack.label}…"
                                        runCatching {
                                            dictionaryRepository.installPack(pack.id) { downloaded, total ->
                                                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                                                    if (total > 0L) {
                                                        dictionaryPackProgress =
                                                            (downloaded.toDouble() / total).toFloat().coerceIn(0f, 1f)
                                                        dictionaryMessage =
                                                            "Downloading ${pack.label} · ${(dictionaryPackProgress!! * 100).toInt()}%"
                                                    } else {
                                                        dictionaryPackProgress = null
                                                        dictionaryMessage = "Preparing ${pack.label} for offline use…"
                                                    }
                                                }
                                            }
                                        }
                                            .onSuccess {
                                                dictionaryMessage = "${pack.label} is ready offline · refreshing saved words"
                                                refreshMissingWordDefinitions(pack.sourceLanguage)
                                            }
                                            .onFailure { dictionaryMessage = it.message ?: "Dictionary download failed" }
                                        dictionaryPacks = dictionaryRepository.packs()
                                        dictionaryPackBusy = null
                                        dictionaryPackProgress = null
                                    }
                                },
                                onRemoveDictionaryPack = { pack ->
                                    dictionaryRepository.removePack(pack.id)
                                    dictionaryPacks = dictionaryRepository.packs()
                                    dictionaryMessage = "Removed ${pack.label}"
                                },
                                onSyncNow = {
                                    scope.launch {
                                        syncing = true
                                        syncMessage = null
                                        try {
                                            nostr.syncAllFromRelays(books.map { it.id })
                                            words = vocabularyRepository.all()
                                            vocabularyRepository.allForSync().forEach {
                                                nostr.publishVocabularyWord(it)
                                            }
                                            val shared = favoritesRepository.fetch(emptyList())
                                            externalFavorites = shared.external
                                            applyFavorites(shared)
                                            if (books.isNotEmpty()) {
                                                progress = catalog.getProgressForBooks(books)
                                            }
                                            val count = favoriteIds.size + externalFavorites.size
                                            syncMessage = "Sync complete · $count LibVault favorite${if (count == 1) "" else "s"}"
                                        } catch (e: Exception) {
                                            syncMessage = e.message ?: "Sync failed"
                                        } finally {
                                            syncing = false
                                        }
                                    }
                                },
                            )

                            3 -> SearchScreen(
                                query = searchQuery,
                                hasMore = nextOffset != null && searchedQuery == searchQuery.trim(),
                                onLoadMore = { runSearch(true) },
                                onDownloads = { showDownloads = true },
                                results = searchResults,
                                searching = searching,
                                openingBookId = openingBookId,
                                message = searchMessage,
                                isFavorite = ::isSearchFavorite,
                                readingProgress = { result ->
                                    progress[result.id] ?: matchingSearchBook(result)?.let { progress[it.id] }
                                },
                                onQueryChange = {
                                    searchQuery = it
                                    nextOffset = null
                                    if (it.isBlank()) {
                                        searchResults = emptyList()
                                        searchMessage = null
                                    }
                                },
                                onSearch = { runSearch() },
                                onOpen = { result -> result.asCatalogBook()?.let { book ->
                                    if (book.libvaultMd5 != null && !catalog.publicationFile(book.id, book.format).isFile) {
                                        openingBookId = book.id
                                        scope.launch {
                                            try {
                                                val edition = catalog.resolveEdition(book)
                                                app.downloadStore.enqueue(book, edition)
                                                DownloadService.dispatch(this@MainActivity)
                                                showDownloads = true
                                            } catch (e: Exception) {
                                                searchMessage = e.message ?: "Could not start download"
                                            } finally {
                                                openingBookId = null
                                            }
                                        }
                                    } else openBook(book)
                                } },
                                onToggleFavorite = { result ->
                                    scope.launch {
                                        try {
                                            val book = result.asCatalogBook()
                                            val allBooks = (books + listOfNotNull(book)).distinctBy { it.id }
                                            val externalMatch = matchingSearchFavorite(result)
                                            val localMatch = matchingSearchBook(result)
                                            val wasFavorite = isSearchFavorite(result)
                                            val updated = when {
                                                externalMatch != null ->
                                                    favoritesRepository.removeFavorite(externalMatch, allBooks)
                                                wasFavorite && localMatch != null ->
                                                    favoritesRepository.removeFavorite(localMatch, allBooks)
                                                wasFavorite && book != null ->
                                                    favoritesRepository.removeFavorite(book, allBooks)
                                                book != null -> favoritesRepository.addFavorite(book, allBooks)
                                                else -> favoritesRepository.addFavorite(
                                                    SharedFavoriteRef(
                                                        bookstrId = result.id,
                                                        title = result.title,
                                                        author = result.author,
                                                        year = result.year,
                                                        format = result.format?.extension,
                                                        url = result.downloadUrl,
                                                        rightsStatus = result.rightsStatus,
                                                        license = result.license,
                                                        licenseUrl = result.licenseUrl,
                                                        rightsSource = result.rightsSource,
                                                    ),
                                                    allBooks,
                                                )
                                            }
                                            applyFavorites(updated, allBooks)
                                            searchMessage = if (wasFavorite) {
                                                "Removed from Nostr favorites"
                                            } else {
                                                "Added to Nostr favorites"
                                            }
                                        } catch (e: Exception) {
                                            searchMessage = e.message ?: "Could not update favorites"
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if ((application as BookstrApp).downloadStore.jobs.value.any { it.active }) DownloadService.dispatch(this)
        if (::amberSession.isInitialized) {
            amberSession.attach()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingInvitation = intent.dataString?.takeIf { it.startsWith("bookstr:") }
        showDownloads = intent.getBooleanExtra("open_downloads", false)
        requestedWord = intent.getStringExtra(EXTRA_OPEN_WORD)
        wordRequestKey += 1
    }

    override fun onPause() {
        if (::amberSession.isInitialized) {
            amberSession.detach()
        }
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    private fun hideSystemUi() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun requestHomeShortcut() {
        val shortcut = ShortcutInfoCompat.Builder(this, "bookstr-home")
            .setShortLabel("Bookstr")
            .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
            .setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN))
            .build()
        ShortcutManagerCompat.requestPinShortcut(this, shortcut, null)
    }

    companion object {
        const val EXTRA_PIN_SHORTCUT = "pin_shortcut"
        const val EXTRA_OPEN_WORD = "open_word"
        private fun npubFromSettings(pubkeyHex: String?): String =
            pubkeyHex?.let { npubFromHex(it) }.orEmpty()

        private fun npubFromHex(pubkeyHex: String): String {
            return try {
                val bytes = pubkeyHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
                val npub = Bech32.encode("npub", bytes)
                if (npub.length < 20) npub else "${npub.take(12)}…${npub.takeLast(8)}"
            } catch (_: Exception) {
                pubkeyHex.take(12) + "…"
            }
        }
    }
}
