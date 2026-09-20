package app.bookstr.nostr

import org.bouncycastle.asn1.sec.SECNamedCurves
import org.bouncycastle.crypto.engines.ChaCha7539Engine
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.params.ParametersWithIV
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** NIP-44 v2; bounded to 1 MiB plaintext for catalog messages. No provider registration. */
object Nip44 {
    const val MAX_PLAINTEXT = 1024 * 1024
    private fun mac(key: ByteArray, bytes: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256")); doFinal(bytes)
    }
    fun conversationKey(secret: ByteArray, publicKey: String): ByteArray {
        require(secret.size == 32 && Regex("[0-9a-fA-F]{64}").matches(publicKey))
        val curve = SECNamedCurves.getByName("secp256k1")
        val scalar = BigInteger(1, secret)
        require(scalar.signum() > 0 && scalar < curve.n)
        val point = curve.curve.decodePoint(byteArrayOf(2) + publicKey.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
        require(!point.isInfinity && point.isValid)
        val shared = point.multiply(scalar).normalize().affineXCoord.encoded
        return mac("nip44-v2".toByteArray(), shared)
    }
    private fun keys(key: ByteArray, nonce: ByteArray): ByteArray {
        require(key.size == 32 && nonce.size == 32)
        var previous = byteArrayOf()
        var expanded = byteArrayOf()
        for (i in 1..3) {
            previous = mac(key, previous + nonce + i.toByte())
            expanded += previous
        }
        return expanded.copyOf(76)
    }
    fun paddedLength(length: Int): Int {
        require(length in 1..MAX_PLAINTEXT)
        if (length <= 32) return 32
        val power = Integer.highestOneBit(length - 1) * 2
        val chunk = if (power <= 256) 32 else power / 8
        return ((length - 1) / chunk + 1) * chunk
    }
    private fun crypt(keys: ByteArray, input: ByteArray): ByteArray = ByteArray(input.size).also {
        val cipher = ChaCha7539Engine()
        cipher.init(true, ParametersWithIV(KeyParameter(keys.copyOfRange(0, 32)), keys.copyOfRange(32, 44)))
        cipher.processBytes(input, 0, input.size, it, 0)
    }
    fun encrypt(secret: ByteArray, publicKey: String, plaintext: String): String =
        encryptWithKey(conversationKey(secret, publicKey), plaintext, ByteArray(32).also(SecureRandom()::nextBytes))

    internal fun encryptWithKey(key: ByteArray, plaintext: String, nonce: ByteArray): String {
        val bytes = plaintext.toByteArray(Charsets.UTF_8)
        val prefix = if (bytes.size < 65536) 2 else 6
        val padded = ByteBuffer.allocate(prefix + paddedLength(bytes.size))
        if (prefix == 2) padded.putShort(bytes.size.toShort()) else padded.putShort(0).putInt(bytes.size)
        padded.put(bytes)
        val keys = keys(key, nonce)
        val ciphertext = crypt(keys, padded.array())
        return Base64.getEncoder().encodeToString(byteArrayOf(2) + nonce + ciphertext + mac(keys.copyOfRange(44, 76), nonce + ciphertext))
    }
    fun decrypt(secret: ByteArray, publicKey: String, payload: String): String =
        decryptWithKey(conversationKey(secret, publicKey), payload)

    internal fun decryptWithKey(key: ByteArray, payload: String): String {
        require(payload.length in 132..(2 * MAX_PLAINTEXT)) { "Invalid encrypted payload length" }
        val data = Base64.getDecoder().decode(payload)
        require(data.size >= 99 && data[0] == 2.toByte()) { "Unsupported encryption version" }
        val nonce = data.copyOfRange(1, 33)
        val ciphertext = data.copyOfRange(33, data.size - 32)
        val keys = keys(key, nonce)
        require(MessageDigest.isEqual(data.copyOfRange(data.size - 32, data.size), mac(keys.copyOfRange(44, 76), nonce + ciphertext))) { "Invalid encryption MAC" }
        val padded = crypt(keys, ciphertext)
        val buffer = ByteBuffer.wrap(padded)
        var length = buffer.short.toInt() and 65535
        val prefix = if (length == 0) { length = buffer.int; 6 } else 2
        require(length in 1..MAX_PLAINTEXT && (prefix == 2 || length >= 65536))
        require(padded.size == prefix + paddedLength(length)) { "Invalid encryption padding" }
        require(padded.drop(prefix + length).all { it == 0.toByte() })
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(padded, prefix, length)).toString()
    }
}
