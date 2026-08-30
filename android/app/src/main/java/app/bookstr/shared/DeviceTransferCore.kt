package app.bookstr.shared

/**
 * Platform-neutral pairing state for native UI. Transport implementations
 * remain adapters: this core never carries addresses, torrent metadata, or
 * filesystem paths.
 */
enum class DeviceTransferReadiness {
    ConnectAccount,
    PairDevice,
    Ready,
}

data class VerifiedDevice(
    val id: String,
    val name: String,
)

data class DeviceTransferRequest(
    val bookId: String,
    val recipientDeviceId: String,
)

object DeviceTransferCore {
    fun readiness(accountConnected: Boolean, devices: List<VerifiedDevice>): DeviceTransferReadiness = when {
        !accountConnected -> DeviceTransferReadiness.ConnectAccount
        devices.none { it.id.isNotBlank() } -> DeviceTransferReadiness.PairDevice
        else -> DeviceTransferReadiness.Ready
    }

    fun request(bookId: String?, recipientDeviceId: String?): DeviceTransferRequest? {
        val normalizedBookId = bookId?.trim().orEmpty()
        val normalizedRecipient = recipientDeviceId?.trim().orEmpty()
        if (normalizedBookId.isEmpty() || normalizedRecipient.isEmpty()) return null
        return DeviceTransferRequest(normalizedBookId, normalizedRecipient)
    }
}
