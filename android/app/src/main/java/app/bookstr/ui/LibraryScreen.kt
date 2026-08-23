package app.bookstr.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bookstr.data.BookProgress
import app.bookstr.data.CatalogBook
import app.bookstr.data.ExternalFavorite

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun LibraryScreen(
    books: List<CatalogBook>,
    favoriteIds: Set<String>,
    externalFavorites: List<ExternalFavorite>,
    progress: Map<String, BookProgress>,
    loading: Boolean,
    openingBookId: String? = null,
    error: String?,
    onRefresh: () -> Unit,
    onOpenBook: (CatalogBook) -> Unit,
    onOpenExternal: (ExternalFavorite) -> Unit,
    publicationSize: (CatalogBook) -> Long? = { null },
    onUnfavoriteBook: (CatalogBook) -> Unit = {},
    onUnfavoriteExternal: (ExternalFavorite) -> Unit = {},
    onDeleteBook: (CatalogBook) -> Unit = {},
) {
    var favoriteQuery by rememberSaveable { mutableStateOf("") }
    var selectedBook by remember { mutableStateOf<CatalogBook?>(null) }
    var selectedExternal by remember { mutableStateOf<ExternalFavorite?>(null) }
    val favorites = books.filter { it.id in favoriteIds }
    val normalizedQuery = favoriteQuery.trim()
    val visibleFavorites = favorites.filter { book ->
        normalizedQuery.isEmpty() || listOf(book.title, book.author, book.year.orEmpty(), book.format.extension)
            .any { it.contains(normalizedQuery, ignoreCase = true) }
    }
    val visibleExternalFavorites = externalFavorites.filter { favorite ->
        normalizedQuery.isEmpty() || listOf(
            favorite.title,
            favorite.author.orEmpty(),
            favorite.year.orEmpty(),
            favorite.format.orEmpty(),
        )
            .any { it.contains(normalizedQuery, ignoreCase = true) }
    }
    val reading = books
        .filter { book -> progress[book.id]?.let(::hasStartedReading) == true }
        .sortedByDescending { progress[it.id]?.updatedAt ?: 0L }

    Scaffold { padding ->
        if (loading && books.isEmpty() && externalFavorites.isEmpty()) {
            CircularProgressIndicator(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(32.dp),
            )
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(start = 6.dp, top = 2.dp, end = 6.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                androidx.compose.foundation.layout.Box(
                    modifier = Modifier.fillMaxWidth().height(24.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text("Library", style = MaterialTheme.typography.titleSmall)
                }
            }
            if (error != null) {
                item {
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onRefresh() }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
            }

            shelfHeading("Reading")
            if (reading.isEmpty()) emptyShelf("Books you open will appear here with their progress.")
            else bookRows(
                reading,
                progress,
                openingBookId,
                keyPrefix = "reading",
                showPublicationStatus = false,
                onOpenBook = onOpenBook,
                onLongPress = { selectedBook = it },
            )

            shelfHeading("Favorites")
            if (favorites.isEmpty() && externalFavorites.isEmpty()) {
                emptyShelf("Heart a book in LibVault to keep it here.")
            } else {
                item(key = "favorite-search") {
                    OutlinedTextField(
                        value = favoriteQuery,
                        onValueChange = { favoriteQuery = it },
                        placeholder = { Text("Search favorites") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp),
                    )
                }
                if (visibleFavorites.isEmpty() && visibleExternalFavorites.isEmpty()) {
                    emptyShelf("No favorites match “$normalizedQuery”.")
                }
                bookRows(
                    visibleFavorites,
                    progress,
                    openingBookId,
                    keyPrefix = "favorite",
                    showPublicationStatus = true,
                    onOpenBook = onOpenBook,
                    onLongPress = { selectedBook = it },
                )
                items(visibleExternalFavorites, key = { "external-${it.key}" }) { favorite ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .combinedClickable(
                                onClick = { onOpenExternal(favorite) },
                                onLongClick = { selectedExternal = favorite },
                            ),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                            Text(
                                text = favorite.title,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            favoriteMetadata(
                                author = favorite.author,
                                year = favorite.year,
                                showMissingValues = true,
                            )
                            favoritePublicationStatus(
                                format = favorite.format,
                                availableOnBlossom = !favorite.blossomSha256.isNullOrBlank() &&
                                    !favorite.blossomUrl.isNullOrBlank(),
                            )
                        }
                    }
                }
            }
        }
    }

    selectedBook?.let { book ->
        BookDetailsDialog(
            book = book,
            progress = progress[book.id],
            isFavorite = book.id in favoriteIds,
            publicationBytes = publicationSize(book),
            onDismiss = { selectedBook = null },
            onOpen = {
                selectedBook = null
                onOpenBook(book)
            },
            onUnfavorite = {
                selectedBook = null
                onUnfavoriteBook(book)
            },
            onDelete = {
                selectedBook = null
                onDeleteBook(book)
            },
        )
    }

    selectedExternal?.let { favorite ->
        ExternalBookDetailsDialog(
            favorite = favorite,
            onDismiss = { selectedExternal = null },
            onOpen = {
                selectedExternal = null
                onOpenExternal(favorite)
            },
            onUnfavorite = {
                selectedExternal = null
                onUnfavoriteExternal(favorite)
            },
        )
    }
}

