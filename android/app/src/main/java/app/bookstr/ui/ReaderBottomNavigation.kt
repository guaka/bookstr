package app.bookstr.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** A quiet bottom touch target brings the four app destinations back while reading. */
@Composable
fun ReaderBottomNavigation(onSelectTab: (Int) -> Unit, modifier: Modifier = Modifier) {
    var visible by remember { mutableStateOf(false) }
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
        if (visible) {
            BookstrNavigationBar(selectedTab = -1, onSelectTab = onSelectTab)
        } else {
            Box(Modifier.fillMaxWidth().height(48.dp)
                .testTag("reader.show-navigation")
                .clickable { visible = true })
        }
    }
}
