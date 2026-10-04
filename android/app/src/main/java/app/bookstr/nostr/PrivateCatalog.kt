package app.bookstr.nostr

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID

/** Same service identity and envelopes as iOS and the shared private catalog contract. */
data class CatalogService(val pubkey: String = "83503e3e82744479362b04881a8f240bd6d838b78430035868f1c0826ec3876f", val relay: String = "wss://relay.nomadwiki.org")

class EphemeralSigner(private val secret: ByteArray = ByteArray(32).also(SecureRandom()::nextBytes)) : NostrSigner {
    override fun isConfigured() = true
    override suspend fun getPublicKey() = NostrCrypto.publicKeyHex(secret)
    override suspend fun signEvent(unsigned: JSONObject) = NostrCrypto.signEvent(secret, unsigned)
    override suspend fun nip44Encrypt(plaintext: String, pubkey: String) = Nip44.encrypt(secret, pubkey, plaintext)
    override suspend fun nip44Decrypt(ciphertext: String, pubkey: String) = Nip44.decrypt(secret, pubkey, ciphertext)
}

object PrivateCatalogWire {
    private fun event(pubkey: String, kind: Int, now: Long, tags: JSONArray, content: String) = JSONObject()
        .put("pubkey", pubkey).put("kind", kind).put("created_at", now).put("tags", tags).put("content", content)
    private fun recipient(pubkey: String) = JSONArray().put(JSONArray().put("p").put(pubkey))
    suspend fun wrap(payload: JSONObject, service: CatalogService, signer: NostrSigner, now: Long,
                     ephemeral: NostrSigner = EphemeralSigner()): JSONObject {
        val rumor = event(signer.getPublicKey(), 14, now, recipient(service.pubkey), payload.toString())
        rumor.put("id", NostrCrypto.eventId(rumor))
        val jitter = SecureRandom().nextInt(172800).toLong()
        val seal = signer.signEvent(event(signer.getPublicKey(), 13, now - jitter, JSONArray(), signer.nip44Encrypt(rumor.toString(), service.pubkey)))
        return ephemeral.signEvent(event(ephemeral.getPublicKey(), 1059, now - jitter,
            recipient(service.pubkey).put(JSONArray().put("expiration").put((now + 600).toString())),
            ephemeral.nip44Encrypt(seal.toString(), service.pubkey)))
    }
    private fun hasRecipient(event: JSONObject, pubkey: String): Boolean {
        val tags = event.optJSONArray("tags") ?: return false
        return (0 until tags.length()).any { tags.optJSONArray(it)?.let { t -> t.optString(0) == "p" && t.optString(1) == pubkey } == true }
    }
    suspend fun unwrap(wrap: JSONObject, service: CatalogService, signer: NostrSigner, requestId: String, type: String): JSONObject? {
        if (wrap.optInt("kind") != 1059 || !hasRecipient(wrap, signer.getPublicKey()) || !NostrCrypto.verifyEvent(wrap)) return null
        val seal = JSONObject(signer.nip44Decrypt(wrap.getString("content"), wrap.getString("pubkey")))
        if (seal.optInt("kind") != 13 || seal.optString("pubkey") != service.pubkey || !NostrCrypto.verifyEvent(seal)) return null
        val rumor = JSONObject(signer.nip44Decrypt(seal.getString("content"), service.pubkey))
        if (rumor.optInt("kind") != 14 || rumor.optString("pubkey") != service.pubkey || rumor.has("sig") ||
            !hasRecipient(rumor, signer.getPublicKey()) || rumor.optString("id") != NostrCrypto.eventId(rumor)) return null
        val payload = JSONObject(rumor.getString("content"))
        return payload.takeIf { it.optString("request_id") == requestId && it.optString("type") == "$type.result" }
    }
}

class PrivateCatalogClient(private val http: OkHttpClient = OkHttpClient(), private val timeoutMs: Long = 45_000) {
    suspend fun request(payload: JSONObject, signer: NostrSigner, service: CatalogService): JSONObject = withContext(Dispatchers.IO) {
        require(service.relay.startsWith("wss://") && Regex("[0-9a-f]{64}").matches(service.pubkey))
        val startedAt = System.nanoTime()
        val id = UUID.randomUUID().toString()
        val body = JSONObject(payload.toString()).put("request_id", id).put("version", 1)
        // Bound signer approval too; a provider that never returns must not leave
        // the result row in its opening state forever.
        val wrapped = try {
            withTimeout(timeoutMs) {
                PrivateCatalogWire.wrap(body, service, signer, System.currentTimeMillis() / 1000)
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            Log.w(TAG, "${body.optString("type")} timed out while preparing signed request")
            throw IllegalStateException("Catalog request timed out during signer approval", e)
        }
        val channel = Channel<String>(64)
        val socket = http.newWebSocket(Request.Builder().url(service.relay).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { channel.trySend("OPEN") }
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (text.length > 4 * Nip44.MAX_PLAINTEXT || channel.trySend(text).isFailure) channel.close(IllegalStateException("Catalog response overflow"))
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { channel.close(t) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { channel.close(IllegalStateException("Catalog connection closed")) }
        })
        try {
            val remainingTimeout = timeoutMs - (System.nanoTime() - startedAt) / 1_000_000
            if (remainingTimeout <= 0) {
                Log.w(TAG, "${body.optString("type")} timed out before relay request")
                throw IllegalStateException("Catalog request timed out before relay request")
            }
            withTimeout(remainingTimeout) {
                check(channel.receive() == "OPEN")
                val filter = JSONObject().put("kinds", JSONArray().put(1059)).put("#p", JSONArray().put(signer.getPublicKey()))
                    .put("since", System.currentTimeMillis() / 1000 - 172800).put("limit", 0)
                check(socket.send(JSONArray().put("REQ").put(id).put(filter).toString()))
                var sent = false
                var result: JSONObject? = null
                while (result == null) {
                    val text = channel.receive()
                    val frame = runCatching { JSONArray(text) }.getOrNull() ?: continue
                    when (frame.optString(0)) {
                        "EOSE" -> if (frame.optString(1) == id && !sent) {
                            check(socket.send(JSONArray().put("EVENT").put(wrapped).toString())); sent = true
                        }
                        "OK" -> if (frame.optString(1) == wrapped.getString("id") && !frame.optBoolean(2)) error("Relay rejected catalog request")
                        "CLOSED" -> if (frame.optString(1) == id) error("Relay closed catalog subscription")
                        "EVENT" -> if (sent && frame.optString(1) == id) {
                            val event = frame.optJSONObject(2) ?: continue
                            // Invalid envelopes are ignored; signer rejection remains actionable.
                            result = try { PrivateCatalogWire.unwrap(event, service, signer, id, body.getString("type")) }
                                catch (_: org.json.JSONException) { null }
                            if (result?.optBoolean("ok", true) == false || result?.has("error") == true) error(result?.optString("error") ?: "Catalog request failed")
                        }
                    }
                }
                result
            }
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            Log.w(TAG, "${body.optString("type")} timed out waiting for relay response")
            throw IllegalStateException("Catalog request timed out waiting for relay response", e)
        } finally {
            socket.send(JSONArray().put("CLOSE").put(id).toString()); socket.close(1000, "Done"); socket.cancel(); channel.cancel()
        }
    }
    companion object { private const val TAG = "PrivateCatalog" }
}
