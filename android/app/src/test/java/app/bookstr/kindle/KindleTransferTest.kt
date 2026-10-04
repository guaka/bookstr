package app.bookstr.kindle

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

class KindleTransferTest {
    private class FixtureTarget : KindleDocuments {
        override val name = "Kindle"
        val remote = mutableMapOf<String, ByteArray>()
        var capacity: Long? = null
        var fail = false
        override fun files() = remote.map { (name, bytes) -> KindleFile(name, bytes.size.toLong()) {
            digest(bytes.inputStream())
        } }
        override fun freeBytes() = capacity
        override fun copy(book: KindleBook, name: String) {
            check(!remote.containsKey(name))
            if (fail) error("Kindle disconnected")
            remote[name] = book.file.readBytes()
        }
    }

    @Test fun singleAndBulkTransferSkipHashesAndNeverOverwrite() {
        val root = Files.createTempDirectory("kindle-transfer").toFile()
        try {
            val first = File(root, "first.pdf").apply { writeText("first PDF") }
            val second = File(root, "second.pdf").apply { writeText("second PDF") }
            val epub = File(root, "other.epub").apply { writeText("EPUB") }
            val books = listOf(KindleBook("first", "First", "Author", first, "pdf"),
                KindleBook("second", "Second", "Author", second, "pdf"),
                KindleBook("epub", "Other", "Author", epub, "epub"))
            val target = FixtureTarget().apply { remote["renamed.pdf"] = first.readBytes() }
            val sync = KindleTransfer { books }
            assertEquals(1, sync.preview(target, "first").alreadyPresent)
            assertEquals(listOf("second"), sync.preview(target).missing.map { it.id })
            assertEquals(1, sync.preview(target).skipped.size)
            assertEquals(listOf("second"), sync.transfer(target, "second").copied)
            assertEquals(1, sync.transfer(target, "second").alreadyPresent)
            assertEquals(0, sync.transfer(target).copied.size)
            assertArrayEquals(first.readBytes(), target.remote["renamed.pdf"])
            assertThrows(IllegalStateException::class.java) { sync.preview(target, "epub") }
            assertThrows(IllegalStateException::class.java) { sync.preview(target, "unknown") }
        } finally { root.deleteRecursively() }
    }

    @Test fun lowSpaceAndDisconnectAreReportedWithoutReplacingFiles() {
        val root = Files.createTempDirectory("kindle-failure").toFile()
        try {
            val file = File(root, "book.pdf").apply { writeText("PDF bytes") }
            val book = KindleBook("book", "Book", "Author", file, "pdf")
            val sync = KindleTransfer { listOf(book) }
            val target = FixtureTarget().apply { capacity = 1 }
            assertTrue(sync.transfer(target, "book").errors.single().contains("out of space"))
            assertTrue(target.remote.isEmpty())
            target.capacity = null
            target.fail = true
            assertTrue(sync.transfer(target, "book").errors.single().contains("disconnected"))
            assertTrue(target.remote.isEmpty())
        } finally { root.deleteRecursively() }
    }
}
