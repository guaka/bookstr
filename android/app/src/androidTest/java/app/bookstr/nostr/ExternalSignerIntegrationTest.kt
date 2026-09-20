package app.bookstr.nostr

import android.content.ContentResolver
import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.SettingsRepository
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExternalSignerIntegrationTest {
    @Test fun selectedProviderSupportsAuthenticatedSigningAndNip44WithoutExportingPrivateKey() = runBlocking<Unit> {
        val target = ApplicationProvider.getApplicationContext<Context>()
        val provider = FakeNip55ContentProvider().apply { attachInfo(target, null) }
        val context = object : ContextWrapper(target) { override fun getContentResolver() = ContentResolver.wrap(provider) }
        val settings = SettingsRepository(target)
        val originalMode = settings.authMode; val originalKey = settings.pubkeyHex; val originalPackage = settings.signerPackage; val originalNsec = settings.nsec
        try {
            val secret = ByteArray(32).also { it[31] = 1 }
            val pubkey = NostrCrypto.publicKeyHex(secret)
            settings.connectAmber(pubkey, FakeNip55ContentProvider.signerPackage)
            val signer = ExternalSigner(context, settings)
            val event = JSONObject().put("kind", 13).put("created_at", 1).put("tags", JSONArray()).put("content", "seal")
            val signed = NostrCrypto.signEvent(secret, JSONObject(event.toString()))
            FakeNip55ContentProvider.reset()
            FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(FakeNip55ContentProvider.CursorKind.Event, signed.toString())
            assertTrue(NostrCrypto.verifyEvent(signer.signEvent(event)))
            assertEquals("ciphertext", signer.nip44Encrypt("hello", pubkey))
            assertEquals("plaintext", signer.nip44Decrypt("encrypted", pubkey))
            assertNull(settings.nsec)
            FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(FakeNip55ContentProvider.CursorKind.Event, signed.put("content", "tampered").toString())
            try { signer.signEvent(event); fail("Must reject altered event") } catch (_: IllegalArgumentException) { }
            FakeNip55ContentProvider.nip44EncryptResponse = FakeNip55ContentProvider.Response(FakeNip55ContentProvider.CursorKind.Rejected)
            try { signer.nip44Encrypt("hello", pubkey); fail("Must honor rejection") } catch (_: Nip55Exception) { }
            val connection = app.bookstr.data.CatalogConnection.parse("bookstr://catalog?v=1&npub=npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h&name=Test&relay=wss%3A%2F%2Frelay.example")
            settings.catalogConnection = connection
            assertEquals(connection, settings.catalogConnection)
            settings.catalogConnection = null
        } finally {
            settings.authMode = originalMode; settings.pubkeyHex = originalKey; settings.signerPackage = originalPackage; settings.nsec = originalNsec
            FakeNip55ContentProvider.reset()
        }
    }
    @Test fun localSignerNip44RoundTrips() = runBlocking<Unit> {
        val settings = SettingsRepository(ApplicationProvider.getApplicationContext())
        val mode = settings.authMode; val key = settings.pubkeyHex; val pkg = settings.signerPackage; val nsec = settings.nsec
        try {
            val secret = "00".repeat(31) + "01"
            settings.connectNsec(secret, NostrCrypto.publicKeyHex(NostrCrypto.parsePrivateKey(secret)))
            val signer = LocalNsecSigner(settings)
            assertEquals("Private catalog", signer.nip44Decrypt(signer.nip44Encrypt("Private catalog", signer.getPublicKey()), signer.getPublicKey()))
        } finally { settings.authMode = mode; settings.pubkeyHex = key; settings.signerPackage = pkg; settings.nsec = nsec }
    }
}
