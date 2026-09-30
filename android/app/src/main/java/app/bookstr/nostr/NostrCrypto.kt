package app.bookstr.nostr

import app.bookstr.util.Bech32
import app.bookstr.util.Sha256
import fr.acinq.secp256k1.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

object NostrCrypto {
    private val secp by lazy { Secp256k1.get() }

    fun generateNsec(random: SecureRandom = SecureRandom()): String {
        while (true) {
            val key = ByteArray(32).also(random::nextBytes)
            if (runCatching { publicKeyHex(key) }.isSuccess) return Bech32.encode("nsec", key)
        }
    }

    fun parsePrivateKey(input: String): ByteArray {
        val trimmed = input.trim()
        return when {
            trimmed.startsWith("nsec1", ignoreCase = true) -> {
                val decoded = Bech32.decode("nsec", trimmed)
                require(decoded.size == 32) { "Invalid nsec length" }
                decoded
            }
            trimmed.length == 64 && trimmed.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' } ->
                trimmed.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            else -> throw IllegalArgumentException("Private key must be nsec1… or 64-char hex")
        }
    }

    fun publicKeyHex(privateKey: ByteArray): String {
        val compressed = secp.pubKeyCompress(secp.pubkeyCreate(privateKey))
        return compressed.copyOfRange(1, 33).joinToString("") { "%02x".format(it) }
    }

    /** Sets pubkey + id on an unsigned event template (no sig). */
    fun prepareUnsignedEvent(pubkeyHex: String, event: JSONObject): JSONObject {
        event.put("pubkey", pubkeyHex.lowercase())
        event.remove("id")
        event.remove("sig")
        val eventId = Sha256.hash(serializeForHash(event))
        event.put("id", eventId)
        return event
    }

    fun signEvent(privateKey: ByteArray, event: JSONObject): JSONObject {
        val pubkey = publicKeyHex(privateKey)
        prepareUnsignedEvent(pubkey, event)

        val idBytes = hexToBytes(event.getString("id"))
        val auxRand = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val sigBytes = secp.signSchnorr(idBytes, privateKey, auxRand)
        event.put("sig", bytesToHex(sigBytes))

        return event
    }

    fun verifyEvent(event: JSONObject): Boolean {
        return try {
            val expectedId = eventId(event)
            if (!expectedId.equals(event.getString("id"), ignoreCase = true)) return false
            secp.verifySchnorr(
                hexToBytes(event.getString("sig")),
                hexToBytes(expectedId),
                hexToBytes(event.getString("pubkey")),
            )
        } catch (_: Exception) {
            false
        }
    }

    fun eventId(event: JSONObject): String = Sha256.hash(serializeForHash(event))

    private fun serializeForHash(event: JSONObject): String {
        val tags = event.optJSONArray("tags") ?: JSONArray()
        return buildString {
            append("[0,")
            appendJsonString(event.getString("pubkey"))
            append(',')
            append(event.getLong("created_at"))
            append(',')
            append(event.getInt("kind"))
            append(',')
            append('[')
            for (i in 0 until tags.length()) {
                if (i > 0) append(',')
                val tag = tags.getJSONArray(i)
                append('[')
                for (j in 0 until tag.length()) {
                    if (j > 0) append(',')
                    appendJsonString(tag.getString(j))
                }
                append(']')
            }
            append("],")
            appendJsonString(event.getString("content"))
            append(']')
        }
    }

    /** JSON.stringify-compatible string encoding: notably, '/' is not escaped. */
    private fun StringBuilder.appendJsonString(value: String) {
        append('"')
        for (char in value) {
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000c' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> {
                    if (char.code < 0x20) append("\\u%04x".format(char.code)) else append(char)
                }
            }
        }
        append('"')
    }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }
}
