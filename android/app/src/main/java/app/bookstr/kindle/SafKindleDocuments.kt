package app.bookstr.kindle

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract

class SafKindleDocuments(private val resolver: ContentResolver, private val tree: Uri) : KindleDocuments {
    override val name = "Kindle"
    private val document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

    init {
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
        resolver.query(document, columns, null, null, null).use { cursor ->
            require(cursor != null && cursor.moveToFirst() &&
                cursor.getString(0).equals("documents", ignoreCase = true) &&
                cursor.getString(1) == DocumentsContract.Document.MIME_TYPE_DIR) {
                "Select the Kindle documents folder."
            }
        }
    }

    override fun files(): List<KindleFile> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(document))
        val columns = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_MIME_TYPE)
        val result = mutableListOf<KindleFile>()
        resolver.query(uri, columns, null, null, null).use { cursor ->
            checkNotNull(cursor) { "Kindle is disconnected." }
            while (cursor.moveToNext()) {
                if (cursor.getString(3) == DocumentsContract.Document.MIME_TYPE_DIR) continue
                val child = DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0))
                val size = if (cursor.isNull(2)) -1L else cursor.getLong(2)
                result += KindleFile(cursor.getString(1), size) {
                    checkNotNull(resolver.openInputStream(child)) { "Kindle is disconnected." }.use(::digest)
                }
            }
        }
        return result
    }

    override fun freeBytes(): Long? = null // The SAF provider does not expose reliable capacity.

    override fun copy(book: KindleBook, name: String) {
        check(files().none { it.name == name }) { "A Kindle file already has this name." }
        val type = if (book.extension == "pdf") "application/pdf" else "text/plain"
        val target = checkNotNull(DocumentsContract.createDocument(resolver, document, type, name)) { "Kindle cannot create a file." }
        checkNotNull(resolver.openOutputStream(target, "w")) { "Kindle is disconnected." }.use { output ->
            book.file.inputStream().use { it.copyTo(output) }
        }
        val remote = checkNotNull(resolver.openInputStream(target)) { "Kindle is disconnected." }.use(::digest)
        check(remote == sha256(book.file)) { "Kindle copy verification failed." }
    }
}
