package app.bookstr.download

import app.bookstr.data.TorrentEdition
import java.io.File

interface TorrentEngine : AutoCloseable {
    fun start(root: File, metadata: ByteArray, edition: TorrentEdition)
    fun poll(): TorrentSnapshot
}
data class TorrentSnapshot(val state: String, val bytes: Long, val size: Long, val path: String, val error: String)

class NativeTorrentEngine : TorrentEngine {
    private var handle = 0L
    override fun start(root: File, metadata: ByteArray, edition: TorrentEdition) {
        check(handle == 0L)
        handle = create(root.canonicalPath, metadata, edition.md5, edition.filename)
    }
    override fun poll(): TorrentSnapshot {
        check(handle != 0L)
        val values = snapshot(handle)
        return TorrentSnapshot(values[0], values[1].toLong(), values[2].toLong(), values[3], values[4])
    }
    override fun close() { if (handle != 0L) { destroy(handle); handle = 0 } }
    private external fun create(root: String, metadata: ByteArray, md5: String, filename: String?): Long
    private external fun snapshot(handle: Long): Array<String>
    private external fun destroy(handle: Long)
    companion object { init { System.loadLibrary("bookstr_torrent") } }
}
