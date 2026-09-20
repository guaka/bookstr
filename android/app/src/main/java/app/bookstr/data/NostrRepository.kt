package app.bookstr.data

import android.content.Context
import android.util.Log
import app.bookstr.nostr.NostrClient
import app.bookstr.nostr.NostrSignerFactory
import app.bookstr.nostr.Nip55
import app.bookstr.nostr.Nip55Exception
import app.bookstr.nostr.AmberIntentSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

class NostrRepository(
    private val context: Context,
    private val settings: SettingsRepository,
    private val progressDao: BookProgressDao,
    private val vocabularyRepository: VocabularyRepository,
) {
    suspend fun publishProgress(
        bookId: String,
        progression: Double,
        cfi: String,
        furthestProgression: Double = progression,
        title: String? = null,
        author: String? = null,
        rights: BookRights = BookRights(),
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
                    furthestProgression = furthestProgression,
                    title = title,
                    author = author,
                    rights = rights,
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
            val remoteFurthest = NostrClient.parseFurthestProgression(raw, parsed.second)
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
                furthestProgression = maxOf(
                    remoteFurthest,
                    local?.furthestProgression ?: local?.progression ?: 0.0,
                ),
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
        pullVocabulary()
    }

    suspend fun publishVocabularyWord(word: VocabularyWord): Boolean = withContext(Dispatchers.IO) {
        val signer = NostrSignerFactory.create(context, settings) ?: return@withContext false
        if (settings.authMode != NostrAuthMode.Amber) return@withContext false
        val relays = settings.relays
        if (relays.isEmpty()) return@withContext false
        try {
            val pubkey = signer.getPublicKey()
            val content = encryptToSelf(pubkey, VocabularyWire.encode(word).toString())
            val unsigned = JSONObject()
                .put("kind", NostrClient.KIND_PROGRESS)
                .put("created_at", word.lastSeenAt / 1000)
                .put(
                    "tags",
                    JSONArray().put(
                        JSONArray().put("d").put(NostrClient.VOCABULARY_D_PREFIX + word.syncId),
                    ),
                )
                .put("content", content)
            NostrClient(relays).publishEvent(signer.signEvent(unsigned))
        } catch (e: Exception) {
            Log.w(TAG, "Could not publish private vocabulary", e)
            false
        }
    }

    suspend fun pullVocabulary(): Int = withContext(Dispatchers.IO) {
        val signer = NostrSignerFactory.create(context, settings) ?: return@withContext 0
        if (settings.authMode != NostrAuthMode.Amber) return@withContext 0
        val relays = settings.relays
        if (relays.isEmpty()) return@withContext 0
        var merged = 0
        try {
            val pubkey = signer.getPublicKey()
            for (event in NostrClient(relays).fetchVocabulary(pubkey)) {
                runCatching {
                    val parsed = VocabularyWire.parse(JSONObject(decryptFromSelf(pubkey, event.getString("content"))))
                    if (vocabularyRepository.mergeRemote(parsed)) merged++
                }.onFailure { Log.w(TAG, "Skipping malformed private vocabulary event", it) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not pull private vocabulary", e)
        }
        merged
    }

    private suspend fun encryptToSelf(pubkey: String, plaintext: String): String {
        val pkg = settings.signerPackage ?: throw Nip55Exception("External signer is not connected")
        return Nip55.encryptNip44ViaContentResolver(context, pkg, plaintext, pubkey, pubkey)
            ?: AmberIntentSession.Host.session?.encryptNip44(plaintext, pubkey, pubkey, pkg)
            ?: throw Nip55Exception("Reconnect your signer and remember private vocabulary encryption")
    }

    private suspend fun decryptFromSelf(pubkey: String, ciphertext: String): String {
        val pkg = settings.signerPackage ?: throw Nip55Exception("External signer is not connected")
        return Nip55.decryptNip44ViaContentResolver(context, pkg, ciphertext, pubkey, pubkey)
            ?: AmberIntentSession.Host.session?.decryptNip44(ciphertext, pubkey, pubkey, pkg)
            ?: throw Nip55Exception("Reconnect your signer and remember private vocabulary decryption")
    }

    companion object {
        private const val TAG = "NostrRepository"
    }
}
