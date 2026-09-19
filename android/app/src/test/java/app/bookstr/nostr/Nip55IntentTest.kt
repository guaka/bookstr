package app.bookstr.nostr

import android.app.Activity
import android.app.Application
import android.content.Intent
import org.robolectric.RuntimeEnvironment
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class Nip55IntentTest {
    @Test fun routesAllOperationsToSelectedProviderAndAcceptsSignatureOnlyResults() {
        val key = "a".repeat(64); val pkg = "app.huddle.fixture"
        val encrypt = Nip55.nip44EncryptIntent("hello", key, key, pkg)
        assertEquals(pkg, encrypt.`package`); assertEquals("nip44_encrypt", encrypt.getStringExtra("type"))
        assertEquals("hello", encrypt.data?.schemeSpecificPart)
        val decrypt = Nip55.nip44DecryptIntent("encrypted", key, key, pkg)
        assertEquals(pkg, decrypt.`package`); assertEquals("nip44_decrypt", decrypt.getStringExtra("type"))
        val event = """{"id":"request"}"""
        val sign = Nip55.signEventIntent(event, key, pkg, "r")
        assertEquals(pkg, sign.`package`); assertEquals("r", sign.getStringExtra("id"))
        val result = Nip55.parseSignEventResult(Activity.RESULT_OK, Intent().putExtra("result", "b".repeat(128)), event)
        assertEquals("b".repeat(128), result.getString("sig")); assertEquals("request", result.getString("id"))
        assertEquals("request", Nip55.parseSignEventResult(Activity.RESULT_OK, Intent().putExtra("event", event)).getString("id"))
        assertEquals(key to pkg, Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, Intent().putExtra("result", key).putExtra("package", pkg)))
        assertEquals("plain", Nip55.parseNip44DecryptResult(Activity.RESULT_OK, Intent().putExtra("result", "plain")))
        assertEquals("encrypted", Nip55.parseNip44EncryptResult(Activity.RESULT_OK, Intent().putExtra("result", "encrypted")))
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("\"kind\":13"))
    }
    @Test fun rejectionMissingDataAndUnavailableProviderAreRecoverable() {
        val parsers: List<(Int, Intent?) -> Any> = listOf(Nip55::parseGetPublicKeyResult, { code, data -> Nip55.parseSignEventResult(code, data) }, Nip55::parseNip44DecryptResult, Nip55::parseNip44EncryptResult)
        for (parse in parsers) {
            assertThrows(Nip55Exception::class.java) { parse(Activity.RESULT_CANCELED, Intent()) }
            assertThrows(Nip55Exception::class.java) { parse(Activity.RESULT_OK, Intent().putExtra("rejected", true)) }
            assertThrows(Nip55Exception::class.java) { parse(Activity.RESULT_OK, null) }
        }
        val context = RuntimeEnvironment.getApplication()
        assertFalse(Nip55.isSignerAvailable(context))
        assertEquals("External signer", Nip55.signerLabel(context, null))
        assertEquals("absent.signer", Nip55.signerLabel(context, "absent.signer"))
        assertNull(Nip55.encryptNip44ViaContentResolver(context, "absent.signer", "hello", "a", "a"))
        assertNull(Nip55.decryptNip44ViaContentResolver(context, "absent.signer", "hello", "a", "a"))
        assertNull(Nip55.signEventViaContentResolver(context, "absent.signer", "{}", "a"))
    }
}
