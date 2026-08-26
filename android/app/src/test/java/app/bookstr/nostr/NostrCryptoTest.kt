package app.bookstr.nostr

import app.bookstr.util.Bech32
import app.bookstr.util.Sha256
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NostrCryptoTest {
    private val privateKey = ByteArray(32).also { it[31] = 1 }

    @Test
    fun parsesHexAndNsecPrivateKeys() {
        val hex = "00".repeat(31) + "01"
        val nsec = Bech32.encode("nsec", privateKey)

        assertTrue(privateKey.contentEquals(NostrCrypto.parsePrivateKey(hex.uppercase())))
        assertTrue(privateKey.contentEquals(NostrCrypto.parsePrivateKey(nsec)))
    }

    @Test
    fun parsesUppercaseNsecPrivateKey() {
        val nsec = Bech32.encode("nsec", privateKey).uppercase()

        assertTrue(privateKey.contentEquals(NostrCrypto.parsePrivateKey(nsec)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsOddLengthPrivateKey() {
        NostrCrypto.parsePrivateKey("00".repeat(31))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidHexCharacterInPrivateKey() {
        NostrCrypto.parsePrivateKey("gg".repeat(32))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsMalformedPrivateKey() {
        NostrCrypto.parsePrivateKey("not-a-private-key")
    }

    @Test
    fun rejectsNsecWithWrongDecodedLength() {
        val shortNsec = Bech32.encode("nsec", ByteArray(31))

        try {
            NostrCrypto.parsePrivateKey(shortNsec)
            throw AssertionError("expected invalid nsec length")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message.orEmpty().contains("length"))
        }
    }

    @Test
    fun eventIdChangesWhenContentChanges() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("kind", 1)
            .put("created_at", 123L)
            .put("tags", JSONArray().put(JSONArray().put("t").put("bookstr")))
            .put("content", "original")
        val originalId = NostrCrypto.eventId(event)

        event.put("content", "changed")

        assertFalse(originalId == NostrCrypto.eventId(event))
    }

    @Test
    fun prepareUnsignedEventRemovesOldSignatureAndNormalizesPubkey() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 1L)
            .put("tags", JSONArray())
            .put("content", "")
            .put("id", "old")
            .put("sig", "old")

        NostrCrypto.prepareUnsignedEvent("AB".repeat(32), event)

        assertEquals("ab".repeat(32), event.getString("pubkey"))
        assertEquals(64, event.getString("id").length)
        assertFalse(event.has("sig"))
    }

    @Test
    fun eventHashUsesJsonCompatibleEscapingAndUnicode() {
        val pubkey = "00".repeat(32)
        val event = JSONObject()
            .put("pubkey", pubkey)
            .put("created_at", 7L)
            .put("kind", 1)
            .put("tags", JSONArray().put(JSONArray().put("quote\"").put("line\n")))
            .put("content", "Olá \\ / \t")
        val canonical = """[0,"$pubkey",7,1,[["quote\"","line\n"]],"Olá \\ / \t"]"""

        assertEquals(Sha256.hash(canonical), NostrCrypto.eventId(event))
    }

    @Test
    fun eventIdUsesEmptyTagsWhenMissingTagsField() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 9L)
            .put("kind", 1)
            .put("content", "no tags")

        val id = NostrCrypto.eventId(event)
        assertEquals(64, id.length)
    }

    @Test
    fun eventIdRejectsMalformedTagContainer() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 9L)
            .put("kind", 1)
            .put("content", "malformed tag")
            .put("tags", JSONArray().put("not-an-array"))

        assertThrows(org.json.JSONException::class.java) {
            NostrCrypto.eventId(event)
        }
    }

    @Test
    fun eventIdRejectsNonIntegerCreatedAt() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 9.5)
            .put("kind", 1)
            .put("content", "decimal created_at")
            .put("tags", JSONArray())

        assertThrows(org.json.JSONException::class.java) {
            NostrCrypto.eventId(event)
        }
    }

    @Test
    fun eventIdRejectsTagEntriesThatAreNotArrays() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 10L)
            .put("kind", 1)
            .put("content", "bad tag entry")
            .put("tags", JSONArray().put(JSONObject(mapOf("k" to "v"))))

        assertThrows(org.json.JSONException::class.java) {
            NostrCrypto.eventId(event)
        }
    }

    @Test
    fun eventIdHashesBoolAndNumericTagValues() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 10L)
            .put("kind", 1)
            .put("tags", JSONArray().put(JSONArray().put("flag").put(7).put(true)))
            .put("content", "payload")

        assertEquals(64, NostrCrypto.eventId(event).length)
    }

    @Test
    fun incompleteEventNeverVerifies() {
        assertFalse(NostrCrypto.verifyEvent(JSONObject()))
        assertFalse(NostrCrypto.verifyEvent(JSONObject().put("id", "00")))
    }

    @Test
    fun parsePrivateKeyTrimsWhitespaceBeforeParsing() {
        assertTrue(
            ByteArray(32).also { it[31] = 1 }.contentEquals(
                NostrCrypto.parsePrivateKey("   ${"00".repeat(31)}01  \n"),
            ),
        )
    }

    @Test
    fun verifiesRejectsWhenIdAndPayloadMismatch() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 1L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "mismatch")
        val signed = NostrCrypto.signEvent(ByteArray(32).also { it[31] = 1 }, event)

        signed.put("id", signed.getString("id").replaceRange(0, 1, "0"))
        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifiesRejectsMalformedTagsField() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 123L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")

        val signed = NostrCrypto.signEvent(privateKey, event)
        signed.put("tags", "not-an-array")

        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifiesRejectsMalformedSignatureHex() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 123L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")

        val signed = NostrCrypto.signEvent(privateKey, event)
        signed.put("sig", "zz")

        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifiesRejectsMalformedPublicKey() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 7L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")

        val signed = NostrCrypto.signEvent(privateKey, event)
        signed.put("pubkey", "zz")

        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifiesRejectsMalformedCreatedAt() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", "not-a-number")
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")
            .put("id", "00".repeat(32))
            .put("sig", "11".repeat(64))

        assertFalse(NostrCrypto.verifyEvent(event))
    }

    @Test
    fun prepareUnsignedEventRejectsMissingRequiredFields() {
        val event = JSONObject().put("tags", JSONArray()).put("content", "payload")

        assertThrows(org.json.JSONException::class.java) {
            NostrCrypto.prepareUnsignedEvent("ab".repeat(32), event)
        }
    }

    @Test
    fun verifiesRejectsMissingSignature() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 11L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")

        val signed = NostrCrypto.signEvent(privateKey, event)
        signed.remove("sig")

        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifiesSignedEventWhenSignatureAndIdAreUppercase() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 123L)
            .put("pubkey", "00".repeat(32))
            .put("tags", JSONArray())
            .put("content", "payload")

        val signed = NostrCrypto.signEvent(privateKey, event)
        signed.put("id", signed.getString("id").uppercase())
        signed.put("sig", signed.getString("sig").uppercase())
        signed.put("pubkey", signed.getString("pubkey").uppercase())

        assertTrue(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun signEventWritesDeterministicIdAndVerifiableSignature() {
        val event = JSONObject()
            .put("kind", 30078)
            .put("created_at", 1_700_000_123L)
            .put("tags", JSONArray())
            .put("content", "consistency-check")

        val signed = NostrCrypto.signEvent(privateKey, event)

        assertEquals("00".repeat(32), signed.getString("pubkey"))
        assertEquals(64, signed.getString("id").length)
        assertEquals(128, signed.getString("sig").length)
        assertEquals(signed.getString("id"), NostrCrypto.eventId(signed))
        assertTrue(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun publicKeyHexReturnsLowercaseHexString() {
        val pubkey = NostrCrypto.publicKeyHex(privateKey)

        assertEquals(64, pubkey.length)
        assertTrue(pubkey.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' })
    }

}
