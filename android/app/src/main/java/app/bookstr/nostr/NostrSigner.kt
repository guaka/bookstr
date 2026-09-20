package app.bookstr.nostr

import org.json.JSONObject

/**
 * Abstraction over local nsec signing and external NIP-55 signers (Amber, etc.).
 */
interface NostrSigner {
    fun isConfigured(): Boolean

    /** Hex pubkey for the active identity. */
    suspend fun getPublicKey(): String

    suspend fun nip44Encrypt(plaintext: String, pubkey: String): String =
        throw UnsupportedOperationException("Signer does not support NIP-44")
    suspend fun nip44Decrypt(ciphertext: String, pubkey: String): String =
        throw UnsupportedOperationException("Signer does not support NIP-44")

    /** Signs an unsigned event template; returns a complete event with id/pubkey/sig. */
    suspend fun signEvent(unsigned: JSONObject): JSONObject
}
