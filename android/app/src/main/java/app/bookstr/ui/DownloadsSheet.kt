package app.bookstr.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.bookstr.download.DownloadJob

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsSheet(jobs: List<DownloadJob>, onDismiss: () -> Unit, onAction: (String, String) -> Unit, onOpen: (DownloadJob) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.testTag("downloads.sheet")) {
        LazyColumn(Modifier.fillMaxWidth().padding(16.dp)) {
            item { Text("Downloads", style = MaterialTheme.typography.titleLarge) }
            items(jobs, key = { it.book.id }) { job ->
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("download.${job.book.id}")) {
                    Text(job.book.title)
                    Text(job.error ?: job.state, style = MaterialTheme.typography.bodySmall)
                    if (job.size > 0) LinearProgressIndicator(progress = { (job.bytes.toFloat() / job.size).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                    Row {
                        if (job.state == "complete") TextButton(onClick = { onOpen(job) }, modifier = Modifier.testTag("download.open.${job.book.id}")) { Text("Read") }
                        else {
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
