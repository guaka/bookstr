package app.bookstr.nostr

import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PrivateCatalogClientTest {
    private fun signer(n: Int) = EphemeralSigner(ByteArray(32).also { it[31] = n.toByte() })
    private fun exercise(mode: String) = runBlocking<Unit> {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverCerts = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientCerts = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        val http = OkHttpClient.Builder().sslSocketFactory(clientCerts.sslSocketFactory(), clientCerts.trustManager).build()
        val server = MockWebServer(); server.useHttps(serverCerts.sslSocketFactory(), false)
        val user = signer(1); val catalog = signer(2)
        var request = ""
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(socket: WebSocket, text: String) {
                val frame = JSONArray(text)
                when (frame.getString(0)) {
                    "REQ" -> {
                        request = frame.getString(1)
                        socket.send(JSONArray().put(if (mode == "closed") "CLOSED" else "EOSE").put(request).toString())
                    }
                    "EVENT" -> {
                        if (mode == "timeout") return
                        if (mode == "rejected") { socket.send(JSONArray().put("OK").put(frame.getJSONObject(1).getString("id")).put(false).toString()); return }
                        val payload = JSONObject().put("type", "libcat.search.result").put("request_id", request).put("books", JSONArray())
                        if (mode == "error") payload.put("error", "Unavailable")
                        val response = runBlocking { PrivateCatalogWire.wrap(payload, CatalogService(user.getPublicKey()), catalog, 1000) }
                        socket.send("invalid frame")
                        socket.send(JSONArray().put("EVENT").put("wrong-subscription").put(response).toString())
                        socket.send(JSONArray().put("EVENT").put(request).put(response).toString())
                    }
                }
            }
        }))
        server.start()
        try {
            val service = CatalogService(catalog.getPublicKey(), server.url("/").toString().replace("https:", "wss:"))
            val client = PrivateCatalogClient(http, if (mode == "timeout") 300 else 5000)
            val payload = JSONObject().put("type", "libcat.search").put("query", "fixture")
            if (mode == "success") assertEquals(0, client.request(payload, user, service).getJSONArray("books").length())
            else {
                var failed = false
                try { client.request(payload, user, service) } catch (_: Exception) { failed = true }
                assertTrue(mode, failed)
            }
            assertTrue(request.isNotBlank())
        } finally { server.close(); http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll() }
    }
    @Test fun successfulRequestIgnoresUnrelatedEvents() = exercise("success")
    @Test fun relayRejectionIsActionable() = exercise("rejected")
    @Test fun closedSubscriptionIsActionable() = exercise("closed")
    @Test fun catalogFailureIsActionable() = exercise("error")
    @Test fun requestTimesOut() = exercise("timeout")
}
