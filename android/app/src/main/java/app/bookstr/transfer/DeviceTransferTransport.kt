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

data class TransferControl internal constructor(val opaquePayload: String)

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
        val mappedPhase = runCatching { TransferPhase.valueOf(phase?.trim().orEmpty().replaceFirstChar { it.uppercase() }) }.getOrNull()
        if (id.isEmpty() || mappedPhase == null) return null
        return TransferUpdate(id, mappedPhase, (completedBytes ?: 0).coerceAtLeast(0), (totalBytes ?: 0).coerceAtLeast(0), errorCode?.trim()?.take(80))
    }
}
