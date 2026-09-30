package app.bookstr.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import app.bookstr.data.BookListFilters
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bookstr.data.displayBookAuthor
import app.bookstr.data.BookSearchResult
import app.bookstr.data.BookProgress
import kotlinx.coroutines.delay

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SearchScreen(
    query: String,
    nextOffset: Int? = null,
    onLoadMore: () -> Unit = {},
    onDownloads: () -> Unit = {},
    results: List<BookSearchResult>,
    searching: Boolean,
    openingBookId: String?,
    message: String?,
    isFavorite: (BookSearchResult) -> Boolean,
    readingProgress: (BookSearchResult) -> BookProgress?,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onOpen: (BookSearchResult) -> Unit,
    onToggleFavorite: (BookSearchResult) -> Unit,
) {
    var language by rememberSaveable { mutableStateOf("") }
    var format by rememberSaveable { mutableStateOf("") }
    val readable = results.filter(BookSearchResult::isReadable)
    val languages = BookListFilters.languages(readable.map { it.language })
    val formats = BookListFilters.formats(readable.map { it.format?.extension })
    val filters = BookListFilters(language, format).sanitize(languages, formats)
    LaunchedEffect(filters) { language = filters.language; format = filters.format }
    val visible = readable.filter { filters.matches(it.language, it.format?.extension) }
    val listState = rememberLazyListState()
    var requestedOffset by remember(query) { mutableStateOf<Int?>(null) }
    val nearEnd by remember(listState) {
        derivedStateOf {
            val layout = listState.layoutInfo
            layout.totalItemsCount > 0 &&
                (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >= layout.totalItemsCount - 3
        }
    }
    LaunchedEffect(nextOffset, searching, nearEnd) {
        if (nextOffset == null) requestedOffset = null
        else if (!searching && nearEnd && requestedOffset != nextOffset) {
            requestedOffset = nextOffset
            onLoadMore()
        }
    }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    fun dismissKeyboard() {
        focusManager.clearFocus()
        keyboardController?.hide()
    }
    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize().testTag("search.results")
            .pointerInput(Unit) { detectTapGestures(onTap = { dismissKeyboard() }) },
        contentPadding = PaddingValues(start = 6.dp, top = 2.dp, end = 6.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        item {
            Box(
                modifier = Modifier.fillMaxWidth().height(24.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("Search", style = MaterialTheme.typography.titleSmall)
            }
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                placeholder = { Text("Title, author, ISBN, publisher") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    dismissKeyboard()
                    onSearch()
                }),
                modifier = Modifier
                    .fillMaxWidth().testTag("search.query"),
                trailingIcon = {
                    IconButton(
                        modifier = Modifier.testTag("search.submit"),
                        enabled = query.trim().length >= 2 && !searching,
                        onClick = {
                            dismissKeyboard()
                            onSearch()
                        },
                    ) {
                        if (searching) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Search, contentDescription = "Search books")
                        }
                    }
                },
            )
        }
        item {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                TextButton(onClick = { dismissKeyboard(); onDownloads() }, modifier = Modifier.testTag("search.downloads")) { Text("Downloads") }
            }
        }
        item { BookFilterBar("search", languages, formats, filters.language, filters.format,
            { dismissKeyboard(); language = it }, { dismissKeyboard(); format = it }) }
        if (!message.isNullOrBlank()) {
            item {
                Text(
                    text = message,
                    color = if (message.startsWith("Search failed")) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.secondary
                    },
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
        }
        items(visible, key = BookSearchResult::id) { result ->
            val book = result.asCatalogBook()
            val bookProgress = readingProgress(result)?.takeIf {
                it.progression > 0.0 || it.furthestProgression > 0.0 || it.cfi.isNotBlank()
            }
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("search.open.${result.id}")
                    .combinedClickable(
                        enabled = book != null && openingBookId == null,
                        onClick = { dismissKeyboard(); onOpen(result) },
                        onLongClick = {},
                    ),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 12.dp, top = 9.dp, bottom = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = result.title,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            if (openingBookId == result.id) {
                                Spacer(Modifier.width(8.dp))
                                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = listOfNotNull(displayBookAuthor(result.author), result.year).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.secondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            RightsMarker(
                                rightsStatus = result.rightsStatus,
                                license = result.license,
                                licenseUrl = result.licenseUrl,
                                rightsSource = result.rightsSource,
                                modifier = Modifier.padding(start = 6.dp),
                            )
                        }
                        result.publisher?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.secondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (bookProgress != null) {
                            Text(
                                text = buildList {
                                    bookProgress?.let {
                                        add("Reading · ${(it.progression.coerceIn(0.0, 1.0) * 100).toInt()}%")
                                    }
                                }.joinToString("   "),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        if (openingBookId == result.id) {
                            Text(
                                "Downloading and opening…",
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    }
                    Column(
                        modifier = Modifier.widthIn(max = 140.dp).padding(horizontal = 10.dp),
                        horizontalAlignment = Alignment.End,
                    ) {
                        result.language?.let { Text(languageDisplayName(it), style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        result.format?.let { Text(it.extension.uppercase(), style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.secondary) }
                        Text(result.source, style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (result.rating > 0) Text("★ ${"%.1f".format(result.rating)}", style = MaterialTheme.typography.labelSmall)
                        if (result.editionCount > 0) Text("${result.editionCount} editions", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        if (searching && results.isNotEmpty()) item {
            CircularProgressIndicator(modifier = Modifier.padding(12.dp).testTag("search.loading-more"))
        }
    }
}
