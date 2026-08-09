package app.bookstr.nostr

import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.json.JSONObject

class LocalNsecSigner(
    private val settings: SettingsRepository,
) : NostrSigner {
    override fun isConfigured(): Boolean =
        settings.authMode == NostrAuthMode.Nsec && !settings.nsec.isNullOrBlank()

    override suspend fun getPublicKey(): String {
        val cached = settings.pubkeyHex
        if (!cached.isNullOrBlank()) return cached
        val nsec = settings.nsec ?: throw IllegalStateException("No nsec configured")
        val pubkey = NostrCrypto.publicKeyHex(NostrCrypto.parsePrivateKey(nsec))
        settings.pubkeyHex = pubkey
        return pubkey
    }

    override suspend fun signEvent(unsigned: JSONObject): JSONObject {
        val nsec = settings.nsec ?: throw IllegalStateException("No nsec configured")
        val privateKey = NostrCrypto.parsePrivateKey(nsec)
        return NostrCrypto.signEvent(privateKey, unsigned)
    }
}
