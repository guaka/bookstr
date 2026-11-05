package app.bookstr.nostr

import kotlinx.coroutines.runBlocking
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class NostrClientSocketCoverageTest {
    @Test
    fun publishEventSendsNostrEnvelopeAndReportsAcceptanceAcrossRelays() = runBlocking {
        val rejectedRelay = scriptedRelay(listOf("""["OK","event-id",false,"blocked"]"""))
        val acceptedRelay = scriptedRelay(listOf("""["OK","event-id",true,""]"""))
        try {
            val event = JSONObject().put("id", "event-id").put("kind", 1)
            assertTrue(NostrClient(listOf(rejectedRelay.url, acceptedRelay.url)).publishEvent(event))

            val rejectedPayload = JSONArray(rejectedRelay.awaitRequest())
            val acceptedPayload = JSONArray(acceptedRelay.awaitRequest())
            assertEquals("EVENT", rejectedPayload.getString(0))
            assertEquals("EVENT", acceptedPayload.getString(0))
            assertEquals(event.toString(), rejectedPayload.getJSONObject(1).toString())
            assertEquals(event.toString(), acceptedPayload.getJSONObject(1).toString())
        } finally {
            rejectedRelay.close()
            acceptedRelay.close()
        }
    }

    @Test
    fun publishEventReturnsFalseWhenEveryRelayRejectsOrNoRelaysExist() = runBlocking {
        val relay = scriptedRelay(listOf("""["OK","event-id",false,"blocked"]"""))
        try {
            assertFalse(NostrClient(listOf(relay.url)).publishEvent(JSONObject().put("id", "event-id")))
            relay.awaitRequest()
            assertFalse(NostrClient(emptyList()).publishEvent(JSONObject()))
        } finally {
            relay.close()
        }
    }

    @Test
    fun fetchLatestProgressBuildsFilterAndReturnsRelayEvent() = runBlocking {
        val event = JSONObject().put("id", "progress-id").put("kind", NostrClient.KIND_PROGRESS)
        val relay = scriptedRelay(listOf(JSONArray().put("EVENT").put("bookstr-progress").put(event).toString()))
        try {
            val actual = NostrClient(listOf(relay.url)).fetchLatestProgress("author-key", "book-id")
            assertNotNull(actual)
            assertEquals(event.toString(), actual.toString())

            val request = JSONArray(relay.awaitRequest())
            assertEquals("REQ", request.getString(0))
            assertEquals("bookstr-progress", request.getString(1))
            val filter = request.getJSONObject(2)
            assertEquals(NostrClient.KIND_PROGRESS, filter.getJSONArray("kinds").getInt(0))
            assertEquals("author-key", filter.getJSONArray("authors").getString(0))
            assertEquals(NostrClient.progressDTag("book-id"), filter.getJSONArray("#d").getString(0))
            assertEquals(1, filter.getInt("limit"))
        } finally {
            relay.close()
        }
    }

    @Test
    fun fetchLatestProgressReturnsNullOnEoseAndSkipsMalformedRelayFrames() = runBlocking {
        val relay = scriptedRelay(listOf("not-json", """["EOSE","bookstr-progress"]"""))
        try {
            assertEquals(null, NostrClient(listOf(relay.url)).fetchLatestProgress("author-key", "book-id"))
            assertEquals("REQ", JSONArray(relay.awaitRequest()).getString(0))
        } finally {
            relay.close()
        }
    }

    @Test
    fun fetchVocabularyKeepsOnlyPrefixedDTagsAndDeduplicatesByEventId() = runBlocking {
        val duplicateFirst = vocabularyEvent("same-id", "${NostrClient.VOCABULARY_D_PREFIX}book-a", "first")
        val duplicateLast = vocabularyEvent("same-id", "${NostrClient.VOCABULARY_D_PREFIX}book-b", "last")
        val unrelated = vocabularyEvent("other-id", "unrelated", "skip")
        val relay = scriptedRelay(
            listOf(
                JSONArray().put("EVENT").put("vocab-sub").put(duplicateFirst).toString(),
                JSONArray().put("EVENT").put("vocab-sub").put(unrelated).toString(),
                JSONArray().put("EVENT").put("vocab-sub").put(duplicateLast).toString(),
                """["EOSE","vocab-sub"]""",
            ),
        )
        try {
            val results = NostrClient(listOf(relay.url)).fetchVocabulary("author-key")
            assertEquals(1, results.size)
            assertEquals("last", results.single().getString("content"))
            val request = JSONArray(relay.awaitRequest())
            assertEquals("REQ", request.getString(0))
            assertEquals("bookstr-vocabulary", request.getString(1))
            assertEquals(NostrClient.KIND_PROGRESS, request.getJSONObject(2).getJSONArray("kinds").getInt(0))
        } finally {
            relay.close()
        }
    }

    private fun vocabularyEvent(id: String, dTag: String, content: String) =
        JSONObject().put("id", id).put("tags", JSONArray().put(JSONArray().put("d").put(dTag))).put("content", content)

    private fun scriptedRelay(replies: List<String>): ScriptedRelay {
        val server = MockWebServer()
        val requestText = AtomicReference<String?>(null)
        val requestReceived = CountDownLatch(1)
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        requestText.set(text)
                        requestReceived.countDown()
                        replies.forEach { reply -> webSocket.send(reply) }
                    }
                },
            ),
        )
        server.start()
        val wsUrl = server.url("/").toString().replaceFirst("http", "ws")
        return ScriptedRelay(server, wsUrl, requestText, requestReceived)
    }

    private class ScriptedRelay(
        private val server: MockWebServer,
        val url: String,
        private val requestText: AtomicReference<String?>,
        private val requestReceived: CountDownLatch,
    ) {
        fun awaitRequest(): String {
            assertTrue("NostrClient did not send a relay request", requestReceived.await(3, TimeUnit.SECONDS))
            return requireNotNull(requestText.get())
        }

        fun close() = server.shutdown()
    }
}
