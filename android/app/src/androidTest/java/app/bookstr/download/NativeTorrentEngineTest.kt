package app.bookstr.download

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import app.bookstr.data.TorrentEdition
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.ServerSocket
import java.net.SocketException
import java.security.MessageDigest
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class NativeTorrentEngineTest {
    private fun hash(bytes: ByteArray, algorithm: String) = MessageDigest.getInstance(algorithm).digest(bytes)
    private fun bencode(value: Any): ByteArray = when (value) {
        is ByteArray -> "${value.size}:".toByteArray() + value
        is String -> bencode(value.toByteArray())
        is Number -> "i${value}e".toByteArray()
        is List<*> -> "l".toByteArray() + value.fold(byteArrayOf()) { acc, item -> acc + bencode(item!!) } + "e".toByteArray()
        is Map<*, *> -> "d".toByteArray() + value.entries.sortedBy { it.key.toString() }.fold(byteArrayOf()) { acc, item -> acc + bencode(item.key!!) + bencode(item.value!!) } + "e".toByteArray()
        else -> error("invalid fixture")
    }
    @Test fun announcesToAllConfiguredTrackersWithoutWaitingForFailures() = runBlocking<Unit> {
        val received = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        val server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val serving = thread(isDaemon = true) {
            try {
                while (!server.isClosed) server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val reader = socket.getInputStream().bufferedReader()
                    val request = reader.readLine().orEmpty()
                    received.add(request.substringAfter("GET ").substringBefore('?'))
                    while (!reader.readLine().isNullOrEmpty()) { }
                    val body = bencode(mapOf("interval" to 1800, "peers" to byteArrayOf()))
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(body); flush()
                    }
                }
            } catch (_: SocketException) { }
        }
        val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "tracker-test-${System.nanoTime()}").also { it.mkdirs() }
        try {
            val content = "controlled peer discovery".toByteArray()
            val md5 = hash(content, "MD5").joinToString("") { "%02x".format(it) }
            val base = "http://127.0.0.1:${server.localPort}"
            val metadata = bencode(mapOf("announce" to "$base/announce/one", "announce-list" to listOf(listOf("$base/announce/one", "$base/announce/two"), listOf("$base/announce/three")),
                "info" to mapOf("name" to "$md5.pdf", "piece length" to 16384, "length" to content.size, "pieces" to hash(content, "SHA-1"), "private" to 1)))
            NativeTorrentEngine().use { engine ->
                engine.start(root, metadata, TorrentEdition(md5, 1, "fiction", content.size.toLong()))
                withTimeout(15000) { while (!received.containsAll(listOf("/announce/one", "/announce/two", "/announce/three"))) { engine.poll(); delay(50) } }
                assertEquals(setOf("/announce/one", "/announce/two", "/announce/three"), received)
                delay(10_100)
                engine.poll()
                withTimeout(5000) { while (!File(root, "resume.dat").isFile) { engine.poll(); delay(50) } }
                assertTrue(File(root, "resume.dat").length() > 0)
            }
        } finally { server.close(); serving.join(1000); root.deleteRecursively() }
    }
    @Test fun downloadsControlledFixtureAndRecoversVerifiedFileAfterRestart() = runBlocking<Unit> {
        val content = "%PDF-1.4\nBookstr controlled fixture\n%%EOF".toByteArray()
        val md5 = hash(content, "MD5").joinToString("") { "%02x".format(it) }
        val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "torrent-test-${System.nanoTime()}").also { it.mkdirs() }
        val server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val serving = thread(isDaemon = true) {
            try {
                while (!server.isClosed) server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val reader = socket.getInputStream().bufferedReader()
                    val headers = mutableListOf<String>()
                    while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break; headers += line }
                    val range = headers.firstOrNull { it.startsWith("Range:", true) }?.substringAfter("bytes=")?.split('-')
                    val start = range?.firstOrNull()?.toIntOrNull() ?: 0
                    val end = (range?.getOrNull(1)?.toIntOrNull() ?: content.lastIndex).coerceAtMost(content.lastIndex)
                    val body = content.copyOfRange(start, end + 1)
                    socket.getOutputStream().apply {
                        write(("HTTP/1.1 206 Partial Content\r\nContent-Length: ${body.size}\r\nContent-Range: bytes $start-$end/${content.size}\r\nConnection: close\r\n\r\n").toByteArray())
                        write(body); flush()
                    }
                }
            } catch (_: SocketException) { }
        }
        try {
            val info = mapOf("name" to "$md5.pdf", "piece length" to 16384, "length" to content.size, "pieces" to hash(content, "SHA-1"), "private" to 1)
            val metadata = bencode(mapOf("info" to info, "url-list" to "http://127.0.0.1:${server.localPort}/$md5.pdf"))
            val edition = TorrentEdition(md5, 1, "fiction", content.size.toLong())
            NativeTorrentEngine().use { engine ->
                engine.start(root, metadata, edition)
                val complete = withTimeout(60_000) {
                    var snapshot = engine.poll()
                    while (snapshot.state != "ready") { assertNotEquals(snapshot.error, "failed", snapshot.state); delay(100); snapshot = engine.poll() }
                    snapshot
                }
                assertEquals(content.size.toLong(), complete.bytes)
            }
            assertArrayEquals(content, DownloadRunner.verify(root, File(root, "payload").path, edition).readBytes())
            assertTrue(File(root, "resume.dat").isFile)
            NativeTorrentEngine().use { engine ->
                engine.start(root, metadata, edition)
                withTimeout(20_000) { while (engine.poll().state != "ready") delay(100) }
            }
        } finally { server.close(); serving.join(1000); root.deleteRecursively() }
    }
    @Test fun serviceStartsEveryQueuedTorrentEvenWhenEarlierJobsHaveNoPeers() = runBlocking<Unit> {
        val application = ApplicationProvider.getApplicationContext<app.bookstr.BookstrApp>()
        val books = (1..4).map { index ->
            val content = "Queued fixture $index".toByteArray()
            val md5 = hash(content, "MD5").joinToString("") { "%02x".format(it) }
            val book = app.bookstr.data.CatalogBook(md5, "Queued fixture $index", "Bookstr", "", null, libvaultMd5 = md5)
            val root = application.downloadStore.root(md5)
            File(root, "book.torrent").writeBytes(bencode(mapOf("info" to mapOf("name" to "$md5.epub", "piece length" to 16384,
                "length" to content.size, "pieces" to hash(content, "SHA-1"), "private" to 1))))
            application.downloadStore.update(DownloadJob(book, TorrentEdition(md5, index.toLong(), "fiction", content.size.toLong())))
            book
        }
        try {
            androidx.test.core.app.ActivityScenario.launch(app.bookstr.MainActivity::class.java).use {
                DownloadService.dispatch(application)
                withTimeout(15000) {
                    while (books.any { application.downloadStore.find(it.id)?.state != "finding-peers" }) delay(100)
                }
                assertTrue(books.all { application.downloadStore.find(it.id)?.active == true })
                books.forEach { DownloadService.dispatch(application, "cancel", it.id) }
                withTimeout(10000) { while (books.any { application.downloadStore.find(it.id)?.state != "cancelled" }) delay(100) }
            }
        } finally {
            books.forEach { DownloadService.dispatch(application, "cancel", it.id) }
        }
    }
    @Test fun backgroundServicePausesResumesAndImportsVerifiedCachedEdition() = runBlocking<Unit> {
        val application = ApplicationProvider.getApplicationContext<app.bookstr.BookstrApp>()
        application.settingsRepository.disconnectNostr()
        application.settingsRepository.clearReaderSession()
        val content = "%PDF-1.4\nService fixture\n%%EOF".toByteArray()
        val md5 = hash(content, "MD5").joinToString("") { "%02x".format(it) }
        val book = app.bookstr.data.CatalogBook(md5, "Service fixture", "Bookstr", "", null,
            libvaultMd5 = md5, format = app.bookstr.data.BookFormat.Pdf, language = "pt-BR")
        val edition = TorrentEdition(md5, 1, "fiction", content.size.toLong())
        val root = application.downloadStore.root(md5)
        File(root, "payload").writeBytes(content)
        File(root, "book.torrent").writeBytes(bencode(mapOf("info" to mapOf("name" to "$md5.pdf", "piece length" to 16384,
            "length" to content.size, "pieces" to hash(content, "SHA-1"), "private" to 1))))
        androidx.test.core.app.ActivityScenario.launch(app.bookstr.MainActivity::class.java).use {
            application.downloadStore.update(DownloadJob(book, edition, "paused"))
            DownloadService.dispatch(application, "cancel", md5)
            withTimeout(10000) { while (application.downloadStore.find(md5)?.state != "cancelled") delay(100) }
            assertArrayEquals(content, File(root, "payload").readBytes())
            DownloadService.dispatch(application, "resume", md5)
            withTimeout(30000) {
                while (application.downloadStore.find(md5)?.state != "complete") {
                    val job = application.downloadStore.find(md5)!!
                    assertNotEquals(job.error, "failed", job.state)
                    delay(100)
                }
            }
            assertArrayEquals(content, application.catalogRepository.publicationFile(md5, book.format).readBytes())
            assertEquals("pt-BR", application.catalogRepository.downloadedBooks(emptyList()).first { it.id == md5 }.language)
            DownloadService.dispatch(application, "pause", md5)
            withTimeout(10000) { while (application.downloadStore.find(md5)?.state != "paused") delay(100) }
        }
        application.downloadStore.update(DownloadJob(book, edition, "cancelled"))
        application.catalogRepository.deletePublication(book)
    }
    @Test fun rejectsMalformedOrAbsentEditionsWithoutCreatingReadableFiles() {
        val root = File(ApplicationProvider.getApplicationContext<Context>().cacheDir, "torrent-invalid-${System.nanoTime()}").also { it.mkdirs() }
        val edition = TorrentEdition("a".repeat(32), 1, "fiction", null)
        try {
            NativeTorrentEngine().use { engine ->
                assertThrows(IllegalStateException::class.java) { engine.poll() }
                assertThrows(IllegalStateException::class.java) { engine.start(root, byteArrayOf(), edition) }
                assertThrows(IllegalStateException::class.java) { engine.start(root, "not-bencode".toByteArray(), edition) }
                val metadata = bencode(mapOf("info" to mapOf("name" to "other.pdf", "piece length" to 16384, "length" to 1, "pieces" to hash(byteArrayOf(1), "SHA-1"))))
                assertThrows(IllegalStateException::class.java) { engine.start(root, metadata, edition) }
                assertThrows(IllegalStateException::class.java) { engine.start(root, metadata, edition.copy(filename = "../x")) }
            }
            assertFalse(File(root, "payload").exists())
        } finally { root.deleteRecursively() }
    }
}
