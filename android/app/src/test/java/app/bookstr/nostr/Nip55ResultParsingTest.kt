package app.bookstr.nostr

import android.app.Activity
import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class Nip55ResultParsingTest {
    @Test
    fun parseGetPublicKeyResultAcceptsNpubAndNormalizesToHexAndPackage() {
        val result = Intent()
            .putExtra(Nip55.RESULT, "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6")
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        val (pubkey, signerPackage) = Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)

        assertEquals(
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
            pubkey,
        )
        assertEquals("com.example.signer", signerPackage)
    }

    @Test
    fun parseGetPublicKeyResultAcceptsHexPubkeyAndLowercasesIt() {
        val result = Intent()
            .putExtra(Nip55.RESULT, "AA".repeat(32))
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        val (pubkey, _) = Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)

        assertEquals("aa".repeat(32), pubkey)
    }

    @Test
    fun parseGetPublicKeyResultRejectsRejectedResponse() {
        val result = Intent()
            .putExtra(Nip55.RESULT_REJECTED, true)

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsRejectedResponseEvenWithPayload() {
        val result = Intent()
            .putExtra(Nip55.RESULT_REJECTED, true)
            .putExtra(Nip55.RESULT, "AA".repeat(32))
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseGetPublicKeyResultAcceptsNpubWithSurroundingWhitespace() {
        val result = Intent()
            .putExtra(Nip55.RESULT, "   npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6   ")
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        val (pubkey, signerPackage) = Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)

        assertEquals(
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
            pubkey,
        )
        assertEquals("com.example.signer", signerPackage)
    }

    @Test
    fun parseGetPublicKeyResultRejectsNonOkResultCode() {
        val result = Intent().putExtra(Nip55.RESULT, "aaaa")

        val exception = assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_CANCELED, result)
        }
        assertTrue(exception.message.orEmpty().contains("Signer failed to return a public key"))
    }

    @Test
    fun parseGetPublicKeyResultRejectsMissingPayloads() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsMissingPackage() {
        val result = Intent().putExtra(Nip55.RESULT, "AA".repeat(32))

        val exception = assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)
        }
        assertTrue(exception.message.orEmpty().contains("No signer package in response"))
    }

    @Test
    fun parseGetPublicKeyResultRejectsBlankPayload() {
        val result = Intent()
            .putExtra(Nip55.RESULT, "   ")
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        assertThrows(IllegalArgumentException::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsMalformedPubkey() {
        val result = Intent()
            .putExtra(Nip55.RESULT, "not-a-key")
            .putExtra(Nip55.RESULT_PACKAGE, "com.example.signer")

        assertThrows(IllegalArgumentException::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseSignEventResultReturnsSignedEventWhenPresent() {
        val signed = """{"id":"abc","created_at":1,"kind":30003,"tags":[],"content":"ok","sig":"sig"}"""
        val result = Intent().putExtra(Nip55.RESULT_EVENT, signed)

        val event = Nip55.parseSignEventResult(Activity.RESULT_OK, result)

        assertEquals("abc", event.getString("id"))
        assertEquals(1L, event.getLong("created_at"))
        assertEquals("sig", event.getString("sig"))
    }

    @Test
    fun parseSignEventResultAcceptsWhitespaceWrappedEventPayload() {
        val signed = """{ "id":"abc","created_at":2,"kind":30003,"tags":[],"content":"ok","sig":"sig" }"""
        val result = Intent().putExtra(Nip55.RESULT_EVENT, "   \n$signed   ")

        val event = Nip55.parseSignEventResult(Activity.RESULT_OK, result)

        assertEquals("abc", event.getString("id"))
        assertEquals(2L, event.getLong("created_at"))
        assertEquals("sig", event.getString("sig"))
    }

    @Test
    fun parseSignEventResultRejectsRejectedResponse() {
        val result = Intent().putExtra(Nip55.RESULT_REJECTED, true)

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseSignEventResultRejectsMissingSignedEventPayload() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseSignEventResultRejectsRejectedResponseEvenWithPayload() {
        val result = Intent()
            .putExtra(Nip55.RESULT_REJECTED, true)
            .putExtra(
                Nip55.RESULT_EVENT,
                """{"id":"abc","created_at":1,"kind":30003,"tags":[],"content":"ok","sig":"sig"}""",
            )

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseSignEventResultRejectsWrongResultCode() {
        val data = Intent().putExtra(Nip55.RESULT_EVENT, """{"id":"abc"}""")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_CANCELED, data)
        }
    }

    @Test
    fun parseSignEventResultRejectsMalformedEventPayload() {
        val data = Intent().putExtra(Nip55.RESULT_EVENT, "{not-json}")

        assertThrows(org.json.JSONException::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, data)
        }
    }

    @Test
    fun parseSignEventResultRejectsBlankSignedEventPayload() {
        val data = Intent().putExtra(Nip55.RESULT_EVENT, "   ")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, data)
        }
    }

    @Test
    fun parseNip44DecryptResultReturnsPlaintextWhenPresent() {
        val result = Intent().putExtra(Nip55.RESULT, "plaintext")

        val plaintext = Nip55.parseNip44DecryptResult(Activity.RESULT_OK, result)

        assertEquals("plaintext", plaintext)
    }

    @Test
    fun parseNip44DecryptResultRejectsRejectedResponse() {
        val result = Intent().putExtra(Nip55.RESULT_REJECTED, true)

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsWrongResultCode() {
        val result = Intent().putExtra(Nip55.RESULT, "plaintext")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_CANCELED, result)
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsRejectedResponseEvenWithPayload() {
        val result = Intent()
            .putExtra(Nip55.RESULT_REJECTED, true)
            .putExtra(Nip55.RESULT, "plaintext")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsMissingPlaintext() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsBlankPlaintext() {
        val result = Intent().putExtra(Nip55.RESULT, "   ")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseNip44DecryptResultAcceptsWhitespaceWrappedPlaintext() {
        val result = Intent().putExtra(Nip55.RESULT, "  \nplaintext\n  ")

        assertEquals("  \nplaintext\n  ", Nip55.parseNip44DecryptResult(Activity.RESULT_OK, result))
    }

    @Test
    fun parseNip44EncryptResultReturnsCiphertextWhenPresent() {
        val result = Intent().putExtra(Nip55.RESULT, "ciphertext")

        val ciphertext = Nip55.parseNip44EncryptResult(Activity.RESULT_OK, result)

        assertEquals("ciphertext", ciphertext)
    }

    @Test
    fun parseNip44EncryptResultRejectsRejectedResponseEvenWithPayload() {
        val result = Intent()
            .putExtra(Nip55.RESULT_REJECTED, true)
            .putExtra(Nip55.RESULT, "ciphertext")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseNip44EncryptResultRejectsMissingCiphertext() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseNip44EncryptResultRejectsBlankCiphertext() {
        val result = Intent().putExtra(Nip55.RESULT, "")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, result)
        }
    }

    @Test
    fun parseNip44EncryptResultAcceptsWhitespaceWrappedCiphertext() {
        val result = Intent().putExtra(Nip55.RESULT, " \tciphertext\n")

        assertEquals(" \tciphertext\n", Nip55.parseNip44EncryptResult(Activity.RESULT_OK, result))
    }

    @Test
    fun parseNip44EncryptResultRejectsWrongResultCode() {
        val result = Intent().putExtra(Nip55.RESULT, "ciphertext")

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_CANCELED, result)
        }
    }
}
