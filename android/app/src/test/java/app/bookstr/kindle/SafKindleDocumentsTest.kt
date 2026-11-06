package app.bookstr.kindle

import android.app.Application
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.RealObject
import org.robolectric.shadows.ShadowContentResolver
import java.io.File
import java.io.FileNotFoundException

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28], shadows = [ModernDocumentsProviderQuery::class])
class SafKindleDocumentsTest {
    private class Provider : DocumentsProvider() {
        val documents = linkedMapOf("book" to File.createTempFile("bookstr", ".pdf").apply { writeText("book data") })
        val names = mutableMapOf("book" to "existing.pdf")
        val directories = mutableSetOf("folder")
        var validRoot = true
        var failWrites = false
        var reads = 0
        var createdMimeType: String? = null
        private var nextId = 0

        override fun onCreate() = true
        override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean =
            parentDocumentId == "root" && (documentId in documents || documentId in directories)
        override fun queryRoots(projection: Array<out String>?): Cursor = MatrixCursor(projection ?: emptyArray())
        override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
            val cols = projection ?: emptyArray()
            val cursor = MatrixCursor(cols)
            val isRoot = documentId == "root"
            cursor.newRow().also { row -> cols.forEach { column ->
                row.add(when (column) {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID -> documentId
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME -> if (isRoot && validRoot) "documents" else if (isRoot) "Books" else names[documentId] ?: documentId
                    DocumentsContract.Document.COLUMN_MIME_TYPE -> if (isRoot || documentId in directories) DocumentsContract.Document.MIME_TYPE_DIR else "application/pdf"
                    DocumentsContract.Document.COLUMN_SIZE -> documents[documentId]?.length()
                    else -> null
                })
            } }
            return cursor
        }

        override fun queryChildDocuments(parentDocumentId: String, projection: Array<out String>?, sortOrder: String?): Cursor {
            val cols = projection ?: emptyArray()
            val cursor = MatrixCursor(cols)
            for ((id, file) in documents) cursor.newRow().also { row -> cols.forEach { column -> row.add(when (column) {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID -> id
                DocumentsContract.Document.COLUMN_DISPLAY_NAME -> names[id]
                DocumentsContract.Document.COLUMN_SIZE -> file.length()
                DocumentsContract.Document.COLUMN_MIME_TYPE -> "application/pdf"
                else -> null
            }) } }
            for (id in directories) cursor.newRow().also { row -> cols.forEach { column -> row.add(when (column) {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID -> id
                DocumentsContract.Document.COLUMN_DISPLAY_NAME -> id
                DocumentsContract.Document.COLUMN_SIZE -> null
                DocumentsContract.Document.COLUMN_MIME_TYPE -> DocumentsContract.Document.MIME_TYPE_DIR
                else -> null
            }) } }
            return cursor
        }

        override fun openDocument(documentId: String, mode: String, signal: CancellationSignal?): ParcelFileDescriptor {
            if (!mode.contains("w")) reads++
            val file = documents[documentId] ?: throw FileNotFoundException(documentId)
            if (mode.contains("w") && failWrites) throw FileNotFoundException("write disconnected")
            val flags = if (mode.contains("w")) ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_TRUNCATE
                else ParcelFileDescriptor.MODE_READ_ONLY
            return ParcelFileDescriptor.open(file, flags)
        }

        override fun createDocument(parentDocumentId: String, mimeType: String, displayName: String): String {
            createdMimeType = mimeType
            val id = "created-${nextId++}"
            val file = File.createTempFile("created", ".tmp").apply { delete(); createNewFile() }
            documents[id] = file
            names[id] = displayName
            return id
        }
        override fun deleteDocument(documentId: String) {
            names.remove(documentId)
            documents.remove(documentId)?.delete()
        }
    }

    private fun documents(provider: Provider): SafKindleDocuments {
        provider.attachInfo(RuntimeEnvironment.getApplication(), ProviderInfo().apply {
            authority = "kindle-test"
            exported = true
            grantUriPermissions = true
            readPermission = "android.permission.MANAGE_DOCUMENTS"
            writePermission = "android.permission.MANAGE_DOCUMENTS"
        })
        ShadowContentResolver.registerProviderInternal("kindle-test", provider)
        val tree = DocumentsContract.buildTreeDocumentUri("kindle-test", "root")
        return SafKindleDocuments(RuntimeEnvironment.getApplication().contentResolver, tree)
    }

    @Test fun listsFilesAndHashesOnlyNonDirectories() {
        val provider = Provider()
        try {
            val target = documents(provider)
            assertEquals("Kindle", target.name)
            assertNull(target.freeBytes())
            val files = target.files()
            assertEquals(1, files.size)
            assertEquals(0, provider.reads)
            assertEquals("existing.pdf", files.single().name)
            assertEquals(9L, files.single().size)
            assertEquals(sha256(provider.documents.getValue("book")), files.single().hash())
            assertEquals(1, provider.reads)
        } finally { provider.documents.values.forEach(File::delete) }
    }

    @Test fun rejectsSelectedFolderThatIsNotDocuments() {
        val provider = Provider().apply { validRoot = false }
        try {
            assertThrows(IllegalArgumentException::class.java) { documents(provider) }
        } finally { provider.documents.values.forEach(File::delete) }
    }

    @Test fun copiesAndVerifiesNewDocumentsWithoutOverwritingExistingNames() {
        val provider = Provider()
        val target = documents(provider)
        val source = File.createTempFile("source", ".pdf").apply { writeText("new book") }
        try {
            val book = KindleBook("new", "New", "Author", source, "pdf")
            target.copy(book, "new-book.pdf")
            assertEquals("application/pdf", provider.createdMimeType)
            val copied = target.files().single { it.name == "new-book.pdf" }
            assertEquals(source.length(), copied.size)
            assertEquals(sha256(source), copied.hash())
            assertThrows(IllegalStateException::class.java) { target.copy(book, "new-book.pdf") }
            assertEquals(2, provider.documents.size)
        } finally {
            source.delete()
            provider.documents.values.forEach(File::delete)
        }
    }

    @Test fun removesNewDocumentWhenWritingFails() {
        val provider = Provider().apply { failWrites = true }
        val target = documents(provider)
        val source = File.createTempFile("source", ".txt").apply { writeText("text") }
        try {
            val book = KindleBook("new", "New", "Author", source, "txt")
            assertThrows(FileNotFoundException::class.java) { target.copy(book, "new-book.txt") }
            assertEquals("text/plain", provider.createdMimeType)
            assertEquals(listOf("existing.pdf"), target.files().map { it.name })
        } finally {
            source.delete()
            provider.documents.values.forEach(File::delete)
        }
    }
}

/** Robolectric routes the legacy query overload directly; Android uses the Bundle overload. */
@Implements(DocumentsProvider::class)
class ModernDocumentsProviderQuery : org.robolectric.shadows.ShadowContentProvider() {
    @RealObject lateinit var provider: DocumentsProvider

    @Implementation
    fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? =
        provider.query(uri, projection, Bundle(), null)
}
