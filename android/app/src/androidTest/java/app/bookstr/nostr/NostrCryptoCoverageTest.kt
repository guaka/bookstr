package app.bookstr.nostr

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.test.assertFailsWith

class NostrCryptoCoverageTest {
    private val validPrivateHex = StringBuilder().apply {
        repeat(31) { append("00") }
        append("01")
    }.toString()

    @Test
    fun parsePrivateKeyAcceptsUppercaseHexAndTrimsWhitespace() {
        val input = "  ${validPrivateHex.uppercase()}  "
        val parsed = NostrCrypto.parsePrivateKey(input)

        val decoded = parsed.joinToString("") { "%02x".format(it) }
        assertEquals(validPrivateHex, decoded)
        assertEquals(32, parsed.size)
    }

    @Test
    fun parsePrivateKeyRejectsInvalidInput() {
        assertFailsWith<IllegalArgumentException> {
            NostrCrypto.parsePrivateKey("not-a-key")
        }
    }

    @Test
    fun prepareUnsignedEventLowercasesPubkeyAndResetsCryptoFields() {
        val event = JSONObject()
            .put("id", "old-id")
            .put("pubkey", "ABCDEF")
            .put("sig", "old-sig")
            .put("kind", 1)
            .put("created_at", 1)
            .put("tags", JSONArray())
            .put("content", "hello")
        val prepared = NostrCrypto.prepareUnsignedEvent("AbCdEf", event)

        assertEquals("abcdef", prepared.getString("pubkey"))
        assertEquals("hello", prepared.getString("content"))
        assertNotEquals("old-id", prepared.getString("id"))
        assertFalse(prepared.has("sig"))
    }

    @Test
    fun signEventAddsSignatureAndVerificationPasses() {
        val event = JSONObject()
            .put("kind", 1)
            .put("created_at", 1)
            .put("tags", JSONArray())
            .put("content", "hello")
        val privateKey = NostrCrypto.parsePrivateKey(validPrivateHex)
        val signed = NostrCrypto.signEvent(privateKey, event)

        assertEquals(64, signed.getString("pubkey").length)
        assertEquals(128, signed.getString("sig").length)
        assertTrue(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun verifyEventFailsForTamperedSignature() {
        val unsigned = JSONObject()
            .put("kind", 1)
            .put("created_at", 1)
            .put("tags", JSONArray())
            .put("content", "hello")
        val privateKey = NostrCrypto.parsePrivateKey(validPrivateHex)
        val signed = NostrCrypto.signEvent(privateKey, unsigned)
        signed.put("sig", "deadbeef")

        assertFalse(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun parsePrivateKeyAcceptsNsecEncodings() {
        val keyBytes = ByteArray(32) { i -> ((i + 1) and 0xff).toByte() }
        val nsec = app.bookstr.util.Bech32.encode("nsec", keyBytes)

        val fromLowercase = NostrCrypto.parsePrivateKey(nsec)
        val fromUppercase = NostrCrypto.parsePrivateKey(nsec.uppercase())

        assertEquals(keyBytes.toList(), fromLowercase.toList())
        assertEquals(fromLowercase.toList(), fromUppercase.toList())
    }

    @Test
    fun parsePrivateKeyRejectsMixedCaseNsec() {
        val nsec = app.bookstr.util.Bech32.encode("nsec", NostrCrypto.parsePrivateKey(validPrivateHex))
        assertFailsWith<IllegalArgumentException> {
            NostrCrypto.parsePrivateKey("N" + nsec.drop(1))
        }
    }

    @Test
    fun parsePrivateKeyRejectsNsecWithWrongLength() {
        val shortNsec = app.bookstr.util.Bech32.encode("nsec", ByteArray(31) { 0x11 })

        assertFailsWith<IllegalArgumentException> {
            NostrCrypto.parsePrivateKey(shortNsec)
        }
    }

    @Test
    fun eventIdIsDeterministicAndIgnoresSignatureField() {
        val event = JSONObject()
            .put("id", "old")
            .put("pubkey", StringBuilder().apply { repeat(32) { append("ab") } }.toString())
            .put("created_at", 10)
            .put("kind", 1)
            .put("tags", JSONArray())
            .put("content", "hello")

        val eventId = NostrCrypto.eventId(event)
        event.put("sig", "deadbeef")

        assertEquals(eventId, NostrCrypto.eventId(event))
    }
}
