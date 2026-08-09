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
                    latch.countDown()
                }
            },
        )

        latch.await(8, TimeUnit.SECONDS)
        ws.cancel()
        return result.get()
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

        fun progressDTag(bookId: String): String = "app.bookstr.progress.$bookId"

        fun progressContent(
            bookId: String,
            progression: Double,
            cfi: String,
            title: String? = null,
            author: String? = null,
            updatedAt: Long = System.currentTimeMillis(),
        ): String {
            val locator = JSONObject()
                .put("progression", progression)
                .put("cfi", cfi)
            val obj = JSONObject()
                .put("v", 1)
                .put("bookId", bookId)
                .put("locator", locator)
                .put("updatedAt", updatedAt)
            if (!title.isNullOrBlank()) obj.put("title", title)
            if (!author.isNullOrBlank()) obj.put("author", author)
            return obj.toString()
        }

        /** Parse web-compatible payload; also accept legacy {progression,cfi} events. */
        fun parseProgressContent(content: String, fallbackBookId: String): Triple<String, Double, String>? {
            return try {
                val json = JSONObject(content)
                val locator = json.optJSONObject("locator")
                when {
                    locator != null -> {
                        val bookId = json.optString("bookId", fallbackBookId).ifBlank { fallbackBookId }
                        Triple(
                            bookId,
                            locator.optDouble("progression", 0.0),
                            locator.optString("cfi", ""),
                        )
                    }
                    json.has("progression") -> {
                        Triple(
                            fallbackBookId,
                            json.optDouble("progression", 0.0),
                            json.optString("cfi", ""),
                        )
                    }
                    else -> null
                }
            } catch (_: Exception) {
                null
            }
        }

        fun parseUpdatedAt(content: String, eventCreatedAtSec: Long): Long {
            return try {
                val json = JSONObject(content)
                val fromPayload = json.optLong("updatedAt", 0L)
                if (fromPayload > 0L) fromPayload else eventCreatedAtSec * 1000
            } catch (_: Exception) {
                eventCreatedAtSec * 1000
            }
        }
    }
}
