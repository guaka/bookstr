package app.bookstr.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.*
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.platform.testTag
import androidx.compose.runtime.LaunchedEffect
import app.bookstr.data.displayBookAuthor
import app.bookstr.data.BookListFilters
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.platform.LocalUriHandler
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
    var language by rememberSaveable { mutableStateOf("") }
    var format by rememberSaveable { mutableStateOf("") }
    var selectedBook by remember { mutableStateOf<CatalogBook?>(null) }
    var pendingDelete by remember { mutableStateOf<CatalogBook?>(null) }
    val library = books.filter { publicationSize(it) != null || progress[it.id]?.let(::hasStartedReading) == true }
    val languages = BookListFilters.languages(library.map { it.language })
    val formats = BookListFilters.formats(library.map { it.format.extension })
    val filters = BookListFilters(language, format).sanitize(languages, formats)
    LaunchedEffect(filters) { language = filters.language; format = filters.format }
    val visibleBooks = library.filter { filters.matches(it.language, it.format.extension) }
        .sortedByDescending { progress[it.id]?.updatedAt ?: 0L }

    Scaffold { padding ->
        if (loading && books.isEmpty()) {
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

            item { BookFilterBar("library", languages, formats, filters.language, filters.format,
                { language = it }, { format = it }) }
            if (visibleBooks.isEmpty()) emptyShelf("No books to show.")
            else bookRows(
                visibleBooks,
                progress,
                openingBookId,
                keyPrefix = "library",
                onOpenBook = onOpenBook,
                onLongPress = { selectedBook = it },
                onDelete = { pendingDelete = it },
            )

        }
    }
    pendingDelete?.let { book ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Delete “${book.title}”?") },
            text = { Text("Remove the local file and reading progress?") },
            confirmButton = { TextButton(modifier = Modifier.testTag("library.delete.confirm"), onClick = {
                pendingDelete = null
                onDeleteBook(book)
            }) { Text("Delete") } },
            dismissButton = { TextButton(modifier = Modifier.testTag("library.delete.cancel"),
                onClick = { pendingDelete = null }) { Text("Cancel") } },
        )
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
                pendingDelete = book
            },
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

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
private fun LazyListScope.bookRows(
    books: List<CatalogBook>,
    progress: Map<String, BookProgress>,
    openingBookId: String?,
    keyPrefix: String,
    onOpenBook: (CatalogBook) -> Unit,
    onLongPress: (CatalogBook) -> Unit,
    onDelete: (CatalogBook) -> Unit,
) {
    items(books, key = { "$keyPrefix-${it.id}" }) { book ->
        val bookProgress = progress[book.id]
        val dismissState = rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onDelete(book)
            false
        })
        SwipeToDismissBox(
            state = dismissState,
            enableDismissFromStartToEnd = false,
            modifier = Modifier.clip(CardDefaults.shape).testTag("library.swipe.${book.id}"),
            backgroundContent = {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.errorContainer).padding(24.dp),
                    contentAlignment = Alignment.CenterEnd) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete book")
                }
            },
        ) {
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
                    favoriteMetadata(
                        book.author, book.year, book.rightsStatus, book.license, book.licenseUrl, book.rightsSource,
                    )
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
        favoriteMetadata(
            book.author, book.year, book.rightsStatus, book.license, book.licenseUrl, book.rightsSource,
            showMissingValues = true,
        )
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
        RightsDetails(book.rightsStatus, book.license, book.licenseUrl, book.rightsSource)
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

@Composable
private fun RightsDetails(status: String, license: String?, licenseUrl: String?, source: String?) {
    val rights = app.bookstr.data.BookRightsMetadata.normalize(status, license, licenseUrl, source)
    val uriHandler = LocalUriHandler.current
    DetailRow("Rights status", rights.accessibleLabel)
    rights.license?.let { DetailRow("Rights statement", it) }
    rights.licenseUrl?.let { url ->
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Text("License URL", color = MaterialTheme.colorScheme.secondary, modifier = Modifier.width(128.dp))
            Text(
                text = url,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.weight(1f).clickable { uriHandler.openUri(url) },
            )
        }
    }
    rights.source?.let { DetailRow("Rights source", it) }
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
private fun favoriteMetadata(
    author: String?,
    year: String?,
    rightsStatus: String,
    license: String?,
    licenseUrl: String?,
    rightsSource: String?,
    showMissingValues: Boolean = false,
) {
    val normalizedAuthor = displayBookAuthor(author)
    val normalizedYear = year?.trim()?.takeIf(String::isNotEmpty)
    val text = listOfNotNull(
        normalizedAuthor,
        normalizedYear ?: "Year unknown".takeIf { showMissingValues },
    ).joinToString(" · ")
    Row(verticalAlignment = Alignment.CenterVertically) {
      if (text.isNotEmpty()) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
      }
      RightsMarker(
          rightsStatus = rightsStatus,
          license = license,
          licenseUrl = licenseUrl,
          rightsSource = rightsSource,
          modifier = Modifier.padding(start = 6.dp),
      )
    }
}
