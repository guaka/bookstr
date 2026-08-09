package app.bookstr.nostr

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.Continuation
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Bridges NIP-55 Intent results into suspend functions.
 * Call [attach] from Activity.onResume and [detach] from onPause.
 */
class AmberIntentSession(
    activity: ComponentActivity,
) {
    private val pendingGetKey = AtomicReference<Continuation<Pair<String, String>>?>(null)
    private val pendingSign = AtomicReference<Continuation<org.json.JSONObject>?>(null)

    private val getPublicKeyLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingGetKey.getAndSet(null) ?: return@registerForActivityResult
            try {
                cont.resume(Nip55.parseGetPublicKeyResult(result.resultCode, result.data))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
        }

    private val signEventLauncher: ActivityResultLauncher<Intent> =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val cont = pendingSign.getAndSet(null) ?: return@registerForActivityResult
            try {
                cont.resume(Nip55.parseSignEventResult(result.resultCode, result.data))
            } catch (e: Exception) {
                cont.resumeWithException(e)
            }
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
            cont.invokeOnCancellation { pendingGetKey.compareAndSet(cont, null) }
            try {
                getPublicKeyLauncher.launch(Nip55.getPublicKeyIntent())
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
            cont.invokeOnCancellation { pendingSign.compareAndSet(cont, null) }
            try {
                signEventLauncher.launch(
                    Nip55.signEventIntent(eventJson, currentUserHex, signerPackage),
                )
            } catch (e: Exception) {
                pendingSign.compareAndSet(cont, null)
                cont.resumeWithException(e)
            }
        }

    object Host {
        @Volatile
        var session: AmberIntentSession? = null
    }
}
