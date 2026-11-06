package app.bookstr.data

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.io.InputStream

class LocalBookImportTest {
    @Test fun stagesBothFormatsWithStableContentIdentityAndSafeNames() {
        val root = Files.createTempDirectory("open-book-test").toFile()
        try {
            val bytes = "same content".toByteArray()
            for ((name, mime, format) in listOf(
                Triple("Book.PDF", null, BookFormat.Pdf),
                Triple("Book.epub", null, BookFormat.Epub),
                Triple("opaque", "application/pdf", BookFormat.Pdf),
                Triple("opaque", "application/epub+zip", BookFormat.Epub),
                Triple("Book.epub", "application/octet-stream", BookFormat.Epub),
            )) {
                val (book, file) = stageLocalBook(bytes.inputStream(), root, name, mime)
                assertEquals("793953ee398d864ec40252df9554c3e6", book.id)
                assertEquals(format, book.format)
                assertArrayEquals(bytes, file.readBytes())
                assertEquals(root.canonicalFile, file.parentFile!!.canonicalFile)
                assertEquals(name.substringBeforeLast('.'), book.title)
            }
        } finally { root.deleteRecursively() }
    }

    @Test fun rejectsUnsupportedFormatsAndCleansFailedCopies() {
        val root = Files.createTempDirectory("open-book-test").toFile()
        try {
            assertThrows(IllegalStateException::class.java) { stageLocalBook(byteArrayOf().inputStream(), root, "book.txt", null) }
            val broken = object : InputStream() { override fun read(): Int = throw java.io.IOException("read failed") }
            assertThrows(java.io.IOException::class.java) { stageLocalBook(broken, root, "book.pdf", null) }
            assertTrue(root.listFiles()!!.isEmpty())
        } finally { root.deleteRecursively() }
    }
}
