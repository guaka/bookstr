package app.bookstr.download

import app.bookstr.data.CatalogBook
import app.bookstr.data.TorrentEdition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

class DownloadRunner(
    private val engineFactory: () -> TorrentEngine = { NativeTorrentEngine() },
    private val fetch: (String) -> ByteArray = ::fetchMetadata,
    private val pollDelayMs: Long = 1000,
    private val peerTimeoutMs: Long = 180_000,
) {
    suspend fun run(job: DownloadJob, root: File, update: (DownloadJob) -> Unit,
                    import: suspend (CatalogBook, File) -> Unit) = withContext(Dispatchers.IO) {
        val edition = job.edition
        val metadataFile = File(root, "book.torrent")
        val candidates = if (metadataFile.exists()) listOf<String?>(null) + edition.metadataUrls else edition.metadataUrls
        var engine: TorrentEngine? = null
        var lastError: Exception? = null
        try {
            for (url in candidates) {
                coroutineContext.ensureActive()
                val candidate = engineFactory()
                try {
                    val metadata = if (url == null) metadataFile.readBytes() else fetch(url)
                    require(metadata.size in 1..16 * 1024 * 1024) { "Invalid torrent metadata size" }
                    candidate.start(root, metadata, edition)
                    val snapshot = candidate.poll()
                    require(snapshot.size in 1..TorrentEdition.MAX_BYTES && (edition.expectedSize == null || edition.expectedSize == snapshot.size)) { "Torrent size does not match edition" }
                    require(root.usableSpace > (snapshot.size - snapshot.bytes).coerceAtLeast(0) + snapshot.size + 16 * 1024 * 1024) { "Not enough storage; free space and retry" }
                    if (url != null) { val temp = File(root, "metadata.tmp"); temp.writeBytes(metadata); check(temp.renameTo(metadataFile)) }
                    engine = candidate
                    break
                } catch (cancelled: kotlinx.coroutines.CancellationException) { candidate.close(); throw cancelled }
                catch (e: Exception) { candidate.close(); lastError = e }
            }
            val running = engine ?: throw (lastError ?: IllegalStateException("Torrent unavailable"))
            var lastBytes = -1L
            var lastProgress = System.nanoTime()
            while (true) {
                coroutineContext.ensureActive()
                val snapshot = running.poll()
                if (snapshot.state == "failed") error(snapshot.error)
                if (snapshot.bytes != lastBytes) { lastBytes = snapshot.bytes; lastProgress = System.nanoTime() }
                if ((System.nanoTime() - lastProgress) / 1_000_000 > peerTimeoutMs) error("No download progress; retry when peers are available")
                if (snapshot.state != "ready") update(job.copy(state = snapshot.state, bytes = snapshot.bytes, size = snapshot.size))
                if (snapshot.state == "ready") {
                    // Stop/flush the engine before hashing or copying its output.
                    running.close(); engine = null
                    update(job.copy(state = "verifying", bytes = snapshot.bytes, size = snapshot.size))
                    val file = verify(root, snapshot.path, edition)
                    import(job.book, file)
                    update(job.copy(state = "complete", bytes = snapshot.size, size = snapshot.size))
                    break
                }
                delay(pollDelayMs)
            }
        } finally { engine?.close() }
    }
    companion object {
        fun verify(root: File, path: String, edition: TorrentEdition): File {
            val file = File(path).canonicalFile
            require(file.path.startsWith(root.canonicalPath + File.separator) && file.isFile) { "Unsafe torrent output path" }
            require(file.length() in 1..TorrentEdition.MAX_BYTES && (edition.expectedSize == null || file.length() == edition.expectedSize)) { "Downloaded size mismatch" }
            val digest = MessageDigest.getInstance("MD5")
            file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
            require(digest.digest().joinToString("") { "%02x".format(it) } == edition.md5) { "Downloaded file hash mismatch" }
            return file
        }
    }
}
private val metadataClient = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
private fun fetchMetadata(url: String): ByteArray {
    require(url.startsWith("https://"))
    metadataClient.newCall(Request.Builder().url(url).build()).execute().use { response ->
        require(response.request.url.isHttps) { "Insecure metadata redirect" }
        check(response.isSuccessful) { "Torrent metadata unavailable: HTTP ${response.code}" }
        val body = requireNotNull(response.body)
        require(body.contentLength() <= 16 * 1024 * 1024)
        return body.byteStream().use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(65536)
            while (true) {
                val count = input.read(buffer); if (count < 0) break
                require(output.size() + count <= 16 * 1024 * 1024) { "Torrent metadata too large" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        }
    }
}
