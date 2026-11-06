package app.bookstr.nostr

import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** Shares live WebSocket sessions and restores encrypted sessions after process recreation. */
internal object Nip46Sessions {
    private class Session(val service: Nip46Service, val restoreMutex: Mutex = Mutex()) {
        val invalidated = AtomicBoolean(false)
    }
    private val sessions = ConcurrentHashMap<String, Session>()

    fun newService(): Nip46Service = Nip46Service()

    fun retain(clientSecretHex: String, service: Nip46Service) {
        sessions.put(clientSecretHex.lowercase(), Session(service))?.let { previous ->
            previous.invalidated.set(true)
            previous.service.resetSession()
        }
    }

    fun forget(clientSecretHex: String?) {
        clientSecretHex?.let { sessions.remove(it.lowercase())?.let { session ->
            session.invalidated.set(true)
            session.service.resetSession()
        } }
    }

    fun create(settings: SettingsRepository): NostrSigner? {
        if (settings.authMode != NostrAuthMode.Nip46 || !settings.hasNostrIdentity()) return null
        val secret = settings.nip46ClientSecretHex ?: return null
        val remote = settings.nip46RemoteSignerPubkey ?: return null
        val user = settings.pubkeyHex ?: return null
        val relays = settings.nip46Relays
        if (relays.isEmpty()) return null
        val session = sessions.computeIfAbsent(secret.lowercase()) { Session(Nip46Service()) }
        return RestoredNip46Signer(session, secret, remote, relays, user)
    }

    private class RestoredNip46Signer(
        private val session: Session,
        private val secret: String,
        private val remote: String,
        private val relays: List<String>,
        private val user: String,
    ) : NostrSigner {
        override fun isConfigured(): Boolean = !session.invalidated.get()

        private suspend fun connected(): Nip46Service = session.restoreMutex.withLock {
            checkValid()
            val service = session.service
            if (!service.hasRelayTransport() || service.currentConnection()?.let {
                    it.remoteSignerPubkey.equals(remote, true) && it.userPubkey.equals(user, true) && it.relays == relays
                } != true
            ) service.restore(secret, remote, relays, user)
            if (session.invalidated.get()) {
                service.resetSession()
                throw Nip46Exception("NIP-46 session was disconnected")
            }
            service
        }

        private fun checkValid() {
            if (session.invalidated.get()) throw Nip46Exception("NIP-46 session was disconnected")
        }

        override suspend fun getPublicKey(): String { checkValid(); return user }
        override suspend fun signEvent(unsigned: JSONObject): JSONObject = connected().signEvent(unsigned)
        override suspend fun nip44Encrypt(plaintext: String, pubkey: String): String = connected().nip44Encrypt(plaintext, pubkey)
        override suspend fun nip44Decrypt(ciphertext: String, pubkey: String): String = connected().nip44Decrypt(ciphertext, pubkey)
    }
}
