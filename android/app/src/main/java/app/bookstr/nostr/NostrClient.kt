package app.bookstr.nostr

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import app.bookstr.data.BookRights
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class NostrClient(
    private val relays: List<String>,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun publishEvent(signedEvent: JSONObject): Boolean = withContext(Dispatchers.IO) {
        val payload = JSONArray().put("EVENT").put(signedEvent).toString()
        var anySuccess = false
        for (relay in relays) {
            val ok = sendOnce(relay, payload)
            anySuccess = anySuccess || ok
        }
        anySuccess
    }

    suspend fun fetchLatestProgress(pubkey: String, bookId: String): JSONObject? =
        withContext(Dispatchers.IO) {
            val dTag = progressDTag(bookId)
            val filter = JSONObject()
                .put("kinds", JSONArray().put(KIND_PROGRESS))
                .put("authors", JSONArray().put(pubkey))
                .put("#d", JSONArray().put(dTag))
                .put("limit", 1)

            val subscription = JSONArray()
                .put("REQ")
                .put("bookstr-progress")
                .put(filter)

            for (relay in relays) {
                val event = queryRelay(relay, subscription.toString())
                if (event != null) return@withContext event
            }
            null
        }

    suspend fun fetchLatestFavorites(pubkey: String): JSONObject? =
        fetchLatestAddressableEvent(pubkey, FAVORITES_D_TAG, "bookstr-favorites")

    suspend fun fetchLatestAddressableEvent(
        pubkey: String,
        dTag: String,
        subscriptionName: String = "bookstr-addressable",
    ): JSONObject? =
        withContext(Dispatchers.IO) {
            val taggedFilter = JSONObject()
                .put("kinds", JSONArray().put(KIND_FAVORITES))
                .put("authors", JSONArray().put(pubkey))
                .put("#d", JSONArray().put(dTag))
                .put("limit", 1)

            val taggedSubscription = JSONArray()
                .put("REQ")
                .put(subscriptionName)
                .put(taggedFilter)

            var latest: JSONObject? = null
            val combinedRelays = (relays + DEFAULT_INTEROP_RELAY).distinct()
            for (relay in combinedRelays) {
                val event = queryRelay(relay, taggedSubscription.toString()) ?: continue
                if (latest == null || event.optLong("created_at") > latest.optLong("created_at")) {
                    latest = event
                }
            }
            if (latest != null) return@withContext latest

            // Some relays store the parameterized replaceable event but do not implement #d
            // filtering correctly. Match the iOS/web-compatible fallback by filtering locally.
            val broadFilter = JSONObject()
                .put("kinds", JSONArray().put(KIND_FAVORITES))
                .put("authors", JSONArray().put(pubkey))
                .put("limit", 50)
            val broadSubscription = JSONArray()
                .put("REQ")
                .put("$subscriptionName-all")
                .put(broadFilter)
                .toString()
            for (relay in combinedRelays) {
                queryRelayAll(relay, broadSubscription)
                    .filter { hasDTag(it, dTag) }
                    .forEach { event ->
                        if (latest == null || event.optLong("created_at") > latest!!.optLong("created_at")) {
                            latest = event
                        }
                    }
            }
            latest
        }

    private fun hasDTag(event: JSONObject, dTag: String): Boolean {
        val tags = event.optJSONArray("tags") ?: return false
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) == "d" && tag.optString(1) == dTag) return true
        }
        return false
    }

    suspend fun fetchVocabulary(pubkey: String): List<JSONObject> = withContext(Dispatchers.IO) {
        val filter = JSONObject()
            .put("kinds", JSONArray().put(KIND_PROGRESS))
            .put("authors", JSONArray().put(pubkey))
        val subscription = JSONArray().put("REQ").put("bookstr-vocabulary").put(filter).toString()
        val events = linkedMapOf<String, JSONObject>()
        for (relay in relays) {
            queryRelayAll(relay, subscription).forEach { event ->
                val d = event.optJSONArray("tags")?.let { tags ->
                    (0 until tags.length()).mapNotNull { tags.optJSONArray(it) }
                        .firstOrNull { it.optString(0) == "d" }?.optString(1)
                }
                if (d?.startsWith(VOCABULARY_D_PREFIX) == true) {
                    events[event.optString("id", "$relay:$d")] = event
                }
            }
        }
        events.values.toList()
    }

    private fun queryRelay(relayUrl: String, message: String): JSONObject? {
        val result = AtomicReference<JSONObject?>(null)
        val latch = CountDownLatch(1)
        val request = Request.Builder().url(relayUrl).build()

        val ws = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(message)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val arr = JSONArray(text)
                        if (arr.length() >= 3 && arr.getString(0) == "EVENT") {
                            result.set(arr.getJSONObject(2))
                            latch.countDown()
                            webSocket.close(1000, "done")
                        } else if (arr.length() >= 2 && arr.getString(0) == "EOSE") {
                            latch.countDown()
                            webSocket.close(1000, "done")
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Relay parse error on $relayUrl", e)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.w(TAG, "Relay query failed on $relayUrl", t)
                    latch.countDown()
                }
            },
        )

        latch.await(8, TimeUnit.SECONDS)
        ws.cancel()
        return result.get()
    }

    private fun queryRelayAll(relayUrl: String, message: String): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        val latch = CountDownLatch(1)
        val request = Request.Builder().url(relayUrl).build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send(message) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val arr = JSONArray(text)
                    when (arr.optString(0)) {
                        "EVENT" -> if (arr.length() >= 3) synchronized(result) { result += arr.getJSONObject(2) }
                        "EOSE" -> {
                            latch.countDown()
                            webSocket.close(1000, "done")
                        }
                    }
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                latch.countDown()
            }
        })
        latch.await(8, TimeUnit.SECONDS)
        ws.cancel()
        return synchronized(result) { result.toList() }
    }

    private fun sendOnce(relayUrl: String, message: String): Boolean {
        val latch = CountDownLatch(1)
        val accepted = AtomicReference(false)
        val request = Request.Builder().url(relayUrl).build()

        val ws = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(message)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val arr = JSONArray(text)
                        if (arr.length() >= 3 && arr.getString(0) == "OK") {
                            accepted.set(arr.getBoolean(2))
                            latch.countDown()
                            webSocket.close(1000, "done")
                        }
                    } catch (_: Exception) {
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    latch.countDown()
                }
            },
        )

        latch.await(8, TimeUnit.SECONDS)
        ws.cancel()
        return accepted.get()
    }

    companion object {
        private const val TAG = "NostrClient"
        const val KIND_PROGRESS = 30078
        const val KIND_FAVORITES = 30003
        const val FAVORITES_D_TAG = "libvault-favorites"
        const val DEFAULT_INTEROP_RELAY = "wss://relay.nomadwiki.org"
        const val VOCABULARY_D_PREFIX = "app.bookstr.vocabulary."

        fun progressDTag(bookId: String): String = "app.bookstr.progress.$bookId"

        fun progressContent(
            bookId: String,
            progression: Double,
            cfi: String,
            furthestProgression: Double = progression,
            title: String? = null,
            author: String? = null,
            rights: BookRights = BookRights(),
            updatedAt: Long = System.currentTimeMillis(),
        ): String {
            val locator = JSONObject()
                .put("progression", progression)
                .put("cfi", cfi)
                .put("furthestProgression", maxOf(progression, furthestProgression))
            val obj = JSONObject()
                .put("v", 2)
                .put("bookId", bookId)
                .put("locator", locator)
                .put("updatedAt", updatedAt)
            if (!title.isNullOrBlank()) obj.put("title", title)
            if (!author.isNullOrBlank()) obj.put("author", author)
            obj.put("rights_status", rights.status)
            if (!rights.license.isNullOrBlank()) obj.put("license", rights.license)
            if (!rights.licenseUrl.isNullOrBlank()) obj.put("license_url", rights.licenseUrl)
            if (!rights.source.isNullOrBlank()) obj.put("rights_source", rights.source)
            return obj.toString()
        }

        /** Parse web-compatible payload; also accept legacy {progression,cfi} events. */
        fun parseProgressContent(content: String, fallbackBookId: String): Triple<String, Double, String>? {
            return try {
                val json = JSONObject(content)
                val locator = json.optJSONObject("locator")
                if (json.has("locator") && locator == null) return null
                when {
                    locator != null -> {
                        val bookId = json.optString("bookId", fallbackBookId).ifBlank { fallbackBookId }
                        Triple(
                            bookId,
                            locator.optDouble("progression", 0.0),
                            (locator.opt("cfi") as? String).orEmpty(),
                        )
                    }
                    json.has("progression") -> {
                        Triple(
                            fallbackBookId,
                            json.optDouble("progression", 0.0),
                            (json.opt("cfi") as? String).orEmpty(),
                        )
                    }
                    else -> null
                }
            } catch (_: Exception) {
                null
            }
        }

        fun parseFurthestProgression(content: String, fallback: Double): Double = try {
            val json = JSONObject(content)
            val locator = json.optJSONObject("locator")
            val raw = locator?.opt("furthestProgression") ?: json.opt("furthestProgression")
            val parsed = when (raw) {
                is Number -> raw.toDouble()
                is String -> raw.toDoubleOrNull()
                else -> null
            } ?: fallback
            maxOf(fallback, parsed)
        } catch (_: Exception) {
            fallback
        }

        fun parseUpdatedAt(content: String, eventCreatedAtSec: Long): Long {
            return try {
                val json = JSONObject(content)
                val fromPayload = when (val raw = json.opt("updatedAt")) {
                    is Number -> raw.toLong()
                    is String -> raw.toDoubleOrNull()?.toLong()
                    else -> null
                } ?: 0L
                if (fromPayload > 0L) fromPayload else eventCreatedAtSec * 1000
            } catch (_: Exception) {
                eventCreatedAtSec * 1000
            }
        }
    }
}
