package app.bookstr.data

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Stages a provider stream without retaining its temporary URI permission. */
internal fun stageLocalBook(input: InputStream, directory: File, name: String, mime: String?): Pair<CatalogBook, File> {
    val format = when (mime) {
        "application/pdf" -> BookFormat.Pdf
        "application/epub+zip" -> BookFormat.Epub
        else -> when (name.substringAfterLast('.', "").lowercase()) {
            "pdf" -> BookFormat.Pdf
            "epub" -> BookFormat.Epub
            else -> error("Unsupported publication")
        }
    }
    val staged = File.createTempFile("open-book-", ".${format.extension}", directory)
    try {
        val digest = MessageDigest.getInstance("MD5")
        java.security.DigestInputStream(input, digest).use { source -> staged.outputStream().use { source.copyTo(it) } }
        val id = digest.digest().joinToString("") { "%02x".format(it) }
        return CatalogBook(id = id, title = name.substringBeforeLast('.'), author = "",
            epubUrl = staged.toURI().toString(), coverUrl = null, format = format) to staged
    } catch (error: Exception) {
        staged.delete()
        throw error
    }
}
