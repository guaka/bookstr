package app.bookstr.nostr

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class Nip44Test {
    private val vectors = JSONObject(javaClass.getResource("/nip44.vectors.json")!!.readText()).getJSONObject("v2")
    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    @Test fun officialConversationKeys() {
        val values = vectors.getJSONObject("valid").getJSONArray("get_conversation_key")
        for (i in 0 until values.length()) {
            val v = values.getJSONObject(i)
            assertArrayEquals(hex(v.getString("conversation_key")), Nip44.conversationKey(hex(v.getString("sec1")), v.getString("pub2")))
        }
    }
    @Test fun officialEncryptedPayloads() {
        val values = vectors.getJSONObject("valid").getJSONArray("encrypt_decrypt")
        for (i in 0 until values.length()) {
            val v = values.getJSONObject(i)
            val key = hex(v.getString("conversation_key"))
            assertEquals(v.getString("payload"), Nip44.encryptWithKey(key, v.getString("plaintext"), hex(v.getString("nonce"))))
            assertEquals(v.getString("plaintext"), Nip44.decryptWithKey(key, v.getString("payload")))
        }
    }
    @Test fun rejectsOfficialInvalidPayloadsAndKeys() {
        val invalid = vectors.getJSONObject("invalid")
        val payloads = invalid.getJSONArray("decrypt")
        for (i in 0 until payloads.length()) {
            val v = payloads.getJSONObject(i)
            assertThrows(Exception::class.java) { Nip44.decryptWithKey(hex(v.getString("conversation_key")), v.getString("payload")) }
        }
        val keys = invalid.getJSONArray("get_conversation_key")
        for (i in 0 until keys.length()) {
            val v = keys.getJSONObject(i)
            assertThrows(Exception::class.java) { Nip44.conversationKey(hex(v.getString("sec1")), v.getString("pub2")) }
        }
    }
    @Test fun paddingBoundariesAndLargeUnicodeRoundTrip() {
        listOf(1 to 32, 32 to 32, 33 to 64, 256 to 256, 257 to 320, 65535 to 65536, 65536 to 65536).forEach {
            assertEquals(it.second, Nip44.paddedLength(it.first))
        }
        val secret = ByteArray(32).also { it[31] = 1 }
        val pubkey = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
        for (text in listOf("Olá 📚", "a".repeat(65535), "a".repeat(65536), "本".repeat(30000))) {
            assertEquals(text, Nip44.decrypt(secret, pubkey, Nip44.encrypt(secret, pubkey, text)))
        }
        assertThrows(IllegalArgumentException::class.java) { Nip44.paddedLength(0) }
        assertThrows(IllegalArgumentException::class.java) { Nip44.paddedLength(Nip44.MAX_PLAINTEXT + 1) }
        assertThrows(IllegalArgumentException::class.java) { Nip44.encryptWithKey(ByteArray(31), "hi", ByteArray(32)) }
        assertThrows(IllegalArgumentException::class.java) { Nip44.encryptWithKey(ByteArray(32), "hi", ByteArray(31)) }
        assertThrows(IllegalArgumentException::class.java) { Nip44.conversationKey(ByteArray(31), pubkey) }
        assertThrows(IllegalArgumentException::class.java) { Nip44.conversationKey(secret, "bad") }
        val payload = Base64.getDecoder().decode(Nip44.encrypt(secret, pubkey, "test"))
        payload[0] = 3
        assertThrows(IllegalArgumentException::class.java) { Nip44.decrypt(secret, pubkey, Base64.getEncoder().encodeToString(payload)) }
    }
}
