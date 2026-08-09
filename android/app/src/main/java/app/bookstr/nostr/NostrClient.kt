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

        fun progressContent(progression: Double, cfi: String): String =
            JSONObject()
                .put("progression", progression)
                .put("cfi", cfi)
                .toString()
    }
}
