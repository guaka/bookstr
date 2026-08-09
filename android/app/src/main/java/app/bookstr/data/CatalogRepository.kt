package app.bookstr.data

import android.content.Context
import app.bookstr.util.Sha256
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

data class CatalogBook(
    val id: String,
    val title: String,
    val author: String,
    val epubUrl: String,
    val coverUrl: String?,
)

class CatalogRepository(
    private val context: Context,
    private val settings: SettingsRepository,
    private val progressDao: BookProgressDao,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private fun booksDir(): File {
        val dir = File(context.filesDir, "books")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    fun epubFile(bookId: String): File = File(booksDir(), "$bookId.epub")

    suspend fun fetchCatalog(): List<CatalogBook> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(settings.catalogUrl).get().build()
        client.newCall(request).execute().use { response ->
            require(response.isSuccessful) { "Catalog fetch failed: HTTP ${response.code}" }
            val body = response.body?.string() ?: throw IllegalStateException("Empty catalog response")
            parseCatalog(body)
        }
    }

    suspend fun ensureDownloaded(book: CatalogBook): File = withContext(Dispatchers.IO) {
        val target = epubFile(book.id)
        if (target.exists() && target.length() > 0) return@withContext target

        val request = Request.Builder().url(book.epubUrl).get().build()
        client.newCall(request).execute().use { response ->
            require(response.isSuccessful) { "EPUB download failed: HTTP ${response.code}" }
            val bytes = response.body?.bytes() ?: throw IllegalStateException("Empty EPUB response")
            val hash = Sha256.hash(bytes)
            require(hash == book.id) {
                "SHA-256 mismatch: expected ${book.id}, got $hash"
            }
            target.writeBytes(bytes)
        }
        target
    }

    suspend fun getProgressForBooks(books: List<CatalogBook>): Map<String, BookProgress> {
        val all = progressDao.getAll().associateBy { it.bookId }
        return books.associate { book ->
            book.id to (all[book.id] ?: BookProgress(book.id, 0.0, "", 0L))
        }
    }

    suspend fun saveProgress(bookId: String, progression: Double, cfi: String) {
        progressDao.upsert(
            BookProgress(
                bookId = bookId,
                progression = progression,
                cfi = cfi,
                updatedAt = System.currentTimeMillis(),
            ),
        )
    }

    private fun parseCatalog(json: String): List<CatalogBook> {
        val root = JSONObject(json)
        val items: JSONArray = when {
            root.has("books") -> root.getJSONArray("books")
            root.has("items") -> root.getJSONArray("items")
            else -> JSONArray().put(root)
        }

        return buildList {
            for (i in 0 until items.length()) {
                val item = items.getJSONObject(i)
                val id = item.optString("id").ifBlank { item.optString("sha256") }
                val title = item.optString("title", "Untitled")
                val author = item.optString("author", "Unknown")
                val epubUrl = item.optString("epubUrl", item.optString("url", item.optString("epub")))
                if (id.isBlank() || epubUrl.isBlank()) continue
                add(
                    CatalogBook(
                        id = id.lowercase(),
                        title = title,
                        author = author,
                        epubUrl = epubUrl,
                        coverUrl = item.optString("coverUrl", null),
                    ),
                )
            }
        }
    }
}
