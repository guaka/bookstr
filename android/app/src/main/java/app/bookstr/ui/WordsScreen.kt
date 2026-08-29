package app.bookstr.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.ui.Alignment
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bookstr.data.VocabularyWord

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WordsScreen(
    words: List<VocabularyWord>,
    error: String?,
    sortKey: String,
    focusWord: String?,
    focusRequestKey: Int,
    onSortChange: (String) -> Unit,
    onOpenWord: (VocabularyWord) -> Unit,
    onDeleteWord: (VocabularyWord) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var sort by remember(sortKey) { mutableStateOf(WordSort.fromKey(sortKey)) }
    var sortMenu by remember { mutableStateOf(false) }
    var pendingDelete by remember { mutableStateOf<VocabularyWord?>(null) }
    androidx.compose.runtime.LaunchedEffect(focusWord, focusRequestKey) {
        if (!focusWord.isNullOrBlank()) query = focusWord
    }
    val visibleWords = remember(words, query, sort) {
        val needle = query.trim().lowercase()
        val filtered = if (needle.isBlank()) words else words.filter { word ->
            word.word.lowercase().contains(needle) ||
                word.bookTitle.lowercase().contains(needle) ||
                word.contextSentence.lowercase().contains(needle) ||
                word.definitions.any { it.lowercase().contains(needle) }
        }
        when (sort) {
            WordSort.Recent -> filtered.sortedByDescending(VocabularyWord::lastSeenAt)
            WordSort.RecentlyAdded -> filtered.sortedByDescending(VocabularyWord::firstSeenAt)
            WordSort.FirstSaved -> filtered.sortedBy(VocabularyWord::firstSeenAt)
            WordSort.Alphabetical -> filtered.sortedBy { it.word.lowercase() }
            WordSort.Book -> filtered.sortedWith(
                compareBy<VocabularyWord> { it.bookTitle.lowercase() }.thenBy { it.word.lowercase() },
            )
            WordSort.MostSeen -> filtered.sortedByDescending(VocabularyWord::lookupCount)
        }
    }
    LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 6.dp, top = 2.dp, end = 6.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth().height(24.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text("Words", style = MaterialTheme.typography.titleSmall)
                }
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Filter words") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        trailingIcon = if (query.isNotEmpty()) {
                            {
                                IconButton(onClick = { query = "" }) {
                                    Icon(Icons.Default.Clear, contentDescription = "Clear filter")
                                }
                            }
                        } else null,
                        singleLine = true,
                        modifier = Modifier.weight(1f).height(52.dp),
                    )
                    Box {
                        OutlinedButton(
                            onClick = { sortMenu = true },
                            modifier = Modifier.height(52.dp),
                            shape = RoundedCornerShape(3.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Sort, contentDescription = null)
                            Text(sort.shortLabel, modifier = Modifier.padding(start = 6.dp))
                        }
                        DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                            WordSort.entries.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option.label) },
                                    onClick = {
                                        sort = option
                                        onSortChange(option.key)
                                        sortMenu = false
                                    },
                                )
                            }
                        }
                    }
                }
            }
            if (error != null) {
                item {
                    Text(
                        error,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
            if (words.isEmpty()) {
                item {
                    Text(
                        "Select a word while reading. It will be saved here even when no definition is found.",
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            } else if (visibleWords.isEmpty()) {
                item {
                    Text(
                        "No words match “$query”.",
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
            items(visibleWords, key = VocabularyWord::key) { word ->
                val dismissState = rememberSwipeToDismissBoxState(
                    confirmValueChange = { value ->
                        if (value == SwipeToDismissBoxValue.EndToStart) {
                            pendingDelete = word
                            false
                        } else false
                    },
                    positionalThreshold = { distance -> distance * 0.75f },
                )
                SwipeToDismissBox(
                    state = dismissState,
                    enableDismissFromStartToEnd = false,
                    backgroundContent = {
                        Box(
                            modifier = Modifier.fillMaxSize()
                                .background(MaterialTheme.colorScheme.errorContainer)
                                .padding(end = 24.dp),
                            contentAlignment = Alignment.CenterEnd,
                        ) {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = "Remove word",
                                tint = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    },
                ) {
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { onOpenWord(word) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
                        Text(word.word, style = MaterialTheme.typography.titleLarge)
                        if (word.partOfSpeech.isNotBlank()) {
                            Text(
                                word.partOfSpeech,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.secondary,
                            )
                        }
                        Text(
                            word.definitions.takeIf(List<String>::isNotEmpty)?.joinToString("\n")
                                ?: "No definition found",
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (word.definitions.isEmpty()) MaterialTheme.colorScheme.secondary
                            else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        if (word.contextSentence.isNotBlank()) {
                            Text(
                                highlightedContext(word.contextSentence, word.word),
                                style = MaterialTheme.typography.bodySmall,
                                fontStyle = FontStyle.Italic,
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 7.dp),
                            )
                        }
                        Text(
                            "${word.bookTitle} · tap to return",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 7.dp),
                        )
                    }
                }
                }
            }
    }
    pendingDelete?.let { word ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Remove word?") },
            text = { Text("Remove “${word.word}” from your saved words?") },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("Cancel") }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDelete = null
                        if (shouldClearWordFilter(query, word.word)) query = ""
                        onDeleteWord(word)
                    },
                ) { Text("Remove") }
            },
        )
    }
}

internal fun shouldClearWordFilter(query: String, deletedWord: String): Boolean =
    query.trim().equals(deletedWord.trim(), ignoreCase = true)

private enum class WordSort(val key: String, val label: String, val shortLabel: String) {
    Recent("recent", "Recently seen", "Recent"),
    RecentlyAdded("added", "Recently added", "Added"),
    Alphabetical("alphabetical", "Alphabetical (A–Z)", "A–Z"),
    Book("book", "Book, then word", "Book"),
    MostSeen("count", "Most frequently seen", "Count"),
    FirstSaved("first", "First saved", "First"),
    ;

    companion object {
        fun fromKey(key: String): WordSort = entries.firstOrNull { it.key == key } ?: Recent
    }
}

private fun highlightedContext(context: String, word: String) = buildAnnotatedString {
    append('“')
    if (word.isBlank()) {
        append(context)
    } else {
        val lowerContext = context.lowercase()
        val lowerWord = word.lowercase()
        var cursor = 0
        while (cursor < context.length) {
            val match = lowerContext.indexOf(lowerWord, cursor)
            if (match < 0) {
                append(context.substring(cursor))
                break
            }
            append(context.substring(cursor, match))
            pushStyle(
                SpanStyle(
                    background = Color(0xFFE7C766),
                    color = Color(0xFF1C1916),
                    fontWeight = FontWeight.Bold,
                    fontStyle = FontStyle.Normal,
                ),
            )
            append(context.substring(match, match + word.length))
            pop()
            cursor = match + word.length
        }
    }
    append('”')
}
