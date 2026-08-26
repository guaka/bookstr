package app.bookstr.nostr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import android.content.Intent

class Nip55Test {
    @Test
    fun normalizeHexPubkey() {
        val hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
        assertEquals(hex, Nip55.normalizePubkey(hex.uppercase()))
    }

    @Test
    fun normalizeNpubPubkey() {
        val npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        val hex = Nip55.normalizePubkey(npub)
        assertEquals("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", hex)
    }

    @Test
    fun libraryPermissionsIncludeProgressAndDecryption() {
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("30078"))
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("sign_event"))
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("nip44_decrypt"))
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("nip44_encrypt"))
        assertTrue(Nip55.LIBRARY_PERMISSIONS.contains("30003"))
    }

    @Test
    fun normalizeNpubWithWhitespaceIsTrimmed() {
        val npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        assertEquals(
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
            Nip55.normalizePubkey("  $npub  "),
        )
    }

    @Test
    fun normalizePubkeyRejectsWrongHexLength() {
        assertThrows(IllegalArgumentException::class.java) {
            Nip55.normalizePubkey("12ab")
        }
    }

    @Test
    fun normalizePubkeyRejectsNonHexCharacters() {
        assertThrows(IllegalArgumentException::class.java) {
            Nip55.normalizePubkey("zz".repeat(32))
        }
    }

    @Test
    fun discoveryIntentUsesNostrSignerScheme() {
        val intent = Nip55.discoveryIntent()

        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("nostrsigner", intent.data?.scheme)
    }

    @Test
    fun getPublicKeyIntentIncludesCustomPermissions() {
        val customPermissions = """[{"type":"custom"}]"""
        val intent = Nip55.getPublicKeyIntent(customPermissions)

        assertEquals(Nip55.TYPE_GET_PUBLIC_KEY, intent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals(customPermissions, intent.getStringExtra(Nip55.EXTRA_PERMISSIONS))
    }

    @Test
    fun signEventIntentOmitsOptionalIdByDefault() {
        val intent = Nip55.signEventIntent("""{"kind":1}""", "deadbeef", "com.example.amber")

        assertEquals(Nip55.TYPE_SIGN_EVENT, intent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals("deadbeef", intent.getStringExtra(Nip55.EXTRA_CURRENT_USER))
        assertEquals("com.example.amber", intent.`package`)
        assertEquals(false, intent.hasExtra(Nip55.EXTRA_ID))
    }

    @Test
    fun signEventIntentIncludesProvidedIdWhenGiven() {
        val intent = Nip55.signEventIntent(
            """{"kind":1}""",
            "deadbeef",
            "com.example.amber",
            id = "abc123",
        )

        assertEquals("abc123", intent.getStringExtra(Nip55.EXTRA_ID))
        assertEquals("com.example.amber", intent.`package`)
    }

    @Test
    fun nip44DecryptIntentIncludesSignerCredentials() {
        val intent = Nip55.nip44DecryptIntent(
            ciphertext = "ciphertext-value",
            otherPubkeyHex = "a1".repeat(32),
            currentUserHex = "b2".repeat(32),
            signerPackage = "com.example.amber",
        )

        assertEquals(Nip55.TYPE_NIP44_DECRYPT, intent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals("a1".repeat(32), intent.getStringExtra(Nip55.EXTRA_PUBKEY))
        assertEquals("b2".repeat(32), intent.getStringExtra(Nip55.EXTRA_CURRENT_USER))
        assertEquals("com.example.amber", intent.`package`)
    }

    @Test
    fun nip44EncryptIntentIncludesSignerCredentials() {
        val intent = Nip55.nip44EncryptIntent(
            plaintext = "plain-text",
            otherPubkeyHex = "c3".repeat(32),
            currentUserHex = "d4".repeat(32),
            signerPackage = "com.example.amber",
        )

        assertEquals(Nip55.TYPE_NIP44_ENCRYPT, intent.getStringExtra(Nip55.EXTRA_TYPE))
        assertEquals("c3".repeat(32), intent.getStringExtra(Nip55.EXTRA_PUBKEY))
        assertEquals("d4".repeat(32), intent.getStringExtra(Nip55.EXTRA_CURRENT_USER))
        assertEquals("com.example.amber", intent.`package`)
    }
}
