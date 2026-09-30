package app.bookstr.ui

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Spellcheck
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.bookstr.navigationSizes

private data class NavigationTab(val id: Int, val label: String, val icon: ImageVector)

private val tabs = listOf(
    NavigationTab(0, "Library", Icons.Default.Book),
    NavigationTab(3, "Search", Icons.Default.Search),
    NavigationTab(1, "Words", Icons.Default.Spellcheck),
    NavigationTab(2, "Settings", Icons.Default.Settings),
)

@Composable
internal fun BookstrNavigationBar(selectedTab: Int, onSelectTab: (Int) -> Unit) {
    val (iconSize, barHeight) = navigationSizes(LocalConfiguration.current.smallestScreenWidthDp)
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides 40.dp) {
        NavigationBar(
            modifier = Modifier.height(barHeight).testTag("navigation.bar"),
            windowInsets = WindowInsets(0, 0, 0, 0),
        ) {
            tabs.forEach { tab ->
                NavigationBarItem(
                    selected = selectedTab == tab.id,
                    onClick = { onSelectTab(tab.id) },
                    modifier = Modifier.testTag("tab.${tab.label.lowercase()}"),
                    icon = {
                        Icon(tab.icon, contentDescription = tab.label, modifier = Modifier.size(iconSize))
                    },
                )
            }
        }
    }
}
