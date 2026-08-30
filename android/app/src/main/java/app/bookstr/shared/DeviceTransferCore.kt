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
    private fun identifier(value: String?, maxLength: Int): String? {
        val normalized = value?.trim().orEmpty()
        if (normalized.isEmpty() || normalized.length > maxLength || normalized.any { it.isISOControl() }) return null
        return normalized
    }

    fun readiness(accountConnected: Boolean, devices: List<VerifiedDevice>): DeviceTransferReadiness = when {
        !accountConnected -> DeviceTransferReadiness.ConnectAccount
        devices.none { identifier(it.id, 128) != null } -> DeviceTransferReadiness.PairDevice
        else -> DeviceTransferReadiness.Ready
    }

    fun request(bookId: String?, recipientDeviceId: String?): DeviceTransferRequest? {
        val normalizedBookId = identifier(bookId, 256) ?: return null
        val normalizedRecipient = identifier(recipientDeviceId, 128) ?: return null
        return DeviceTransferRequest(normalizedBookId, normalizedRecipient)
    }
}
