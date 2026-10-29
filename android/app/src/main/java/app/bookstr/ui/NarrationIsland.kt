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
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Slider
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
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.bookstr.NarrationService
import app.bookstr.speech.SpeechSettings

private data class IslandState(
    val active: Boolean = false,
    val playing: Boolean = false,
    val preparing: Boolean = false,
    val title: String = "Bookstr",
    val author: String = "",
    val bookId: String = "",
    val language: String = "en",
    val rate: Float = SpeechSettings.DEFAULT_RATE,
    val message: String? = null,
)

/** App-wide compact playback controls. Mount once in MainActivity and over reader content. */
@Composable
fun NarrationIsland(
    modifier: Modifier = Modifier,
    onOpenBook: ((bookId: String, title: String, author: String) -> Unit)? = null,
    onSpeedChange: ((language: String, rate: Float) -> Unit)? = null,
) {
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
                    preparing = intent.getBooleanExtra(NarrationService.EXTRA_IS_PREPARING, false),
                    title = intent.getStringExtra(NarrationService.EXTRA_BOOK_TITLE)?.takeIf(String::isNotBlank) ?: "Bookstr",
                    author = intent.getStringExtra(NarrationService.EXTRA_BOOK_AUTHOR).orEmpty(),
                    bookId = intent.getStringExtra(NarrationService.EXTRA_BOOK_ID).orEmpty(),
                    language = intent.getStringExtra(NarrationService.EXTRA_LANGUAGE).orEmpty().ifBlank { "en" },
                    rate = intent.getFloatExtra(NarrationService.EXTRA_RATE, SpeechSettings.DEFAULT_RATE)
                        .coerceIn(SpeechSettings.MINIMUM_RATE, SpeechSettings.MAXIMUM_RATE),
                    message = intent.getStringExtra(NarrationService.EXTRA_MESSAGE),
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
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
              Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
              ) {
                Column(
                    Modifier.weight(1f)
                        .clickable(enabled = onOpenBook != null && state.bookId.isNotBlank()) {
                            onOpenBook?.invoke(state.bookId, state.title, state.author)
                        }
                        .testTag("narration.openBook")
                        .semantics {
                            contentDescription = if (onOpenBook != null) "Open ${state.title}" else state.title
                        },
                ) {
                    Text("READING ALOUD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Text(state.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    if (state.author.isNotBlank()) {
                        Text(state.author, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (state.preparing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp)
                            .testTag("narration.preparing")
                            .semantics {
                                contentDescription = "Preparing narration"
                                progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
                            },
                        strokeWidth = 2.dp,
                    )
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
              state.message?.takeIf(String::isNotBlank)?.let { message ->
                  Text(
                      message,
                      color = MaterialTheme.colorScheme.error,
                      style = MaterialTheme.typography.bodySmall,
                      modifier = Modifier.testTag("narration.error"),
                  )
              }
              Slider(
                  value = state.rate,
                  onValueChange = { rate ->
                      state = state.copy(rate = rate)
                      if (onSpeedChange != null) onSpeedChange(state.language, rate)
                      else NarrationService.setSpeechRate(context, state.language, rate)
                  },
                  valueRange = SpeechSettings.MINIMUM_RATE..SpeechSettings.MAXIMUM_RATE,
                  modifier = Modifier.fillMaxWidth().testTag("narration.speed")
                      .semantics {
                          contentDescription = "Reading speed"
                          progressBarRangeInfo = ProgressBarRangeInfo(state.rate, SpeechSettings.MINIMUM_RATE..SpeechSettings.MAXIMUM_RATE)
                      },
              )
            }
        }
    }
}
