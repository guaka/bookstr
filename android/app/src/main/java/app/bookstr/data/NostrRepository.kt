package app.bookstr.data

import android.content.Context
import android.util.Log
import app.bookstr.nostr.NostrClient
import app.bookstr.nostr.NostrSignerFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class NostrRepository(
    private val context: Context,
    private val settings: SettingsRepository,
    private val progressDao: BookProgressDao,
) {
    suspend fun publishProgress(
        bookId: String,
        progression: Double,
        cfi: String,
        title: String? = null,
        author: String? = null,
    ): Boolean =
        withContext(Dispatchers.IO) {
            val signer = NostrSignerFactory.create(context, settings) ?: return@withContext false
            val relays = settings.relays
            if (relays.isEmpty()) return@withContext false

            try {
                val updatedAt = System.currentTimeMillis()
                val content = NostrClient.progressContent(
                    bookId = bookId,
                    progression = progression,
                    cfi = cfi,
                    title = title,
                    author = author,
                    updatedAt = updatedAt,
                )
                val tags = JSONArray()
                    .put(JSONArray().put("d").put(NostrClient.progressDTag(bookId)))

                val unsigned = JSONObject()
                    .put("kind", NostrClient.KIND_PROGRESS)
                    .put("created_at", updatedAt / 1000)
                    .put("tags", tags)
                    .put("content", content)

                val signed = signer.signEvent(unsigned)
                NostrClient(relays).publishEvent(signed)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to publish progress for $bookId", e)
                false
            }
        }

    suspend fun pullProgress(bookId: String): BookProgress? = withContext(Dispatchers.IO) {
        val signer = NostrSignerFactory.create(context, settings) ?: return@withContext null
        val relays = settings.relays
        if (relays.isEmpty()) return@withContext null

        try {
            val pubkey = signer.getPublicKey()
            val event = NostrClient(relays).fetchLatestProgress(pubkey, bookId) ?: return@withContext null
            val raw = event.getString("content")
            val parsed = NostrClient.parseProgressContent(raw, bookId) ?: return@withContext null
            val remoteUpdatedAt = NostrClient.parseUpdatedAt(raw, event.getLong("created_at"))
            val local = progressDao.get(bookId)
            if (local != null && local.updatedAt >= remoteUpdatedAt) {
                return@withContext local
            }
            val progress = BookProgress(
                bookId = parsed.first,
                progression = parsed.second,
                cfi = parsed.third,
                updatedAt = remoteUpdatedAt,
            )
            progressDao.upsert(progress)
            progress
        } catch (e: Exception) {
            Log.e(TAG, "Failed to pull progress for $bookId", e)
            null
        }
    }

    suspend fun syncAllFromRelays(bookIds: List<String> = emptyList()) {
        val ids = (bookIds + progressDao.getAll().map { it.bookId }).distinct()
        for (id in ids) {
            pullProgress(id)
        }
    }

    companion object {
        private const val TAG = "NostrRepository"
    }
}
