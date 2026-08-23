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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bookstr.data.BookSearchResult
import app.bookstr.data.BookProgress
import kotlinx.coroutines.delay

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SearchScreen(
    query: String,
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
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val searchFocusRequester = androidx.compose.runtime.remember { FocusRequester() }
    LaunchedEffect(Unit) {
        searchFocusRequester.requestFocus()
        delay(100)
        keyboardController?.show()
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
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
                    focusManager.clearFocus()
                    onSearch()
                }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(searchFocusRequester),
                trailingIcon = {
                    IconButton(
                        enabled = query.trim().length >= 2 && !searching,
                        onClick = {
                            focusManager.clearFocus()
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
        items(results, key = BookSearchResult::id) { result ->
            val book = result.asCatalogBook()
            val favorite = isFavorite(result)
            val bookProgress = readingProgress(result)?.takeIf {
                it.progression > 0.0 || it.furthestProgression > 0.0 || it.cfi.isNotBlank()
            }
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .combinedClickable(
                        enabled = book != null && openingBookId == null,
                        onClick = { onOpen(result) },
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
                        Text(
                            text = buildList {
                                add(result.author)
                                result.year?.let(::add)
                                result.publisher?.let(::add)
                            }.joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = buildList {
                                add(result.source)
                                result.language?.uppercase()?.let(::add)
                                result.format?.extension?.uppercase()?.let(::add)
                                if (result.rating > 0) add("★ ${"%.1f".format(result.rating)}")
                                if (result.editionCount > 0) add("${result.editionCount} editions")
                                if (!result.isReadable) add("metadata only")
                            }.joinToString(" · "),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (favorite || bookProgress != null) {
                            Text(
                                text = buildList {
                                    if (favorite) add("♥ Favorite")
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
                    IconButton(
                        onClick = { onToggleFavorite(result) },
                    ) {
                        Icon(
                            imageVector = if (favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            contentDescription = if (favorite) "Remove from favorites" else "Add to favorites",
                            tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                        )
                    }
                }
            }
        }
    }
}
