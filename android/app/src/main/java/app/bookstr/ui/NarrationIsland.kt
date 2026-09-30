package app.bookstr.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.bookstr.NarrationService

private data class IslandState(
    val active: Boolean = false,
    val playing: Boolean = false,
    val title: String = "Bookstr",
    val author: String = "",
)

/** App-wide compact playback controls. Mount once in MainActivity and over reader content. */
@Composable
fun NarrationIsland(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var state by remember { mutableStateOf(IslandState()) }

    DisposableEffect(context, lifecycleOwner) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != NarrationService.ACTION_EVENT) return
                state = IslandState(
                    active = intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false),
                    playing = intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false),
                    title = intent.getStringExtra(NarrationService.EXTRA_BOOK_TITLE)?.takeIf(String::isNotBlank) ?: "Bookstr",
                    author = intent.getStringExtra(NarrationService.EXTRA_BOOK_AUTHOR).orEmpty(),
                )
            }
        }
        val filter = IntentFilter(NarrationService.ACTION_EVENT)
        var registered = false
        fun registerAndSync() {
            if (!registered) {
                ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
                registered = true
            }
            NarrationService.sync(context)
        }
        fun unregister() {
            if (registered) {
                runCatching { context.unregisterReceiver(receiver) }
                registered = false
            }
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> registerAndSync()
                Lifecycle.Event.ON_PAUSE -> unregister()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            registerAndSync()
        }
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            unregister()
        }
    }

    if (state.active) {
        Surface(
            modifier = modifier.widthIn(max = 480.dp).fillMaxWidth().testTag("narration.island"),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            tonalElevation = 6.dp,
            shadowElevation = 6.dp,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f)) {
                    Text("READING ALOUD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    if (state.author.isNotBlank()) {
                        Text(state.author, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    }
                }
                IconButton(onClick = { NarrationService.togglePlayback(context) }, modifier = Modifier.testTag("narration.toggle")) {
                    Icon(
                        if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = if (state.playing) "Pause narration" else "Resume narration",
                        modifier = Modifier.size(24.dp),
                    )
                }
                IconButton(onClick = { NarrationService.stop(context) }, modifier = Modifier.testTag("narration.stop")) {
                    Icon(Icons.Default.Close, contentDescription = "Stop narration")
                }
            }
        }
    }
}
