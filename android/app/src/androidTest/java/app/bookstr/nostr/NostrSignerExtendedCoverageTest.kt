package app.bookstr.nostr

import android.app.Activity
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertThrows
import kotlin.test.assertTrue

@RunWith(AndroidJUnit4::class)
class NostrSignerExtendedCoverageTest {
    @Test
    fun parseSignEventResultReturnsEventJson() {
        val event = """{"id":"ab"}"""
        val data = Intent().apply { putExtra(Nip55.RESULT_EVENT, event) }

        val parsed = Nip55.parseSignEventResult(Activity.RESULT_OK, data)

        assertEquals("ab", parsed.getString("id"))
    }

    @Test
    fun parseNip44DecryptResultReturnsCiphertext() {
        val data = Intent().apply { putExtra(Nip55.RESULT, "plaintext") }
        val result = Nip55.parseNip44DecryptResult(Activity.RESULT_OK, data)

        assertEquals("plaintext", result)
    }

    @Test
    fun parseNip44EncryptResultReturnsCiphertext() {
        val data = Intent().apply { putExtra(Nip55.RESULT, "ciphertext") }
        val result = Nip55.parseNip44EncryptResult(Activity.RESULT_OK, data)

        assertEquals("ciphertext", result)
    }

    @Test
    fun signEventIntentIncludesPackageAndOptionalId() {
        val base = Nip55.signEventIntent("""{"kind":1}""", "deadbeef", "com.example.amber", id = "evt-1")
        assertEquals("com.example.amber", base.`package`)
        assertEquals("evt-1", base.getStringExtra(Nip55.EXTRA_ID))
        assertEquals(Nip55.TYPE_SIGN_EVENT, base.getStringExtra(Nip55.EXTRA_TYPE))

        val withoutId = Nip55.signEventIntent("""{"kind":1}""", "deadbeef", "com.example.amber")
        assertEquals("com.example.amber", withoutId.`package`)
        assertFalse(withoutId.hasExtra(Nip55.EXTRA_ID))
        assertTrue(withoutId.hasExtra(Nip55.EXTRA_TYPE))
    }

    @Test
    fun parseSignEventRejectsWhenRejected() {
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        kotlin.test.assertFailsWith<Nip55Exception> {
            Nip55.parseSignEventResult(Activity.RESULT_OK, rejected)
        }
    }

    @Test
    fun discoveryIntentUsesNostrSignerScheme() {
        val intent = Nip55.discoveryIntent()

        assertEquals("nostrsigner", intent.action)
    }

    @Test
    fun getPublicKeyIntentIncludesDefaultPermissions() {
        val intent = Nip55.getPublicKeyIntent()

        assertEquals(Nip55.TYPE_GET_PUBLIC_KEY, intent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals(Nip55.LIBRARY_PERMISSIONS, intent.getStringExtra(Nip55.EXTRA_PERMISSIONS))
        assertTrue((intent.getStringExtra(Nip55.EXTRA_PERMISSIONS) ?: "").isNotBlank())
    }

    @Test
    fun nip44IntentsPopulatePayloadAndExtras() {
        val decryptIntent = Nip55.nip44DecryptIntent("cipher", "other", "current", "com.example.amber")
        assertEquals("com.example.amber", decryptIntent.`package`)
        assertEquals(Nip55.TYPE_NIP44_DECRYPT, decryptIntent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals("other", decryptIntent.getStringExtra(Nip55.EXTRA_PUBKEY))
        assertEquals("current", decryptIntent.getStringExtra(Nip55.EXTRA_CURRENT_USER))

        val encryptIntent = Nip55.nip44EncryptIntent("secret", "other", "current", "com.example.amber")
        assertEquals("com.example.amber", encryptIntent.`package`)
        assertEquals(Nip55.TYPE_NIP44_ENCRYPT, encryptIntent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals("other", encryptIntent.getStringExtra(Nip55.EXTRA_PUBKEY))
        assertEquals("current", encryptIntent.getStringExtra(Nip55.EXTRA_CURRENT_USER))
    }

    @Test
    fun normalizePubkeyAcceptsUppercaseHexAndNormalizesToLowercase() {
        val value = "AA".repeat(32)
        val normalized = Nip55.normalizePubkey(value)

        assertEquals("aa".repeat(32), normalized)
    }

    @Test
    fun normalizePubkeyAcceptsNpubInput() {
        val npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"

        val normalized = Nip55.normalizePubkey("  $npub  ")
        assertEquals(64, normalized.length)
        assertEquals(normalized, normalized.lowercase())
    }

    @Test
    fun parseSignEventResultRejectsWrongResultCode() {
        val data = Intent().apply { putExtra(Nip55.RESULT_EVENT, """{"id":"ab"}""") }

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_CANCELED, data)
        }
    }
}
