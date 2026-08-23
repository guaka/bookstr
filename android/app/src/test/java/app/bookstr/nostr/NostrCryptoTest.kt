package app.bookstr.nostr

import app.bookstr.util.Bech32
import app.bookstr.util.Sha256
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun incompleteEventNeverVerifies() {
        assertFalse(NostrCrypto.verifyEvent(JSONObject()))
        assertFalse(NostrCrypto.verifyEvent(JSONObject().put("id", "00")))
    }
}
