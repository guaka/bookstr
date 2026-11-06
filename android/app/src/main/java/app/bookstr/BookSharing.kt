package app.bookstr

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import java.io.File

object BookSharing {
    fun share(context: Context, book: CatalogBook, publication: File): String? = try {
        context.startActivity(chooser(context, book, publication))
        null
    } catch (e: Exception) {
        e.message ?: "Could not share this book"
    }

    fun chooser(context: Context, book: CatalogBook, publication: File): Intent {
        require(publication.isFile) { "Download this book before sharing it" }
        val uri = FileProvider.getUriForFile(
            context, "${context.packageName}.books", publication,
            book.title.replace(Regex("[\\p{Cntrl}/\\\\]"), "_").take(120) + ".${book.format.extension}",
        )
        val send = Intent(Intent.ACTION_SEND).apply {
            type = when (book.format) {
                BookFormat.Epub -> "application/epub+zip"
                BookFormat.Pdf -> "application/pdf"
                BookFormat.Fb2 -> "application/x-fictionbook+xml"
                BookFormat.Cbr -> "application/vnd.comicbook-rar"
                BookFormat.Cbz -> "application/vnd.comicbook+zip"
            }
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, book.title)
            clipData = ClipData.newUri(context.contentResolver, book.title, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        return Intent.createChooser(send, null)
    }
}
