package app.bookstr.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import app.bookstr.data.BookListFilters
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.bookstr.download.DownloadJob

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsSheet(jobs: List<DownloadJob>, onDismiss: () -> Unit, onAction: (String, String) -> Unit, onOpen: (DownloadJob) -> Unit,
                   onSendToKindle: (DownloadJob) -> Unit = {}) {
    var language by rememberSaveable { mutableStateOf("") }
    var format by rememberSaveable { mutableStateOf("") }
    val languages = BookListFilters.languages(jobs.map { it.book.language })
    val formats = BookListFilters.formats(jobs.map { it.book.format.extension })
    val filters = BookListFilters(language, format).sanitize(languages, formats)
    LaunchedEffect(filters) { language = filters.language; format = filters.format }
    val visible = jobs.filter { filters.matches(it.book.language, it.book.format.extension) }
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.testTag("downloads.sheet")) {
        LazyColumn(Modifier.fillMaxWidth().padding(16.dp)) {
            item { Text("Downloads", style = MaterialTheme.typography.titleLarge) }
            item { BookFilterBar("downloads", languages, formats, filters.language, filters.format,
                { language = it }, { format = it }) }
            items(visible, key = { it.book.id }) { job ->
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)
                    .testTag("download.${job.book.id}")
                    .clickable(enabled = job.state == "complete") { onOpen(job) }) {
                    Text(job.book.title)
                    Text(job.error ?: job.state, style = MaterialTheme.typography.bodySmall)
                    if (job.size > 0) LinearProgressIndicator(progress = { (job.bytes.toFloat() / job.size).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                    Row {
                        if (job.state == "complete") {
                            TextButton(onClick = { onOpen(job) }, modifier = Modifier.testTag("download.open.${job.book.id}")) { Text("Read") }
                            if (job.book.format.extension == "pdf") TextButton(onClick = { onSendToKindle(job) },
                                modifier = Modifier.testTag("download.kindle.${job.book.id}")) { Text("Send to Kindle") }
                        } else {
                            val action = if (job.active) "pause" else "resume"
                            TextButton(onClick = { onAction(action, job.book.id) }, modifier = Modifier.testTag("download.$action.${job.book.id}")) { Text(if (job.active) "Pause" else "Resume") }
                            if (job.state != "cancelled") TextButton(onClick = { onAction("cancel", job.book.id) }, modifier = Modifier.testTag("download.cancel.${job.book.id}")) { Text("Cancel") }
                        }
                    }
                }
            }
        }
    }
}
