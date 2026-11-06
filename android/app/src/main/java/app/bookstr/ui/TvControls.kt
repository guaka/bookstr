package app.bookstr.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.bookstr.isTelevision

/** Outline the same focus target used by Compose's D-pad traversal. */
internal fun Modifier.tvFocus(): Modifier = composed {
    if (!isTelevision(LocalConfiguration.current.uiMode)) return@composed this
    var focused by remember { mutableStateOf(false) }
    this.onFocusChanged { focused = it.isFocused }.border(
        if (focused) 3.dp else 0.dp,
        if (focused) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent,
        MaterialTheme.shapes.small,
    )
}

/** Keep publication content above the persistent remote controls. */
internal fun Modifier.tvReaderInset(): Modifier = composed {
    if (isTelevision(LocalConfiguration.current.uiMode)) padding(bottom = 112.dp) else this
}

@Composable
internal fun TvReaderControls(
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onLibrary: () -> Unit,
    onSpeech: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val initialFocus = remember { FocusRequester() }
    Surface(modifier.padding(24.dp), shape = MaterialTheme.shapes.medium) {
        Row(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilledTonalIconButton(onPrevious, Modifier.testTag("tv.reader.previous").tvFocus()) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Previous page")
            }
            FilledTonalIconButton(onNext, Modifier.testTag("tv.reader.next").focusRequester(initialFocus).tvFocus()) {
                Icon(Icons.AutoMirrored.Filled.ArrowForward, "Next page")
            }
            if (onSpeech != null) {
                FilledTonalIconButton(onSpeech, Modifier.testTag("tv.reader.speech").tvFocus()) {
                    Icon(Icons.Default.RecordVoiceOver, "Speech")
                }
            }
            FilledTonalIconButton(onLibrary, Modifier.testTag("tv.reader.library").tvFocus()) {
                Icon(Icons.Default.Book, "Library")
            }
        }
    }
    LaunchedEffect(Unit) { initialFocus.requestFocus() }
}
