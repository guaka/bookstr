package app.bookstr.nostr

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class Nip46SessionsTest {
    private lateinit var settings: SettingsRepository
    private val clientSecret = "00".repeat(31) + "01"
    private val remoteSecret = ByteArray(32).also { it[31] = 2 }
    private val userSecret = ByteArray(32).also { it[31] = 3 }
    private val user by lazy { NostrCrypto.publicKeyHex(userSecret) }
    private val remote by lazy { NostrCrypto.publicKeyHex(remoteSecret) }
    private val certificate by lazy { HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build() }
    private fun service(): Nip46Service {
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
        return Nip46Service(OkHttpClient.Builder().sslSocketFactory(trust.sslSocketFactory(), trust.trustManager).build())
    }

    @Before fun setUp() {
        settings = SettingsRepository(ApplicationProvider.getApplicationContext<Context>())
        settings.disconnectNostr()
    }

    @After fun tearDown() { settings.disconnectNostr() }

    @Test fun incompleteIdentityAndOtherAuthModesDoNotCreateSessions() {
        assertNull(Nip46Sessions.create(settings))
        settings.authMode = NostrAuthMode.Nip46
        assertNull(Nip46Sessions.create(settings))
        settings.pubkeyHex = user
        assertNull(Nip46Sessions.create(settings))
        Nip46Sessions.forget(null)
        Nip46Sessions.forget("unknown-session")
    }

    @Test fun replacingRetainedSessionInvalidatesOldSignersAndDisconnectRevokesNewOnes() = runBlocking<Unit> {
        settings.connectNip46(clientSecret, remote, user, listOf("wss://relay.example"))
        val first = Nip46Sessions.newService()
        Nip46Sessions.retain(clientSecret.uppercase(), first)
        val old = Nip46Sessions.create(settings)!!
        assertTrue(old.isConfigured())
        assertEquals(user, old.getPublicKey())
        Nip46Sessions.retain(clientSecret, Nip46Sessions.newService())
        assertFalse(old.isConfigured())
        assertThrows(Nip46Exception::class.java) { runBlocking { old.getPublicKey() } }
        val replacement = Nip46Sessions.create(settings)!!
        assertTrue(replacement.isConfigured())
        Nip46Sessions.forget(clientSecret.uppercase())
        assertFalse(replacement.isConfigured())
        assertThrows(Nip46Exception::class.java) { runBlocking { replacement.nip44Decrypt("cipher", user) } }
    }

    @Test fun concurrentRequestsRestoreOneTransportAndReuseItForEncryptionDecryptionAndSigning() = runBlocking {
        val subscriptions = AtomicInteger()
        val server = relay(subscriptions)
        try {
            val url = server.url("/").toString().replace("https://", "wss://")
            settings.connectNip46(clientSecret, remote, user, listOf(url))
            Nip46Sessions.retain(clientSecret, service())
            val first = Nip46Sessions.create(settings)!!
            val second = Nip46Sessions.create(settings)!!
            withTimeout(10_000) {
                val encrypted = async { first.nip44Encrypt("plain", user) }
                val decrypted = async { second.nip44Decrypt("cipher", user) }
                assertEquals("encrypted-by-phone", encrypted.await())
                assertEquals("decrypted-by-phone", decrypted.await())
                val signed = first.signEvent(JSONObject().put("kind", 1).put("created_at", 10)
                    .put("tags", JSONArray()).put("content", "session signing"))
                assertTrue(NostrCrypto.verifyEvent(signed))
                assertEquals(user, signed.getString("pubkey"))
            }
            assertEquals(1, subscriptions.get())
        } finally {
            settings.disconnectNostr()
            server.shutdown()
        }
    }

    @Test fun retainedTransportForDifferentRelayIsRestoredFromPersistedSettings() = runBlocking {
        val subscriptions = AtomicInteger()
        val previous = relay(AtomicInteger())
        val current = relay(subscriptions)
        val service = service()
        try {
            val oldUrl = previous.url("/").toString().replace("https://", "wss://")
            val newUrl = current.url("/").toString().replace("https://", "wss://")
            service.restore(clientSecret, remote, listOf(oldUrl), user)
            settings.connectNip46(clientSecret, remote, user, listOf(newUrl))
            Nip46Sessions.retain(clientSecret, service)
            assertEquals("encrypted-by-phone", withTimeout(10_000) { Nip46Sessions.create(settings)!!.nip44Encrypt("text", user) })
            assertEquals(listOf(newUrl), service.currentConnection()!!.relays)
            assertEquals(1, subscriptions.get())
        } finally {
            settings.disconnectNostr()
            service.resetSession()
            previous.shutdown()
            current.shutdown()
        }
    }

    private fun relay(subscriptions: AtomicInteger): MockWebServer = MockWebServer().apply {
        val identity = HandshakeCertificates.Builder().heldCertificate(certificate).build()
        useHttps(identity.sslSocketFactory(), false)
        enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = JSONArray(text)
                if (frame.optString(0) == "REQ") { subscriptions.incrementAndGet(); return }
                if (frame.optString(0) != "EVENT") return
                val client = frame.getJSONObject(1).getString("pubkey")
                val rpc = JSONObject(Nip44.decrypt(remoteSecret, client, frame.getJSONObject(1).getString("content")))
                val result = when (rpc.getString("method")) {
                    "nip44_encrypt" -> "encrypted-by-phone"
                    "nip44_decrypt" -> "decrypted-by-phone"
                    "sign_event" -> NostrCrypto.signEvent(userSecret, JSONObject(rpc.getJSONArray("params").getString(0))
                        .put("pubkey", user)).toString()
                    else -> error("Unexpected method")
                }
                val response = JSONObject().put("id", rpc.getString("id")).put("result", result)
                val event = JSONObject().put("kind", Nip46Service.KIND_NOSTR_CONNECT)
                    .put("created_at", System.currentTimeMillis() / 1000)
                    .put("tags", JSONArray().put(JSONArray().put("p").put(client)))
                    .put("content", Nip44.encrypt(remoteSecret, client, response.toString()))
                webSocket.send(JSONArray().put("EVENT").put("bookstr-nip46").put(NostrCrypto.signEvent(remoteSecret, event)).toString())
            }
        }))
        start()
    }
}
