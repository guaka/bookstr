package app.bookstr.nostr

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Response
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
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

class Nip46ServiceTest {
    @Test fun invitationContainsEncodedRelaySecretAndRequestedScopes() {
        val clientSecret = secret(1)
        val clientPubkey = NostrCrypto.publicKeyHex(clientSecret)
        val invitation = Nip46Service.createNostrConnectUri(
            clientPubkey,
            listOf("wss://relay.example/path?a=b"),
            "secret with spaces",
            listOf("sign_event:30078", "nip44_decrypt"),
            "Bookstr TV",
        )

        assertTrue(invitation.startsWith("nostrconnect://$clientPubkey?"))
        assertTrue(invitation.contains("relay=wss%3A%2F%2Frelay.example%2Fpath%3Fa%3Db"))
        assertTrue(invitation.contains("secret=secret+with+spaces"))
        assertTrue(invitation.contains("perms=sign_event%3A30078%2Cnip44_decrypt"))
        assertTrue(invitation.contains("name=Bookstr+TV"))
    }

    @Test fun phonePairingAuthenticatesHandshakeAndSupportsRemoteNip44AndSigning() = runBlocking {
        val remoteSecret = secret(2)
        val remotePubkey = NostrCrypto.publicKeyHex(remoteSecret)
        val userSecret = secret(3)
        val userPubkey = NostrCrypto.publicKeyHex(userSecret)
        val server = MockWebServer()
        var clientPubkey = ""
        var clientSocket: WebSocket? = null
        val service = Nip46Service(OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build())
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = JSONArray(text)
                when (message.optString(0)) {
                    "REQ" -> {
                        clientSocket = webSocket
                        clientPubkey = message.getJSONObject(2).getJSONArray("#p").getString(0)
                    }
                    "EVENT" -> {
                        val requestEvent = message.getJSONObject(1)
                        if (requestEvent.optString("pubkey") == remotePubkey) {
                            clientSocket?.send(JSONArray().put("EVENT").put(requestEvent).toString())
                            return
                        }
                        val rpc = JSONObject(Nip44.decrypt(remoteSecret, clientPubkey, requestEvent.getString("content")))
                        val method = rpc.getString("method")
                        val result = when (method) {
                            "connect" -> "ack"
                            "get_public_key" -> userPubkey
                            "nip44_encrypt" -> "phone-encrypted"
                            "nip44_decrypt" -> "phone-plaintext"
                            "sign_event" -> {
                                val requested = JSONObject(rpc.getJSONArray("params").getString(0))
                                requested.put("pubkey", userPubkey)
                                NostrCrypto.signEvent(userSecret, requested).toString()
                            }
                            else -> "unsupported"
                        }
                        val response = JSONObject().put("id", rpc.getString("id")).put("result", result)
                        val event = JSONObject()
                            .put("kind", Nip46Service.KIND_NOSTR_CONNECT)
                            .put("created_at", System.currentTimeMillis() / 1000)
                            .put("tags", JSONArray().put(JSONArray().put("p").put(clientPubkey)))
                            .put("content", Nip44.encrypt(remoteSecret, clientPubkey, response.toString()))
                        webSocket.send(JSONArray().put("EVENT").put("bookstr-nip46").put(NostrCrypto.signEvent(remoteSecret, event)).toString())
                    }
                }
            }
        }))
        server.start()
        try {
            val relay = server.url("/").toString().replace("http://", "ws://")
            val pairing = service.startPairing(listOf(relay))
            val invitationSecret = query(pairing.uri, "secret")
            val keyHex = pairing.clientSecretHex
            val pairingReply = JSONObject().put("id", "connect-" + invitationSecret).put("result", invitationSecret)
            // The test relay delivers a malformed signature, then Amber's valid secret-authenticated reply.
            withTimeout(3_000) { while (clientPubkey.isBlank()) delay(10) }
            val phoneResponse = JSONObject()
                .put("kind", Nip46Service.KIND_NOSTR_CONNECT)
                .put("created_at", System.currentTimeMillis() / 1000)
                .put("tags", JSONArray().put(JSONArray().put("p").put(pairing.clientPubkey)))
                .put("content", Nip44.encrypt(remoteSecret, pairing.clientPubkey, pairingReply.toString()))
            val signedResponse = NostrCrypto.signEvent(remoteSecret, phoneResponse)
            val invalidSignature = JSONObject(signedResponse.toString()).put("sig", "0".repeat(128))
            clientSocket!!.send(JSONArray().put("EVENT").put("bookstr-nip46").put(invalidSignature).toString())
            clientSocket!!.send(JSONArray().put("EVENT").put("bookstr-nip46").put(signedResponse).toString())
            val connected = service.awaitConnected()

            assertEquals(remotePubkey, connected.remoteSignerPubkey)
            assertEquals(userPubkey, connected.userPubkey)
            assertEquals("phone-encrypted", service.nip44Encrypt("plaintext", userPubkey))
            assertEquals("phone-plaintext", service.nip44Decrypt("ciphertext", userPubkey))
            val unsigned = JSONObject().put("created_at", 10).put("kind", 30078)
                .put("tags", JSONArray().put(JSONArray().put("d").put("x"))).put("content", "data")
            assertTrue(NostrCrypto.verifyEvent(service.signEvent(unsigned)))
            assertTrue(keyHex.matches(Regex("[0-9a-f]{64}")))
        } finally {
            service.disconnect()
            server.shutdown()
        }
    }

    @Test fun wrongSecretAndUnverifiedResponsesNeverEstablishIdentityAndDisconnectCancelsWait() = runBlocking {
        val server = MockWebServer()
        var pairingPubkey = ""
        var clientSocket: WebSocket? = null
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = JSONArray(text)
                if (message.optString(0) == "REQ") {
                    clientSocket = webSocket
                    pairingPubkey = message.getJSONObject(2).getJSONArray("#p").getString(0)
                }
            }
        }))
        server.start()
        val service = Nip46Service()
        try {
            val relay = server.url("/").toString().replace("http://", "ws://")
            val pairing = service.startPairing(listOf(relay))
            withTimeout(3_000) { while (pairingPubkey.isBlank()) kotlinx.coroutines.delay(10) }
            val responseDeferred = async { runCatching { service.awaitConnected(200) }.exceptionOrNull() }
            val attackerSecret = secret(5)
            val invalid = JSONObject()
                .put("kind", Nip46Service.KIND_NOSTR_CONNECT)
                .put("created_at", System.currentTimeMillis() / 1000)
                .put("tags", JSONArray().put(JSONArray().put("p").put(pairingPubkey)))
                .put("content", Nip44.encrypt(attackerSecret, pairingPubkey, JSONObject().put("result", "not-the-secret").toString()))
            // Correct encryption recipient but wrong authenticated secret must not complete handshake.
            // Deliver a well-signed response encrypted to the client but carrying the wrong QR secret.
            clientSocket!!.send(JSONArray().put("EVENT").put("bookstr-nip46").put(NostrCrypto.signEvent(attackerSecret, invalid)).toString())
            val result = responseDeferred.await()
            assertNotNull(result)
            assertFalse(service.currentConnection() != null)
            service.disconnect()
        } finally {
            service.disconnect()
            server.shutdown()
        }
    }

    @Test fun resetSessionCancelsPendingPairingAndClearsInMemoryIdentity() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {}))
        server.start()
        val service = Nip46Service()
        try {
            val relay = server.url("/").toString().replace("http://", "ws://")
            service.startPairing(listOf(relay))
            val waiting = async { runCatching { service.awaitConnected() }.exceptionOrNull() }
            delay(30)
            service.resetSession()
            val failure = waiting.await()
            assertNotNull(failure)
            assertTrue(service.currentConnection() == null)
        } finally {
            service.resetSession()
            server.shutdown()
        }
    }

    @Test fun restoredSessionQueuesImmediateRequestAfterRelaySubscription() = runBlocking {
        val clientSecret = secret(6)
        val clientPubkey = NostrCrypto.publicKeyHex(clientSecret)
        val remoteSecret = secret(7)
        val remotePubkey = NostrCrypto.publicKeyHex(remoteSecret)
        val userPubkey = NostrCrypto.publicKeyHex(secret(8))
        val server = MockWebServer()
        var sawSubscription = false
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = JSONArray(text)
                when (frame.optString(0)) {
                    "REQ" -> sawSubscription = true
                    "EVENT" -> {
                        assertTrue("Subscription must precede requests", sawSubscription)
                        val rpc = JSONObject(Nip44.decrypt(remoteSecret, clientPubkey, frame.getJSONObject(1).getString("content")))
                        val response = JSONObject().put("id", rpc.getString("id")).put("result", "restored-result")
                        val reply = JSONObject()
                            .put("kind", Nip46Service.KIND_NOSTR_CONNECT)
                            .put("created_at", System.currentTimeMillis() / 1000)
                            .put("tags", JSONArray().put(JSONArray().put("p").put(clientPubkey)))
                            .put("content", Nip44.encrypt(remoteSecret, clientPubkey, response.toString()))
                        webSocket.send(JSONArray().put("EVENT").put("bookstr-nip46").put(NostrCrypto.signEvent(remoteSecret, reply)).toString())
                    }
                }
            }
        }))
        server.start()
        val service = Nip46Service()
        try {
            val relay = server.url("/").toString().replace("http://", "ws://")
            service.restore(clientSecret.toHex(), remotePubkey, listOf(relay), userPubkey)
            assertEquals("restored-result", service.nip44Encrypt("text", userPubkey))
        } finally {
            service.resetSession()
            server.shutdown()
        }
    }

    private fun secret(suffix: Int): ByteArray = ByteArray(32).also { it[31] = suffix.toByte() }

    private fun query(uri: String, name: String): String = uri.substringAfter('?').split('&')
        .mapNotNull { pair -> pair.split('=', limit = 2).takeIf { it.size == 2 && it[0] == name }?.get(1) }
        .first().let { URLDecoder.decode(it, StandardCharsets.UTF_8.name()) }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }
}
