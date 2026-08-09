package app.bookstr.nostr

import android.content.Context
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.json.JSONObject

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
        settings.pubkeyHex ?: throw IllegalStateException("Amber is not connected")

    override suspend fun signEvent(unsigned: JSONObject): JSONObject {
        val pubkey = settings.pubkeyHex ?: throw IllegalStateException("Amber is not connected")
        val pkg = settings.signerPackage ?: throw IllegalStateException("Amber is not connected")
        val prepared = NostrCrypto.prepareUnsignedEvent(pubkey, unsigned)
        val eventJson = prepared.toString()

        Nip55.signEventViaContentResolver(context, pkg, eventJson, pubkey)?.let { return it }

        val session =
            AmberIntentSession.Host.session
                ?: throw Nip55Exception(
                    "Amber needs approval to sign. Open Settings and connect Amber, " +
                        "then allow remembering permission for progress events.",
                )
        return session.signEvent(eventJson, pubkey, pkg)
    }

    companion object {
        suspend fun connectViaIntent(settings: SettingsRepository): Pair<String, String> {
            val session =
                AmberIntentSession.Host.session
                    ?: throw Nip55Exception("Open Settings to connect Amber")
            val (pubkey, pkg) = session.getPublicKey()
            settings.connectAmber(pubkey, pkg)
            return pubkey to pkg
        }
    }
}
