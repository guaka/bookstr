package app.bookstr.download

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.TorrentEdition
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class NativeTorrentEngineEdgeCoverageTest {
    private val cacheDir: File
        get() = ApplicationProvider.getApplicationContext<Context>().cacheDir

    private fun md5(bytes: ByteArray): String = digest("MD5", bytes).hex()
    private fun sha1(bytes: ByteArray): ByteArray = digest("SHA-1", bytes)
    private fun digest(algorithm: String, bytes: ByteArray): ByteArray = MessageDigest.getInstance(algorithm).digest(bytes)
    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }

    private fun bencode(value: Any): ByteArray = when (value) {
        is ByteArray -> "${value.size}:".toByteArray() + value
        is String -> bencode(value.toByteArray())
        is Number -> "i${value}e".toByteArray()
        is List<*> -> "l".toByteArray() + value.fold(byteArrayOf()) { bytes, item -> bytes + bencode(item!!) } + "e".toByteArray()
        is Map<*, *> -> "d".toByteArray() + value.entries.sortedBy { it.key.toString() }
            .fold(byteArrayOf()) { bytes, entry -> bytes + bencode(entry.key!!) + bencode(entry.value!!) } + "e".toByteArray()
        else -> error("Unsupported bencode fixture: ${value::class.java.name}")
    }

    private fun singleFile(name: String, content: ByteArray, pieceLength: Int = 16_384): ByteArray {
        val pieces = if (content.isEmpty()) byteArrayOf() else sha1(content)
        return bencode(mapOf("info" to mapOf(
            "name" to name,
            "piece length" to pieceLength,
            "length" to content.size,
            "pieces" to pieces,
            "private" to 1,
        )))
    }

    private fun edition(content: ByteArray, filename: String? = null, hash: String = md5(content), size: Long? = content.size.toLong()) =
        TorrentEdition(hash, 1, "fiction", size, filename)

    private fun newRoot(label: String): File = File(cacheDir, "torrent-edge-$label-${System.nanoTime()}").also { it.mkdirs() }

    private fun assertCreateFails(
        root: File,
        metadata: ByteArray,
        torrentEdition: TorrentEdition,
        expected: String,
    ) {
        try {
            val error = assertThrows(IllegalStateException::class.java) {
                NativeTorrentEngine().use { it.start(root, metadata, torrentEdition) }
            }
            assertTrue("Unexpected native error: ${error.message}", error.message.orEmpty().contains(expected))
            assertTrue("Rejected metadata must not create a payload", !File(root, "payload").exists())
        } finally {
            root.deleteRecursively()
        }
    }

    @Test
    fun exactSelectedFilenameStartsWhileAbsentOrMalformedSelectionsFail() {
        val content = "selected torrent edition".toByteArray()
        val matching = newRoot("selected-match")
        try {
            NativeTorrentEngine().use { engine ->
                engine.start(matching, singleFile("123", content), edition(content, filename = "123"))
                assertNotNull(engine.poll())
            }
        } finally {
            matching.deleteRecursively()
        }

        assertCreateFails(newRoot("selected-absent"), singleFile("123", content), edition(content, filename = "456"), "Edition absent")
        assertCreateFails(newRoot("selected-nondigit"), singleFile("123", content), edition(content, filename = "12x"), "Invalid edition filename")
        assertCreateFails(newRoot("selected-too-long"), singleFile("123", content), edition(content, filename = "1".repeat(17)), "Invalid edition filename")
    }

    @Test
    fun malformedMd5LengthAndCharactersFailBeforeTorrentParsing() {
        val content = "metadata validation".toByteArray()
        val metadata = singleFile("${md5(content)}.pdf", content)
        assertCreateFails(newRoot("short-hash"), metadata, edition(content, hash = "abc"), "Invalid torrent metadata")
        assertCreateFails(newRoot("nonhex-hash"), metadata, edition(content, hash = "g".repeat(32)), "Invalid torrent metadata")
    }

    @Test
    fun repeatedMatchingBasenamesAreRejectedAsAmbiguous() {
        val first = "first duplicate".toByteArray()
        val second = "second duplicate".toByteArray()
        val hash = md5(first + second)
        val metadata = bencode(mapOf("info" to mapOf(
            "name" to "bundle",
            "piece length" to 16_384,
            "files" to listOf(
                mapOf("length" to first.size, "path" to listOf("one", "$hash.pdf")),
                mapOf("length" to second.size, "path" to listOf("two", "$hash.pdf")),
            ),
            "pieces" to sha1(first + second),
            "private" to 1,
        )))
        assertCreateFails(newRoot("ambiguous"), metadata, TorrentEdition(hash, 1, "fiction", (first.size + second.size).toLong()), "Ambiguous edition")
    }

    @Test
    fun untrustedTorrentPathComponentsStayWithinPayloadRootOrAreRejected() {
        val content = "unsafe path".toByteArray()
        val hash = md5(content)
        val unsafePaths = listOf(
            listOf("..", "$hash.pdf"),
            listOf(".", "$hash.pdf"),
            listOf("/absolute", "$hash.pdf"),
            listOf("back\\slash", "$hash.pdf"),
            listOf("drive:component", "$hash.pdf"),
        )
        unsafePaths.forEachIndexed { index, path ->
            val metadata = bencode(mapOf("info" to mapOf(
                "name" to "bundle",
                "piece length" to 16_384,
                "files" to listOf(mapOf("length" to content.size, "path" to path)),
                "pieces" to sha1(content),
                "private" to 1,
            )))
            val sandbox = newRoot("unsafe-$index")
            val root = File(sandbox, "download").also { it.mkdirs() }
            try {
                NativeTorrentEngine().use { engine ->
                    try {
                        engine.start(root, metadata, TorrentEdition(hash, 1, "fiction", content.size.toLong()))
                        val snapshot = engine.poll()
                        assertTrue(
                            "Torrent output must stay at the local payload path",
                            File(snapshot.path).canonicalPath == File(root, "payload").canonicalPath,
                        )
                    } catch (error: IllegalStateException) {
                        val reason = error.message.orEmpty()
                        assertTrue(
                            "Unexpected rejection for sanitized metainfo path: $reason",
                            reason.contains("Unsafe torrent path") ||
                                reason.contains("Edition absent from torrent") ||
                                reason.contains("invalid length of torrent"),
                        )
                    }
                }
                val coverageProfile = File(sandbox, "bookstr-native-coverage-${android.os.Process.myPid()}.profraw")
                assertTrue(
                    "Untrusted metainfo must not create sibling files outside its download root",
                    sandbox.listFiles().orEmpty().all {
                        it.canonicalFile == root.canonicalFile ||
                            (it.isFile && it.canonicalFile == coverageProfile.canonicalFile)
                    },
                )
            } finally {
                sandbox.deleteRecursively()
            }
        }
    }

    @Test
    fun zeroLengthAndOverEightGibEditionsAreRejectedFromMetadataOnly() {
        val sibling = "valid piece".toByteArray()
        val emptyHash = md5(byteArrayOf())
        val zeroLengthMetadata = bencode(mapOf("info" to mapOf(
            "name" to "bundle",
            "piece length" to 16_384,
            "files" to listOf(
                mapOf("length" to 0, "path" to listOf("$emptyHash.pdf")),
                mapOf("length" to sibling.size, "path" to listOf("sibling.bin")),
            ),
            "pieces" to sha1(sibling),
            "private" to 1,
        )))
        assertCreateFails(
            newRoot("empty-edition"), zeroLengthMetadata,
            TorrentEdition(emptyHash, 1, "fiction", 0), "Unsupported edition size",
        )

        val pieceLength = 16 * 1024 * 1024
        val fileSize = 8L * 1024 * 1024 * 1024 + 1
        val pieceCount = ((fileSize + pieceLength - 1) / pieceLength).toInt()
        val metadata = bencode(mapOf("info" to mapOf(
            "name" to "${"a".repeat(32)}.pdf",
            "piece length" to pieceLength,
            "length" to fileSize,
            "pieces" to ByteArray(pieceCount * 20),
            "private" to 1,
        )))
        assertCreateFails(
            newRoot("oversized-edition"),
            metadata,
            TorrentEdition("a".repeat(32), 1, "fiction", fileSize),
            "Unsupported edition size",
        )
    }

    @Test
    fun corruptAndMismatchedResumeFilesAreIgnored() {
        val root = newRoot("corrupt-resume")
        try {
            File(root, "resume.dat").writeBytes("not resume data".toByteArray())
            val firstContent = "resume fixture one".toByteArray()
            NativeTorrentEngine().use { engine ->
                engine.start(root, singleFile("${md5(firstContent)}.pdf", firstContent), edition(firstContent))
                assertNotNull(engine.poll())
            }
            assertTrue(File(root, "resume.dat").length() > 0)

            val secondContent = "resume fixture two".toByteArray()
            NativeTorrentEngine().use { engine ->
                engine.start(root, singleFile("${md5(secondContent)}.pdf", secondContent), edition(secondContent))
                assertNotNull(engine.poll())
            }
        } finally {
            root.deleteRecursively()
        }
    }
}
