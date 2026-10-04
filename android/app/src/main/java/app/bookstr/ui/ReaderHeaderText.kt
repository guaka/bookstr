package app.bookstr.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ReaderHeaderText(
    title: String,
    author: String?,
    year: String?,
    onAuthorClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 11.sp, color = MaterialTheme.colorScheme.onPrimary,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        author?.trim()?.takeIf(String::isNotBlank)?.let { name ->
            Text(" — $name", fontSize = 11.sp, color = MaterialTheme.colorScheme.onPrimary,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 180.dp).testTag("reader.author").clickable { onAuthorClick(name) })
        }
        year?.trim()?.takeIf(String::isNotBlank)?.let {
            Text(" · $it", fontSize = 11.sp, color = MaterialTheme.colorScheme.onPrimary)
        }
    }
}
