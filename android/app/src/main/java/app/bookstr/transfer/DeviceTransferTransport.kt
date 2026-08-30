package app.bookstr.transfer

import app.bookstr.shared.DeviceTransferRequest
import kotlinx.coroutines.flow.Flow

/**
 * Native UI seam for a foreground WebTorrent/WebRTC implementation. The
 * control payload is decoded by the Nostr/transport adapter and is never
 * exposed to Compose state.
 */
interface DeviceTransferTransport {
    fun start(request: DeviceTransferRequest, control: TransferControl): Flow<TransferUpdate>
    fun cancel(requestId: String)
}

class TransferControl private constructor(private val opaquePayload: String) {
    internal fun <T> usePayload(block: (String) -> T): T = block(opaquePayload)

    override fun toString(): String = "TransferControl(redacted)"

    companion object {
        internal fun fromOpaquePayload(opaquePayload: String): TransferControl = TransferControl(opaquePayload)
    }
}

enum class TransferPhase { Idle, Preparing, Transferring, Completed, Failed, Cancelled }

data class TransferUpdate(
    val requestId: String,
    val phase: TransferPhase,
    val completedBytes: Long = 0,
    val totalBytes: Long = 0,
    val errorCode: String? = null,
)

object TransferUpdateMapper {
    fun safe(requestId: String?, phase: String?, completedBytes: Long? = null, totalBytes: Long? = null, errorCode: String? = null): TransferUpdate? {
        val id = requestId?.trim().orEmpty()
        val mappedPhase = TransferPhase.entries.firstOrNull { it.name.equals(phase?.trim(), ignoreCase = true) }
        if (id.isEmpty() || id.length > 128 || id.any { it.isISOControl() } || mappedPhase == null) return null
        val total = (totalBytes ?: 0).coerceAtLeast(0)
        val completed = (completedBytes ?: 0).coerceAtLeast(0).let { if (total > 0) it.coerceAtMost(total) else it }
        val safeError = errorCode?.trim()?.takeIf { it.isNotEmpty() && it.none(Char::isISOControl) }?.take(80)
        return TransferUpdate(id, mappedPhase, completed, total, safeError)
    }
}
