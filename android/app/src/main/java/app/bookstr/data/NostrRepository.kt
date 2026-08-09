package app.bookstr.data

import android.content.Context
import android.util.Log
import app.bookstr.nostr.NostrClient
import app.bookstr.nostr.NostrCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class NostrRepository(
    private val context: Context,
    private val settings: SettingsRepository,
    private val progressDao: BookProgressDao,
) {
    suspend fun publishProgress(bookId: String, progression: Double, cfi: String): Boolean =
        withContext(Dispatchers.IO) {
            val nsec = settings.nsec ?: return@withContext false
            val relays = settings.relays
            if (relays.isEmpty()) return@withContext false

            try {
                val privateKey = NostrCrypto.parsePrivateKey(nsec)
                val content = NostrClient.progressContent(progression, cfi)
                val tags = JSONArray()
                    .put(JSONArray().put("d").put(NostrClient.progressDTag(bookId)))

                val unsigned = JSONObject()
                    .put("kind", NostrClient.KIND_PROGRESS)
                    .put("created_at", System.currentTimeMillis() / 1000)
                    .put("tags", tags)
                    .put("content", content)

                val signed = NostrCrypto.signEvent(privateKey, unsigned)
                NostrClient(relays).publishEvent(signed)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to publish progress for $bookId", e)
                false
            }
        }

    suspend fun pullProgress(bookId: String): BookProgress? = withContext(Dispatchers.IO) {
        val nsec = settings.nsec ?: return@withContext null
        val relays = settings.relays
        if (relays.isEmpty()) return@withContext null

        try {
            val privateKey = NostrCrypto.parsePrivateKey(nsec)
            val pubkey = NostrCrypto.publicKeyHex(privateKey)
            val event = NostrClient(relays).fetchLatestProgress(pubkey, bookId) ?: return@withContext null
            val content = JSONObject(event.getString("content"))
            val progress = BookProgress(
                bookId = bookId,
                progression = content.optDouble("progression", 0.0),
                cfi = content.optString("cfi", ""),
                updatedAt = event.getLong("created_at") * 1000,
            )
            progressDao.upsert(progress)
            progress
        } catch (e: Exception) {
            Log.e(TAG, "Failed to pull progress for $bookId", e)
            null
        }
    }

    suspend fun syncAllFromRelays() {
        val local = progressDao.getAll()
        for (item in local) {
            pullProgress(item.bookId)
        }
    }

    companion object {
        private const val TAG = "NostrRepository"
    }
}
