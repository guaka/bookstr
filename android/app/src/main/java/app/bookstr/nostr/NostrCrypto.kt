package app.bookstr.nostr

import app.bookstr.util.Bech32
import app.bookstr.util.Sha256
import fr.acinq.secp256k1.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

object NostrCrypto {
    private val secp = Secp256k1.get()

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
        val pub = secp.pubKeyCompress(privateKey)
        return pub.joinToString("") { "%02x".format(it) }
    }

    fun signEvent(privateKey: ByteArray, event: JSONObject): JSONObject {
        val pubkey = publicKeyHex(privateKey)
        event.put("pubkey", pubkey)
        event.remove("id")
        event.remove("sig")

        val serialized = serializeForHash(event)
        val eventId = Sha256.hash(serialized)
        event.put("id", eventId)

        val idBytes = hexToBytes(eventId)
        val auxRand = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val sigBytes = secp.signSchnorr(idBytes, privateKey, auxRand)
        event.put("sig", bytesToHex(sigBytes))

        return event
    }

    private fun serializeForHash(event: JSONObject): String {
        val tags = event.optJSONArray("tags") ?: JSONArray()
        return JSONArray()
            .put(0)
            .put(event.getString("pubkey"))
            .put(event.getLong("created_at"))
            .put(event.getInt("kind"))
            .put(tags)
            .put(event.getString("content"))
            .toString()
    }

    private fun hexToBytes(hex: String): ByteArray =
        hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }
}
