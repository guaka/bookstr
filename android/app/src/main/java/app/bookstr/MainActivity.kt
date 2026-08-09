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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.bookstr.data.CatalogBook
import app.bookstr.data.ReaderTheme
import app.bookstr.ui.LibraryScreen
import app.bookstr.ui.SettingsScreen
import app.bookstr.ui.theme.BookstrThemeFromSettings
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
                var nsec by remember { mutableStateOf(settings.nsec.orEmpty()) }
                var relays by remember { mutableStateOf(settings.relays.joinToString("\n")) }
                var theme by remember { mutableStateOf(settings.theme) }
                var keepOnLock by remember { mutableStateOf(settings.keepReadingOnLockScreen) }
                var syncing by remember { mutableStateOf(false) }
                var syncMessage by remember { mutableStateOf<String?>(null) }

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
                            nsec = nsec,
                            relays = relays,
                            theme = theme,
                            keepOnLockScreen = keepOnLock,
                            syncing = syncing,
                            syncMessage = syncMessage,
                            onCatalogUrlChange = {
                                catalogUrl = it
                                settings.catalogUrl = it
                            },
                            onNsecChange = {
                                nsec = it
                                settings.nsec = it
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
                                        nostr.syncAllFromRelays()
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
}
