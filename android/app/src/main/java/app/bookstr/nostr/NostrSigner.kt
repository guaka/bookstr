package app.bookstr.nostr

import org.json.JSONObject

/**
 * Abstraction over local nsec signing and external NIP-55 signers (Amber, etc.).
 */
interface NostrSigner {
    fun isConfigured(): Boolean

    /** Hex pubkey for the active identity. */
    suspend fun getPublicKey(): String

    /** Signs an unsigned event template; returns a complete event with id/pubkey/sig. */
    suspend fun signEvent(unsigned: JSONObject): JSONObject
}
