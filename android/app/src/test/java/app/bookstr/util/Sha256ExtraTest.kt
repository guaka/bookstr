package app.bookstr.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class Sha256ExtraTest {
    private fun tempFile(suffix: String = ".txt"): File = File.createTempFile("bookstr-sha256-", suffix).apply {
        deleteOnExit()
    }

    @Test
    fun hashesEmptyFile() {
        val file = tempFile(".empty")
        file.writeText("")
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            Sha256.hash(file),
        )
    }

    @Test
    fun hashesTextFileUsingStreamingHasher() {
        val file = tempFile(".txt")
        file.writeText("hello")
        assertEquals("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", Sha256.hash(file))
    }

    @Test
    fun hashesBinaryFileFromBytes() {
        val file = tempFile(".bin")
        file.writeBytes(byteArrayOf(0, 1, 2, 127, -128, -1))
        assertEquals("da2cb6ad175bc966de5e79c6e16777f8a98b610c2424a894132df2815be50677", Sha256.hash(file))
    }
}
