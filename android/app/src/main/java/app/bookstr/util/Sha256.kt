package app.bookstr.util

import java.security.MessageDigest

object Sha256 {
    fun hash(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    fun hash(text: String): String = hash(text.toByteArray(Charsets.UTF_8))
}