private fun LazyListScope.shelfHeading(title: String) {
    item(key = "heading-$title") {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

private fun LazyListScope.emptyShelf(message: String) {
    item {
        Text(
            text = message,
            color = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun LazyListScope.bookRows(
    books: List<CatalogBook>,
    progress: Map<String, BookProgress>,
    openingBookId: String?,
    keyPrefix: String,
    showPublicationStatus: Boolean,
    onOpenBook: (CatalogBook) -> Unit,
    onLongPress: (CatalogBook) -> Unit,
) {
    items(books, key = { "$keyPrefix-${it.id}" }) { book ->
        val bookProgress = progress[book.id]
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(
                    enabled = openingBookId == null,
                    onClick = { onOpenBook(book) },
                    onLongClick = { onLongPress(book) },
                ),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(
                        text = book.title,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (openingBookId == book.id) {
                        Spacer(modifier = Modifier.size(10.dp))
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    }
                }
                favoriteMetadata(book.author, book.year)
                if (showPublicationStatus) {
                    favoritePublicationStatus(
                        format = book.format.extension,
                        availableOnBlossom = !book.blossomSha256.isNullOrBlank(),
                    )
                }
                if (openingBookId == book.id) {
                    Text(
                        text = "Downloading and opening…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
                if (bookProgress != null && hasStartedReading(bookProgress)) {
                    LinearProgressIndicator(
                        progress = { bookProgress.progression.toFloat() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                    )
                    Text(
                        text = "${(bookProgress.progression * 100).toInt()}% read",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BookDetailsDialog(
    book: CatalogBook,
    progress: BookProgress?,
    isFavorite: Boolean,
    publicationBytes: Long?,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onUnfavorite: () -> Unit,
    onDelete: () -> Unit,
) {
    FullScreenDetails(title = "Book details", onDismiss = onDismiss) {
        Text(book.title, style = MaterialTheme.typography.headlineMedium)
        favoriteMetadata(book.author, book.year, showMissingValues = true)
        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
        DetailRow("Format", book.format.extension.uppercase())
        DetailRow("Blossom", if (book.blossomSha256.isNullOrBlank()) "Not available" else "Available")
        DetailRow("Downloaded", publicationBytes?.let(::formatBytes) ?: "No")
        progress?.takeIf(::hasStartedReading)?.let {
            DetailRow("Reading progress", "${(it.progression.coerceIn(0.0, 1.0) * 100).toInt()}%")
            LinearProgressIndicator(
                progress = { it.progression.coerceIn(0.0, 1.0).toFloat() },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        book.isbn?.takeIf(String::isNotBlank)?.let { DetailRow("ISBN", it) }
        book.sourceUrl?.takeIf(String::isNotBlank)?.let { DetailRow("Source", sourceLabel(it)) }
        Spacer(modifier = Modifier.height(12.dp))
        Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) { Text("Open book") }
        if (isFavorite) {
            OutlinedButton(onClick = onUnfavorite, modifier = Modifier.fillMaxWidth()) {
                Text("Unfavorite")
            }
        }
        if (publicationBytes != null) {
            OutlinedButton(onClick = onDelete, modifier = Modifier.fillMaxWidth()) {
                Text("Delete download")
            }
            Text(
                "Removes the local file and reading progress. The favorite stays, and you can download it again.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ExternalBookDetailsDialog(
    favorite: ExternalFavorite,
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onUnfavorite: () -> Unit,
) {
    FullScreenDetails(title = "Book details", onDismiss = onDismiss) {
        Text(favorite.title, style = MaterialTheme.typography.headlineMedium)
        favoriteMetadata(favorite.author, favorite.year, showMissingValues = true)
        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
        DetailRow("Format", favorite.format?.uppercase() ?: "Unknown")
        val onBlossom = !favorite.blossomSha256.isNullOrBlank() && !favorite.blossomUrl.isNullOrBlank()
        DetailRow("Blossom", if (onBlossom) "Available" else "Not available")
        favorite.isbn?.takeIf(String::isNotBlank)?.let { DetailRow("ISBN", it) }
        favorite.url?.takeIf(String::isNotBlank)?.let { DetailRow("Source", sourceLabel(it)) }
        Spacer(modifier = Modifier.height(12.dp))
        if (onBlossom) {
            Button(onClick = onOpen, modifier = Modifier.fillMaxWidth()) { Text("Open book") }
        }
        OutlinedButton(onClick = onUnfavorite, modifier = Modifier.fillMaxWidth()) {
            Text("Unfavorite")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FullScreenDetails(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        androidx.compose.material3.Surface(modifier = Modifier.fillMaxSize()) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text(title) },
                        navigationIcon = {
                            IconButton(onClick = onDismiss) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                            }
                        },
                    )
                },
            ) { padding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(18.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    content = content,
                )
            }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(label, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.width(128.dp))
        Text(value, modifier = Modifier.weight(1f))
    }
}

private fun formatBytes(bytes: Long): String {
    val megabytes = bytes / (1024.0 * 1024.0)
    return if (megabytes >= 1.0) "%.1f MB".format(megabytes) else "${bytes / 1024} KB"
}

private fun sourceLabel(url: String): String =
    runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull() ?: url

private fun hasStartedReading(progress: BookProgress): Boolean =
    progress.cfi.isNotBlank() || progress.progression > 0.0

@Composable
private fun favoritePublicationStatus(format: String?, availableOnBlossom: Boolean) {
    val formatLabel = format?.trim()?.takeIf(String::isNotEmpty)?.uppercase() ?: "FORMAT UNKNOWN"
    Text(
        text = "$formatLabel · ${if (availableOnBlossom) "On Blossom" else "Not on Blossom"}",
        style = MaterialTheme.typography.labelMedium,
        color = if (availableOnBlossom) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.secondary,
        maxLines = 1,
    )
}

@Composable
private fun favoriteMetadata(
    author: String?,
    year: String?,
    showMissingValues: Boolean = false,
) {
    val normalizedAuthor = author
        ?.trim()
        ?.takeIf { it.isNotEmpty() && !it.equals("Unknown", ignoreCase = true) }
    val normalizedYear = year?.trim()?.takeIf(String::isNotEmpty)
    val text = listOfNotNull(
        normalizedAuthor ?: "Author unknown".takeIf { showMissingValues },
        normalizedYear ?: "Year unknown".takeIf { showMissingValues },
    ).joinToString(" · ")
    if (text.isNotEmpty()) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
