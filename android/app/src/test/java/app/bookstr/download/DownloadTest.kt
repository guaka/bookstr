package app.bookstr.download

import app.bookstr.data.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class DownloadTest {
    @get:Rule val folder = TemporaryFolder()
    private val content = "%PDF-1.4\nBookstr fixture\n%%EOF".toByteArray()
    private val hash = MessageDigest.getInstance("MD5").digest(content).joinToString("") { "%02x".format(it) }
    private val book get() = CatalogBook(hash, "Fixture", "Bookstr", "", null, libvaultMd5 = hash, format = BookFormat.Pdf)
    private val edition get() = TorrentEdition(hash, 42, "fiction", content.size.toLong())
    private class Engine(val root: File, val content: ByteArray, val states: List<String> = listOf("downloading", "ready"), val fail: Boolean = false) : TorrentEngine {
        var closed = false; var polls = 0
        override fun start(root: File, metadata: ByteArray, edition: TorrentEdition) {
            if (fail) error("absent edition")
            File(root, "payload").writeBytes(content)
        }
        override fun poll() = TorrentSnapshot(states[(polls++).coerceAtMost(states.lastIndex)], content.size.toLong(), content.size.toLong(), File(root, "payload").path, "disk failure")
        override fun close() { closed = true }
    }
    @Test fun journalPreservesJobsAndPartialFilesAcrossRelaunchAndDeduplicates() {
        val root = folder.newFolder()
        val store = DownloadStore(root)
        store.enqueue(book, edition); store.enqueue(book, edition)
        assertEquals(1, store.jobs.value.size)
        File(store.root(hash), "partial").writeText("keep")
        val job = store.find(hash)!!
        store.update(job.copy(state = "downloading", bytes = 10))
        val restored = DownloadStore(root)
        assertEquals("queued", restored.find(hash)?.state)
        assertEquals(10L, restored.find(hash)?.bytes)
        assertEquals("keep", File(restored.root(hash), "partial").readText())
        for (state in listOf("paused", "cancelled", "failed", "complete")) {
            restored.update(job.copy(state = state, error = "reason"))
            assertEquals(state, DownloadStore(root).find(hash)?.state)
        }
        restored.enqueue(book, edition)
        assertEquals("complete", restored.find(hash)?.state)
        restored.update(job.copy(state = "cancelled")); restored.enqueue(book, edition)
        assertEquals("queued", restored.find(hash)?.state)
        assertNull(restored.find(hash)?.error)
        assertThrows(IllegalArgumentException::class.java) { restored.root("../escape") }
        assertThrows(IllegalArgumentException::class.java) { restored.enqueue(book.copy(id = "bad"), edition) }
        assertEquals(job, DownloadJob.parse(job.json()))
    }
    @Test fun journalRecoversBackupButDoesNotDiscardCorruption() {
        val root = folder.newFolder(); val store = DownloadStore(root); store.enqueue(book, edition)
        assertTrue(File(root, "jobs.json").renameTo(File(root, "jobs.bak")))
        assertEquals(1, DownloadStore(root).jobs.value.size)
        File(root, "jobs.json").writeText("broken")
        assertThrows(Exception::class.java) { DownloadStore(root) }
        assertEquals("broken", File(root, "jobs.json").readText())
    }
    @Test fun downloadsVerifiesAndImportsOnlyAfterClosingEngine() = runBlocking<Unit> {
        val root = folder.newFolder(); val engine = Engine(root, content)
        val states = mutableListOf<String>(); var imported = false
        val runner = DownloadRunner({ engine }, { byteArrayOf(1) }, 1)
        runner.run(DownloadJob(book, edition), root, { states += it.state }) { b, file ->
            assertEquals(book, b); assertTrue(engine.closed); assertArrayEquals(content, file.readBytes()); imported = true
        }
        assertTrue(imported); assertEquals(listOf("verifying", "complete"), states)
        assertTrue(File(root, "book.torrent").exists())
    }
    @Test fun usesSavedMetadataWithoutNetworkAndRetainsItOnCancel() = runBlocking<Unit> {
        val root = folder.newFolder(); File(root, "book.torrent").writeBytes(byteArrayOf(1))
        val engine = Engine(root, content, listOf("downloading"))
        val task = launch {
            DownloadRunner({ engine }, { error("must not fetch") }, 5).run(DownloadJob(book, edition), root, {}) { _, _ -> fail("not complete") }
        }
        withTimeout(5000) { while (engine.polls < 2) delay(5) }
        task.cancelAndJoin(); assertTrue(engine.closed)
        assertArrayEquals(content, File(root, "payload").readBytes()); assertTrue(File(root, "book.torrent").exists())
    }
    @Test fun retriesBadCachedMetadataAndRejectsWrongHashBeforeImport() = runBlocking<Unit> {
        val root = folder.newFolder(); File(root, "book.torrent").writeBytes(byteArrayOf(1))
        var attempts = 0; var fetched = false
        val engines = mutableListOf<Engine>()
        val runner = DownloadRunner({ Engine(root, content, fail = attempts++ == 0).also { engines += it } }, { fetched = true; byteArrayOf(2) }, 1)
        runner.run(DownloadJob(book, edition), root, {}) { _, _ -> }
        assertTrue(fetched); assertTrue(engines.all { it.closed })
        val bad = edition.copy(md5 = "a".repeat(32))
        try { DownloadRunner({ Engine(root, content) }, { byteArrayOf(1) }, 1).run(DownloadJob(book, bad), root, {}) { _, _ -> fail("unverified import") }; fail("hash") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("hash")) }
    }
    @Test fun missingPeersAndEngineFailuresAreRetryableWithoutDeletingData() = runBlocking<Unit> {
        for (state in listOf("finding-peers", "failed")) {
            val root = folder.newFolder(); val engine = Engine(root, content, listOf(state))
            try { DownloadRunner({ engine }, { byteArrayOf(1) }, 2, 1).run(DownloadJob(book, edition), root, {}) { _, _ -> fail("unverified") }; fail("must fail") }
            catch (e: IllegalStateException) { assertTrue(e.message!!.contains(if (state == "failed") "disk" else "progress")) }
            assertTrue(engine.closed); assertTrue(File(root, "payload").isFile)
        }
    }
    @Test fun rejectsInvalidMetadataWrongSizesAndUnsafePaths() = runBlocking<Unit> {
        val root = folder.newFolder()
        for (bytes in listOf(byteArrayOf(), ByteArray(16 * 1024 * 1024 + 1))) {
            try { DownloadRunner({ Engine(root, content) }, { bytes }, 1).run(DownloadJob(book, edition), root, {}) { _, _ -> fail("unverified") }; fail("metadata") }
            catch (_: IllegalArgumentException) { }
        }
        try { DownloadRunner({ Engine(root, content) }, { byteArrayOf(1) }, 1).run(DownloadJob(book, edition.copy(expectedSize = 999)), root, {}) { _, _ -> fail("unverified") }; fail("size") }
        catch (_: IllegalArgumentException) { }
        val outside = folder.newFile(); outside.writeBytes(content)
        assertThrows(IllegalArgumentException::class.java) { DownloadRunner.verify(root, outside.path, edition) }
        val inside = File(root, "payload"); inside.writeBytes(content)
        assertThrows(IllegalArgumentException::class.java) { DownloadRunner.verify(root, inside.path, edition.copy(expectedSize = 999)) }
        inside.writeText("corrupt")
        assertThrows(IllegalArgumentException::class.java) { DownloadRunner.verify(root, inside.path, edition.copy(expectedSize = null)) }
    }
}
