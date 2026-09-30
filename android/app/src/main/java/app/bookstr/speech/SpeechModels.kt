package app.bookstr.speech

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.io.File
import java.util.concurrent.TimeUnit

data class SpeechModelFile(val path: String, val bytes: Long)
data class SpeechModel(
    val id: String, val language: String, val label: String, val repository: String,
    val revision: String, val kind: String, val model: String, val files: List<SpeechModelFile>,
    val speaker: Int = 0, val engineLanguage: String? = null,
) {
    val bytes: Long get() = files.sumOf { it.bytes }
}

class SpeechModels(
    val root: File,
    val models: List<SpeechModel>,
    private val client: OkHttpClient = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build(),
    private val baseURL: String = "https://huggingface.co",
) {
    constructor(context: Context) : this(File(context.filesDir, "speech-models"), parse(context.assets.open("speech-models.json").bufferedReader().use { it.readText() }))
    fun directory(model: SpeechModel) = File(root, model.id)
    fun installed(model: SpeechModel): Boolean = model.files.all { File(directory(model), it.path).length() == it.bytes }
    // eSpeak initializes once per process. Every model carries the complete supported
    // pronunciation set, and all synthesizers use this stable shared directory.
    fun pronunciationDirectory(model: SpeechModel): File {
        for (file in model.files.filter { it.path.startsWith("espeak-ng-data/") }) {
            val target = File(root, file.path)
            if (target.length() != file.bytes) {
                target.parentFile!!.mkdirs()
                File(directory(model), file.path).copyTo(target, overwrite = true)
            }
        }
        return File(root, "espeak-ng-data")
    }
    fun remove(model: SpeechModel) { check(directory(model).deleteRecursively()) { "Could not remove voice" } }

    suspend fun install(model: SpeechModel, progress: (Float) -> Unit) = withContext(Dispatchers.IO) {
        val staging = File(root, "${model.id}.partial")
        staging.deleteRecursively()
        check(staging.mkdirs()) { "Could not create voice directory" }
        try {
            var downloaded = 0L
            for (file in model.files) {
                currentCoroutineContext().ensureActive()
                val destination = File(staging, file.path)
                destination.parentFile!!.mkdirs()
                val existing = File(directory(model), file.path)
                if (existing.length() == file.bytes) {
                    existing.copyTo(destination)
                    downloaded += file.bytes
                    progress((downloaded.toDouble() / model.bytes).toFloat())
                    continue
                }
                val request = Request.Builder().url("$baseURL/${model.repository}/resolve/${model.revision}/${file.path}").build()
                client.newCall(request).execute().use { response ->
                    check(response.isSuccessful) { "Voice download failed (HTTP ${response.code})" }
                    val body = checkNotNull(response.body) { "Empty voice download" }
                    body.byteStream().use { input ->
                        destination.outputStream().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                val count = input.read(buffer)
                                if (count < 0) break
                                output.write(buffer, 0, count)
                                downloaded += count
                                progress((downloaded.toDouble() / model.bytes).toFloat().coerceIn(0f, 1f))
                            }
                        }
                    }
                }
                check(destination.length() == file.bytes) { "Incomplete voice download: ${file.path}" }
            }
            // Only replace an installed voice after every file has been validated.
            check(directory(model).deleteRecursively())
            check(staging.renameTo(directory(model))) { "Could not install voice" }
        } finally {
            staging.deleteRecursively()
        }
    }

    companion object {
        fun parse(json: String): List<SpeechModel> {
            val array = JSONArray(json)
            return (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                val files = item.getJSONArray("files")
                SpeechModel(item.getString("id"), item.getString("language"), item.getString("label"), item.getString("repository"),
                    item.getString("revision"), item.getString("kind"), item.getString("model"),
                    (0 until files.length()).map { files.getJSONObject(it).let { file -> SpeechModelFile(file.getString("path"), file.getLong("bytes")) } },
                    item.optInt("speaker", 0), item.optString("engineLanguage").takeIf(String::isNotBlank))
            }
        }
    }
}
