package app.bookstr.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.bookstr.data.BookCoverRepository
import app.bookstr.data.BookFormat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

@Composable
fun BookCover(id: String, format: BookFormat?, remote: String?) {
    val context = LocalContext.current.applicationContext
    val repository = remember(context) { BookCoverRepository(context.filesDir, File(context.cacheDir, "book-covers")) }
    val bitmap by produceState<android.graphics.Bitmap?>(null, id, format, remote) {
        value = null
        value = withContext(Dispatchers.IO) { repository.load(id, format, remote) }
    }
    Box(Modifier.size(42.dp, 62.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
        .testTag("cover.$id"), contentAlignment = Alignment.Center) {
        bitmap?.let { Image(it.asImageBitmap(), null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().testTag("cover.image.$id")) }
            ?: Icon(Icons.Default.Book, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
