package app.bookstr.nostr

import android.content.Context
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Signs via a NIP-55 external signer (Amber). Prefers the content provider for
 * remembered permissions; falls back to an Intent prompt when a session is attached.
 */
class ExternalSigner(
    private val context: Context,
    private val settings: SettingsRepository,
) : NostrSigner {
    override fun isConfigured(): Boolean =
        settings.authMode == NostrAuthMode.Amber &&
            !settings.pubkeyHex.isNullOrBlank() &&
            !settings.signerPackage.isNullOrBlank()

    override suspend fun getPublicKey(): String =
        settings.pubkeyHex ?: throw IllegalStateException("External signer is not connected")

    override suspend fun signEvent(unsigned: JSONObject): JSONObject {
        val pubkey = settings.pubkeyHex ?: throw IllegalStateException("External signer is not connected")
        val pkg = settings.signerPackage ?: throw IllegalStateException("External signer is not connected")
        val prepared = NostrCrypto.prepareUnsignedEvent(pubkey, unsigned)
        val eventJson = prepared.toString()

        Nip55.signEventViaContentResolver(context, pkg, eventJson, pubkey)?.let {
            require(it.optString("id") == prepared.getString("id") && NostrCrypto.verifyEvent(it)) { "Invalid signer response" }
            return it
        }

        val signed = withContext(Dispatchers.Main) {
            AmberIntentSession.Host.awaitSession().signEvent(eventJson, pubkey, pkg)
        }
        require(signed.optString("id") == prepared.getString("id") && NostrCrypto.verifyEvent(signed)) { "Invalid signer response" }
        return signed
    }

    override suspend fun nip44Encrypt(plaintext: String, pubkey: String): String {
        val pkg = settings.signerPackage ?: throw Nip55Exception("Connect your signer")
        val user = getPublicKey()
        return Nip55.encryptNip44ViaContentResolver(context, pkg, plaintext, pubkey, user)
            ?: withContext(Dispatchers.Main) {
                val session = AmberIntentSession.Host.awaitSession()
                session.encryptNip44(plaintext, pubkey, user, pkg)
            }
    }

    override suspend fun nip44Decrypt(ciphertext: String, pubkey: String): String {
        val pkg = settings.signerPackage ?: throw Nip55Exception("Connect your signer")
        val user = getPublicKey()
        return Nip55.decryptNip44ViaContentResolver(context, pkg, ciphertext, pubkey, user)
            ?: withContext(Dispatchers.Main) {
                val session = AmberIntentSession.Host.awaitSession()
                session.decryptNip44(ciphertext, pubkey, user, pkg)
            }
    }

    companion object {
        suspend fun connectViaIntent(settings: SettingsRepository): Pair<String, String> {
            val session =
                AmberIntentSession.Host.session
                    ?: throw Nip55Exception("Open Settings to connect your signer")
            val (pubkey, pkg) = session.getPublicKey()
            settings.connectAmber(pubkey, pkg)
            return pubkey to pkg
        }
    }
}
