package app.bookstr.nostr

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Bridges NIP-55 Intent results into suspend functions.
 * Call [attach] from Activity.onResume and [detach] from onPause.
 */
class AmberIntentSession(
    private val activity: ComponentActivity,
) {
    private var unsignedEvent: String? = null
    private val pendingGetKey = AtomicReference<CancellableContinuation<Pair<String, String>>?>(null)
    private val pendingSign = AtomicReference<CancellableContinuation<org.json.JSONObject>?>(null)
    private val pendingDecrypt = AtomicReference<CancellableContinuation<String>?>(null)
    private val pendingEncrypt = AtomicReference<CancellableContinuation<String>?>(null)

    private val getPublicKeyLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingGetKey.getAndSet(null) ?: return@registerForActivityResult
            if (!cont.isActive) return@registerForActivityResult
            try {
                cont.resume(Nip55.parseGetPublicKeyResult(result.resultCode, result.data))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }

    private val signEventLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingSign.getAndSet(null) ?: return@registerForActivityResult
            if (!cont.isActive) return@registerForActivityResult
            try {
                cont.resume(Nip55.parseSignEventResult(result.resultCode, result.data, unsignedEvent))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }

    private val decryptLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingDecrypt.getAndSet(null) ?: return@registerForActivityResult
            if (!cont.isActive) return@registerForActivityResult
            try {
                cont.resume(Nip55.parseNip44DecryptResult(result.resultCode, result.data))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }

    private val encryptLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingEncrypt.getAndSet(null) ?: return@registerForActivityResult
            if (!cont.isActive) return@registerForActivityResult
            try {
                cont.resume(Nip55.parseNip44EncryptResult(result.resultCode, result.data))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }

    init {
        activity.lifecycle.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_DESTROY) {
                pendingGetKey.getAndSet(null)?.cancel()
                pendingSign.getAndSet(null)?.cancel()
                pendingDecrypt.getAndSet(null)?.cancel()
                pendingEncrypt.getAndSet(null)?.cancel()
                detach()
            }
        })
    }

    fun attach() {
        Host.session = this
    }

    fun detach() {
        if (Host.session === this) {
            Host.session = null
        }
    }

    suspend fun getPublicKey(): Pair<String, String> =
        suspendCancellableCoroutine { cont ->
            if (!pendingGetKey.compareAndSet(null, cont)) {
                cont.resumeWithException(Nip55Exception("Another get_public_key request is in progress"))
                return@suspendCancellableCoroutine
            }

            try {
                val request = Nip55.getPublicKeyIntent()
                val providers = activity.packageManager.queryIntentActivities(Nip55.discoveryIntent(), 0)
                getPublicKeyLauncher.launch(if (providers.size > 1) Intent.createChooser(request, "Connect signer") else request)
            } catch (e: Exception) {
                pendingGetKey.compareAndSet(cont, null)
                cont.resumeWithException(e)
            }
        }

    suspend fun signEvent(eventJson: String, currentUserHex: String, signerPackage: String): org.json.JSONObject =
        suspendCancellableCoroutine { cont ->
            if (!pendingSign.compareAndSet(null, cont)) {
                cont.resumeWithException(Nip55Exception("Another sign_event request is in progress"))
                return@suspendCancellableCoroutine
            }

            try {
                unsignedEvent = eventJson
                signEventLauncher.launch(
                    Nip55.signEventIntent(eventJson, currentUserHex, signerPackage),
                )
            } catch (e: Exception) {
                pendingSign.compareAndSet(cont, null)
                cont.resumeWithException(e)
            }
        }

    suspend fun decryptNip44(
        ciphertext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
        signerPackage: String,
    ): String =
        suspendCancellableCoroutine { cont ->
            if (!pendingDecrypt.compareAndSet(null, cont)) {
                cont.resumeWithException(Nip55Exception("Another nip44_decrypt request is in progress"))
                return@suspendCancellableCoroutine
            }

            try {
                decryptLauncher.launch(
                    Nip55.nip44DecryptIntent(
                        ciphertext,
                        otherPubkeyHex,
                        currentUserHex,
                        signerPackage,
                    ),
                )
            } catch (e: Exception) {
                pendingDecrypt.compareAndSet(cont, null)
                cont.resumeWithException(e)
            }
        }


    suspend fun encryptNip44(
        plaintext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
        signerPackage: String,
    ): String =
        suspendCancellableCoroutine { cont ->
            if (!pendingEncrypt.compareAndSet(null, cont)) {
                cont.resumeWithException(Nip55Exception("Another nip44_encrypt request is in progress"))
                return@suspendCancellableCoroutine
            }

            try {
                encryptLauncher.launch(
                    Nip55.nip44EncryptIntent(plaintext, otherPubkeyHex, currentUserHex, signerPackage),
                )
            } catch (e: Exception) {
                pendingEncrypt.compareAndSet(cont, null)
                cont.resumeWithException(e)
            }
        }

    object Host {
        private val foreground = MutableStateFlow<AmberIntentSession?>(null)
        var session: AmberIntentSession?
            get() = foreground.value
            set(value) { foreground.value = value }

        // Results can arrive at STARTED, before onResume reattaches the host.
        suspend fun awaitSession(): AmberIntentSession = withTimeoutOrNull(5_000) {
            foreground.filterNotNull().first()
        } ?: throw Nip55Exception("Open Bookstr to approve the signer request")
    }
}
