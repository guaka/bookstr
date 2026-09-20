package app.bookstr.download

import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import app.bookstr.data.TorrentEdition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

private val activeStates = setOf("queued", "connecting", "downloading", "finding-peers", "verifying", "waiting-network")
data class DownloadJob(val book: CatalogBook, val edition: TorrentEdition, val state: String = "queued", val bytes: Long = 0,
                       val size: Long = 0, val error: String? = null) {
    val active get() = state in activeStates
    fun json(): JSONObject = JSONObject().put("book", JSONObject().put("id", book.id).put("title", book.title)
        .put("author", book.author).put("format", book.format.extension).put("year", book.year).put("language", book.language)
        .put("rights_status", book.rightsStatus).put("license", book.license).put("license_url", book.licenseUrl).put("rights_source", book.rightsSource))
        .put("edition", edition.json()).put("state", state).put("bytes", bytes).put("size", size).put("error", error)
    companion object {
        fun parse(value: JSONObject): DownloadJob {
            val b = value.getJSONObject("book")
            val id = b.getString("id")
            val edition = TorrentEdition.parse(value.getJSONObject("edition"), id)
            fun text(key: String) = b.optString(key).takeUnless { it.isBlank() || it == "null" }
            val book = CatalogBook(id, b.getString("title"), b.getString("author"), "", null,
                libvaultMd5 = id, format = BookFormat.entries.first { it.extension == b.getString("format") },
                year = text("year"), language = text("language"), rightsStatus = text("rights_status") ?: "unknown", license = text("license"),
                licenseUrl = text("license_url"), rightsSource = text("rights_source"))
            return DownloadJob(book, edition, value.getString("state"), value.optLong("bytes"), value.optLong("size"),
                value.optString("error").takeUnless { it.isBlank() || it == "null" })
        }
    }
}

/** Journal contains selected editions only, never search pages or signing credentials. */
class DownloadStore(private val directory: File) {
    private val file = File(directory, "jobs.json")
    private val mutable = MutableStateFlow(load())
    val jobs = mutable.asStateFlow()
    private fun load(): List<DownloadJob> {
        directory.mkdirs()
        val backup = File(directory, "jobs.bak")
        if (!file.exists() && backup.exists()) check(backup.renameTo(file))
        if (!file.exists()) return emptyList()
        val array = JSONArray(file.readText())
        return (0 until array.length()).map { DownloadJob.parse(array.getJSONObject(it)).let { job ->
            if (job.active) job.copy(state = "queued", error = null) else job
        } }
    }
    @Synchronized fun update(job: DownloadJob) {
        val current = mutable.value
        val index = current.indexOfFirst { it.book.id == job.book.id }
        if (index >= 0 && current[index] == job) return
        val next = current.toMutableList().apply {
            if (index < 0) add(job) else set(index, job)
        }
        val temporary = File(directory, "jobs.tmp")
        temporary.outputStream().use { out -> out.write(JSONArray(next.map { it.json() }).toString().toByteArray()); out.fd.sync() }
        val backup = File(directory, "jobs.bak")
        if (file.exists()) check(file.renameTo(backup)) { "Could not save download journal" }
        check(temporary.renameTo(file)) { "Could not commit download journal" }
        backup.delete()
        mutable.value = next
    }
    @Synchronized fun enqueue(book: CatalogBook, edition: TorrentEdition) {
        require(book.id == edition.md5)
        val old = mutable.value.find { it.book.id == book.id }
        if (old?.active == true || old?.state == "complete") return
        update(old?.copy(state = "queued", error = null) ?: DownloadJob(book, edition))
    }
    @Synchronized fun markPublicationDeleted(id: String) {
        val job = find(id) ?: return
        if (job.state == "complete") update(job.copy(state = "cancelled", bytes = 0, error = null))
    }
    fun find(id: String) = jobs.value.find { it.book.id == id }
    fun root(id: String): File {
        require(Regex("[0-9a-f]{32}").matches(id))
        return File(directory, id).also { check(it.mkdirs() || it.isDirectory) }
    }
}
