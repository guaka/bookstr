package app.bookstr.nostr

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** NIP-46 Nostr Connect session. The client secret returned by [startPairing] must be stored securely. */
class Nip46Service(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build(),
    private val onAuthChallenge: (String) -> Unit = {},
) {
    private data class Pending(val result: CompletableDeferred<String>)

    private val lock = Any()
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private val openRelays = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var relayReady = CompletableDeferred<Unit>()
    private val pending = ConcurrentHashMap<String, Pending>()
    private val seenEvents = LinkedHashMap<String, Unit>()
    private var clientSecret: ByteArray? = null
    private var clientPubkey: String? = null
    private var remoteSignerPubkey: String? = null
    private var userPubkey: String? = null
    private var sessionRelays: List<String> = emptyList()
    private var pairingSecret: String? = null
    private var pairingResult: CompletableDeferred<String>? = null
    private var sessionPermissions: List<String> = DEFAULT_PERMISSIONS
    private var sessionName: String = "Bookstr TV"
    private var sessionUrl: String? = null
    private val closed = AtomicBoolean(false)
    private val sessionGeneration = AtomicLong(0)

    /** Starts relay subscriptions before returning the QR URI, so the phone's reply is not missed. */
    suspend fun startPairing(
        relays: List<String>,
        name: String = "Bookstr TV",
        url: String? = null,
        permissions: List<String> = DEFAULT_PERMISSIONS,
    ): Nip46Pairing = withContext(Dispatchers.IO) {
        reset()
        val validRelays = relays.map(String::trim).filter(::isRelayUrl).distinct()
        require(validRelays.isNotEmpty()) { "Add at least one valid NIP-46 relay URL" }
        val secretBytes = generateSecretKey()
        val pubkey = NostrCrypto.publicKeyHex(secretBytes)
        val secret = randomHex(16)
        val label = name.trim().take(64).ifBlank { "Bookstr TV" }
        val uri = createNostrConnectUri(pubkey, validRelays, secret, permissions, label, url)

        synchronized(lock) {
            clientSecret = secretBytes
            clientPubkey = pubkey
            sessionRelays = validRelays
            pairingSecret = secret
            pairingResult = CompletableDeferred()
            sessionPermissions = permissions.toList()
            sessionName = label
            sessionUrl = url
            closed.set(false)
        }
        validRelays.forEach(::openRelay)
        try {
            withTimeout(RELAY_CONNECT_TIMEOUT_MILLIS) { relayReady.await() }
        } catch (error: Exception) {
            reset()
            if (error is CancellationException) throw error
            throw Nip46Exception("Could not connect to a NIP-46 relay", error)
        }
        Nip46Pairing(uri, pubkey, secretBytes.toHex(), validRelays)
    }

    /** Authenticates the phone's signed response using the QR secret, then completes connect and key lookup. */
    suspend fun awaitConnected(timeoutMillis: Long = HANDSHAKE_TIMEOUT_MILLIS): Nip46Connection {
        val response = pairingResult ?: throw Nip46Exception("Start NIP-46 pairing first")
        val secret = pairingSecret ?: throw Nip46Exception("Pairing secret is missing")
        val remote = withTimeout(timeoutMillis) { response.await() }
        synchronized(lock) { remoteSignerPubkey = remote }
        // Complete the NIP-46 connect RPC, then request the user key. The remote signer key may differ.
        val metadata = JSONObject().put("name", sessionName)
        sessionUrl?.let { metadata.put("url", it) }
        val connectParams = JSONArray().put(remote).put(secret).put(sessionPermissions.joinToString(","))
            .put(metadata.toString())
        val connect = request("connect", connectParams)
        if (connect != "ack" && connect != secret) throw Nip46Exception("Remote signer did not acknowledge connect")
        val user = normalizeHex(request("get_public_key", JSONArray()))
        synchronized(lock) { userPubkey = user }
        return Nip46Connection(remote, user, sessionRelays)
    }

    /** Reopens the persisted session. Only the client secret belongs in encrypted storage. */
    suspend fun restore(
        clientSecretHex: String,
        remoteSignerPubkey: String,
        relays: List<String>,
        userPubkey: String,
    ) = withContext(Dispatchers.IO) {
        reset()
        val secret = parseSecret(clientSecretHex)
        val remote = normalizeHex(remoteSignerPubkey)
        val user = normalizeHex(userPubkey)
        val validRelays = relays.map(String::trim).filter(::isRelayUrl).distinct()
        require(validRelays.isNotEmpty()) { "No valid NIP-46 relay URLs are saved" }
        synchronized(lock) {
            clientSecret = secret
            clientPubkey = NostrCrypto.publicKeyHex(secret)
            this@Nip46Service.remoteSignerPubkey = remote
            this@Nip46Service.userPubkey = user
            sessionRelays = validRelays
            sessionPermissions = DEFAULT_PERMISSIONS
            sessionName = "Bookstr TV"
            sessionUrl = null
            closed.set(false)
        }
        validRelays.forEach(::openRelay)
        try {
            withTimeout(RELAY_CONNECT_TIMEOUT_MILLIS) { relayReady.await() }
        } catch (error: Exception) {
            reset()
            if (error is CancellationException) throw error
            throw Nip46Exception("Could not restore NIP-46 relay connection", error)
        }
    }

    fun currentConnection(): Nip46Connection? = synchronized(lock) {
        val remote = remoteSignerPubkey ?: return@synchronized null
        val user = userPubkey ?: return@synchronized null
        Nip46Connection(remote, user, sessionRelays)
    }

    /** True only after a WebSocket opened in the current session and before it closes. */
    fun hasRelayTransport(): Boolean = !closed.get() && openRelays.isNotEmpty()

    suspend fun signEvent(unsigned: JSONObject): JSONObject {
        val user = userPubkey ?: throw Nip46Exception("NIP-46 signer is not connected")
        val requested = JSONObject(unsigned.toString())
        requested.remove("id"); requested.remove("pubkey"); requested.remove("sig")
        val signed = try { JSONObject(request("sign_event", JSONArray().put(requested.toString()))) }
        catch (error: Exception) {
            if (error is CancellationException) throw error
            throw Nip46Exception("Remote signer returned an invalid event", error)
        }
        require(signed.optString("pubkey").equals(user, true)) { "Remote signer signed with a different account" }
        require(NostrCrypto.verifyEvent(signed)) { "Remote signer returned an invalid event signature" }
        for (field in listOf("created_at", "kind", "content")) {
            require(signed.opt(field).toString() == requested.opt(field).toString()) { "Remote signer changed event $field" }
        }
        require(signed.optJSONArray("tags")?.toString() == requested.optJSONArray("tags")?.toString()) {
            "Remote signer changed event tags"
        }
        return signed
    }

    suspend fun nip44Encrypt(plaintext: String, otherPubkeyHex: String): String =
        request("nip44_encrypt", JSONArray().put(normalizeHex(otherPubkeyHex)).put(plaintext))

    suspend fun nip44Decrypt(ciphertext: String, otherPubkeyHex: String): String =
        request("nip44_decrypt", JSONArray().put(normalizeHex(otherPubkeyHex)).put(ciphertext))

    suspend fun disconnect(logout: Boolean = false) {
        if (logout && remoteSignerPubkey != null && !closed.get()) runCatching { request("logout", JSONArray()) }
        resetSession()
    }

    /** Synchronously drops transport and wipes the in-memory client secret, for identity changes/logout. */
    fun resetSession() = reset()

    private suspend fun request(method: String, params: JSONArray): String {
        val secret = clientSecret ?: throw Nip46Exception("NIP-46 signer is not connected")
        val remote = remoteSignerPubkey ?: throw Nip46Exception("NIP-46 signer is not connected")
        if (closed.get()) throw Nip46Exception("NIP-46 session is closed")
        val requestId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<String>()
        pending[requestId] = Pending(deferred)
        try {
            val content = Nip44.encrypt(secret, remote, JSONObject().put("id", requestId).put("method", method).put("params", params).toString())
            val unsigned = JSONObject()
                .put("kind", KIND_NOSTR_CONNECT)
                .put("created_at", System.currentTimeMillis() / 1000)
                .put("tags", JSONArray().put(JSONArray().put("p").put(remote)))
                .put("content", content)
            val signed = NostrCrypto.signEvent(secret, unsigned)
            val relayMessage = JSONArray().put("EVENT").put(signed).toString()
            withTimeout(REQUEST_TIMEOUT_MILLIS) { relayReady.await() }
            val sends = sockets.values.map { it.send(relayMessage) }
            if (sends.none { it }) throw Nip46Exception("No NIP-46 relay is connected")
            val response = withTimeout(REQUEST_TIMEOUT_MILLIS) { deferred.await() }
            return response
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            throw if (error is Nip46Exception) error else Nip46Exception("NIP-46 $method request failed", error)
        } finally {
            pending.remove(requestId)
        }
    }

    private fun openRelay(relay: String) {
        val pubkey = clientPubkey ?: return
        val generation = sessionGeneration.get()
        val request = Request.Builder().url(relay).build()
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (generation != sessionGeneration.get() || closed.get()) {
                    webSocket.cancel()
                    return
                }
                sockets[relay] = webSocket
                openRelays.add(relay)
                webSocket.send(JSONArray().put("REQ").put("bookstr-nip46").put(
                    JSONObject().put("kinds", JSONArray().put(KIND_NOSTR_CONNECT)).put("#p", JSONArray().put(pubkey)),
                ).toString())
                relayReady.complete(Unit)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (generation != sessionGeneration.get() || closed.get()) return
                runCatching {
                    val message = JSONArray(text)
                    if (message.optString(0) == "EVENT" && message.length() >= 3) handleEvent(message.getJSONObject(2))
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                if (generation == sessionGeneration.get() && !closed.get()) webSocket.close(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (generation == sessionGeneration.get()) {
                    sockets.remove(relay, webSocket)
                    openRelays.remove(relay)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (generation == sessionGeneration.get()) {
                    sockets.remove(relay, webSocket)
                    openRelays.remove(relay)
                }
            }
        })
        if (generation == sessionGeneration.get() && !closed.get()) sockets[relay] = socket else socket.cancel()
    }

    private fun handleEvent(event: JSONObject) {
        try {
            require(event.optInt("kind") == KIND_NOSTR_CONNECT && NostrCrypto.verifyEvent(event))
            val eventId = event.getString("id")
            val author = normalizeHex(event.getString("pubkey"))
            val recipient = event.optJSONArray("tags")?.let(::pTag) ?: return
            if (recipient != clientPubkey) return
            val secret = clientSecret ?: return
            val expectedRemote = remoteSignerPubkey
            if (expectedRemote != null && author != expectedRemote) return
            val message = JSONObject(Nip44.decrypt(secret, author, event.getString("content")))
            val id = message.optString("id")
            if (expectedRemote == null) {
                if (message.optString("result") == pairingSecret && pairingResult?.isCompleted == false) {
                    if (!rememberEvent(eventId)) return
                    pairingResult?.complete(author)
                }
                return
            }
            val deferred = pending[id]?.result ?: return
            if (!rememberEvent(eventId)) return
            if (message.optString("result") == "auth_url") {
                message.optString("error").takeIf(::isHttpUrl)?.let(onAuthChallenge)
                return // signer will send a second response using the same id
            }
            if (message.has("error") && !message.isNull("error")) {
                deferred.completeExceptionally(Nip46Exception(message.optString("error")))
            } else if (message.has("result") && !message.isNull("result")) {
                deferred.complete(message.opt("result").toString())
            }
        } catch (_: Exception) {
            // Ignore malformed, invalid-signature, wrongly addressed, or undecryptable relay events.
        }
    }

    private fun reset() {
        sessionGeneration.incrementAndGet()
        closed.set(true)
        sockets.values.forEach(WebSocket::cancel)
        sockets.clear()
        openRelays.clear()
        relayReady.cancel()
        relayReady = CompletableDeferred()
        pending.values.forEach { it.result.cancel() }
        pending.clear()
        synchronized(seenEvents) { seenEvents.clear() }
        synchronized(lock) {
            clientSecret?.fill(0)
            clientSecret = null; clientPubkey = null; remoteSignerPubkey = null; userPubkey = null
            sessionRelays = emptyList(); pairingSecret = null; pairingResult?.cancel(); pairingResult = null
            sessionPermissions = DEFAULT_PERMISSIONS; sessionName = "Bookstr TV"; sessionUrl = null
        }
    }

    private fun rememberEvent(id: String): Boolean = synchronized(seenEvents) {
        if (seenEvents.containsKey(id)) return@synchronized false
        seenEvents[id] = Unit
        if (seenEvents.size > MAX_SEEN_EVENTS) {
            val oldest = seenEvents.keys.iterator()
            if (oldest.hasNext()) {
                oldest.next()
                oldest.remove()
            }
        }
        true
    }

    companion object {
        const val KIND_NOSTR_CONNECT = 24133
        const val HANDSHAKE_TIMEOUT_MILLIS = 300_000L
        const val RELAY_CONNECT_TIMEOUT_MILLIS = 15_000L
        const val REQUEST_TIMEOUT_MILLIS = 30_000L
        private const val MAX_SEEN_EVENTS = 1024
        val DEFAULT_PERMISSIONS = listOf("get_public_key", "sign_event", "nip44_encrypt", "nip44_decrypt")

        fun createNostrConnectUri(
            clientPubkey: String,
            relays: List<String>,
            secret: String,
            permissions: List<String> = DEFAULT_PERMISSIONS,
            name: String = "Bookstr TV",
            url: String? = null,
        ): String {
            val key = normalizeHex(clientPubkey)
            require(secret.isNotBlank() && relays.isNotEmpty())
            val pairs = buildList {
                relays.distinct().forEach { add("relay=" + enc(it)) }
                add("secret=" + enc(secret))
                if (permissions.isNotEmpty()) add("perms=" + enc(permissions.joinToString(",")))
                if (name.isNotBlank()) add("name=" + enc(name))
                if (!url.isNullOrBlank()) add("url=" + enc(url))
            }
            return "nostrconnect://$key?${pairs.joinToString("&")}"
        }

        private fun enc(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8.name())
        private fun isHttpUrl(value: String) = value.startsWith("https://") || value.startsWith("http://")
        private fun isRelayUrl(value: String): Boolean = runCatching {
            val uri = java.net.URI(value)
            (uri.scheme == "wss" || uri.scheme == "ws") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null
        }.getOrDefault(false)
        private fun normalizeHex(value: String): String {
            val normalized = value.trim().lowercase()
            require(Regex("[0-9a-f]{64}").matches(normalized)) { "Expected 32-byte hex public key" }
            return normalized
        }
        private fun parseSecret(value: String): ByteArray {
            require(Regex("[0-9a-fA-F]{64}").matches(value)) { "Client secret must be 32-byte hex" }
            return value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        }
        private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
        private fun generateSecretKey(): ByteArray {
            while (true) {
                val candidate = ByteArray(32).also(SecureRandom()::nextBytes)
                if (runCatching { NostrCrypto.publicKeyHex(candidate) }.isSuccess) return candidate
            }
        }
        private fun randomHex(bytes: Int) = ByteArray(bytes).also(SecureRandom()::nextBytes).toHex()
        private fun pTag(tags: JSONArray): String? {
            for (index in 0 until tags.length()) {
                val tag = tags.optJSONArray(index) ?: continue
                if (tag.optString(0) == "p") return tag.optString(1).takeIf(String::isNotBlank)?.lowercase()
            }
            return null
        }
    }
}

data class Nip46Pairing(val uri: String, val clientPubkey: String, val clientSecretHex: String, val relays: List<String>)
data class Nip46Connection(val remoteSignerPubkey: String, val userPubkey: String, val relays: List<String>)

class Nip46Signer(
    private val service: Nip46Service,
    private val userPubkeyHex: String,
) : NostrSigner {
    override fun isConfigured(): Boolean = service.currentConnection()?.userPubkey?.equals(userPubkeyHex, true) == true
    override suspend fun getPublicKey(): String = userPubkeyHex
    override suspend fun signEvent(unsigned: JSONObject): JSONObject = service.signEvent(unsigned)
    override suspend fun nip44Encrypt(plaintext: String, pubkey: String): String = service.nip44Encrypt(plaintext, pubkey)
    override suspend fun nip44Decrypt(ciphertext: String, pubkey: String): String = service.nip44Decrypt(ciphertext, pubkey)
}

class Nip46Exception(message: String, cause: Throwable? = null) : Exception(message, cause)
