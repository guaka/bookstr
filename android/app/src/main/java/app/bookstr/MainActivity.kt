package app.bookstr

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.bookstr.data.CatalogBook
import app.bookstr.data.NostrAuthMode
import app.bookstr.nostr.AmberIntentSession
import app.bookstr.nostr.ExternalSigner
import app.bookstr.nostr.Nip55
import app.bookstr.nostr.NostrCrypto
import app.bookstr.ui.LibraryScreen
import app.bookstr.ui.SettingsScreen
import app.bookstr.ui.theme.BookstrThemeFromSettings
import app.bookstr.util.Bech32
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var amberSession: AmberIntentSession

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        amberSession = AmberIntentSession(this)

        val app = application as BookstrApp
        val settings = app.settingsRepository
        val catalog = app.catalogRepository
        val nostr = app.nostrRepository

        setContent {
            BookstrThemeFromSettings(readerTheme = settings.theme) {
                var selectedTab by remember { mutableStateOf(0) }
                var books by remember { mutableStateOf<List<CatalogBook>>(emptyList()) }
                var progress by remember { mutableStateOf(emptyMap<String, app.bookstr.data.BookProgress>()) }
                var loading by remember { mutableStateOf(false) }
                var error by remember { mutableStateOf<String?>(null) }

                var catalogUrl by remember { mutableStateOf(settings.catalogUrl) }
                var authMode by remember { mutableStateOf(settings.authMode) }
                var npubDisplay by remember { mutableStateOf(npubFromSettings(settings.pubkeyHex)) }
                var nsec by remember { mutableStateOf(settings.nsec.orEmpty()) }
                var showNsec by remember { mutableStateOf(authMode == NostrAuthMode.Nsec) }
                var relays by remember { mutableStateOf(settings.relays.joinToString("\n")) }
                var theme by remember { mutableStateOf(settings.theme) }
                var keepOnLock by remember { mutableStateOf(settings.keepReadingOnLockScreen) }
                var syncing by remember { mutableStateOf(false) }
                var connectingAmber by remember { mutableStateOf(false) }
                var syncMessage by remember { mutableStateOf<String?>(null) }
                val amberAvailable = remember { Nip55.isSignerAvailable(this@MainActivity) }

                val scope = rememberCoroutineScope()

                fun refreshLibrary() {
                    scope.launch {
                        loading = true
                        error = null
                        try {
                            val fetched = catalog.fetchCatalog()
                            books = fetched
                            progress = catalog.getProgressForBooks(fetched)
                        } catch (e: Exception) {
                            error = e.message ?: "Failed to load catalog"
                        } finally {
                            loading = false
                        }
                    }
                }

                LaunchedEffect(Unit) {
                    refreshLibrary()
                }

                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(
                                selected = selectedTab == 0,
                                onClick = { selectedTab = 0 },
                                icon = { Icon(Icons.Default.Book, contentDescription = "Library") },
                                label = { Text("Library") },
                            )
                            NavigationBarItem(
                                selected = selectedTab == 1,
                                onClick = { selectedTab = 1 },
                                icon = { Icon(Icons.Default.Settings, contentDescription = "Settings") },
                                label = { Text("Settings") },
                            )
                        }
                    },
                ) { padding ->
                    Box(modifier = Modifier.padding(padding)) {
                        when (selectedTab) {
                            0 -> LibraryScreen(
                                books = books,
                                progress = progress,
                                loading = loading,
                                error = error,
                                onRefresh = { refreshLibrary() },
                                onOpenBook = { book ->
                                    scope.launch {
                                        try {
                                            loading = true
                                            catalog.ensureDownloaded(book)
                                            val localProgress = catalog.getProgressForBooks(listOf(book))[book.id]
                                            startActivity(
                                                ReaderActivity.intent(
                                                    context = this@MainActivity,
                                                    bookId = book.id,
                                                    bookTitle = book.title,
                                                    initialCfi = localProgress?.cfi,
                                                    theme = settings.theme,
                                                ),
                                            )
                                        } catch (e: Exception) {
                                            error = e.message ?: "Failed to open book"
                                        } finally {
                                            loading = false
                                        }
                                    }
                                },
                            )

                            1 -> SettingsScreen(
                                catalogUrl = catalogUrl,
                                authMode = authMode,
                                npubDisplay = npubDisplay,
                                amberAvailable = amberAvailable,
                                nsec = nsec,
                                showNsec = showNsec,
                                relays = relays,
                                theme = theme,
                                keepOnLockScreen = keepOnLock,
                                syncing = syncing,
                                connectingAmber = connectingAmber,
                                syncMessage = syncMessage,
                                onCatalogUrlChange = {
                                    catalogUrl = it
                                    settings.catalogUrl = it
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
                                                "Connected via Amber. Allow “remember” for kind 30078 so progress can sync in the background."
                                        } catch (e: Exception) {
                                            syncMessage = e.message ?: "Failed to connect Amber"
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
                                onKeepOnLockScreenChange = {
                                    keepOnLock = it
                                    settings.keepReadingOnLockScreen = it
                                },
                                onSyncNow = {
                                    scope.launch {
                                        syncing = true
                                        syncMessage = null
                                        try {
                                            nostr.syncAllFromRelays(books.map { it.id })
                                            if (books.isNotEmpty()) {
                                                progress = catalog.getProgressForBooks(books)
                                            }
                                            syncMessage = "Sync complete"
                                        } catch (e: Exception) {
                                            syncMessage = e.message ?: "Sync failed"
                                        } finally {
                                            syncing = false
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
        if (::amberSession.isInitialized) {
            amberSession.attach()
        }
    }

    override fun onPause() {
        if (::amberSession.isInitialized) {
            amberSession.detach()
        }
        super.onPause()
    }

    companion object {
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
