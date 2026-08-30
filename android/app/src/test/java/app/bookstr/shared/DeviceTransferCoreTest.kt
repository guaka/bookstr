package app.bookstr.shared

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceTransferCoreTest {
    @Test
    fun readinessGuidesAccountPairingAndTransferUI() {
        assertEquals(DeviceTransferReadiness.ConnectAccount, DeviceTransferCore.readiness(false, emptyList()))
        assertEquals(DeviceTransferReadiness.PairDevice, DeviceTransferCore.readiness(true, emptyList()))
        assertEquals(DeviceTransferReadiness.Ready, DeviceTransferCore.readiness(true, listOf(VerifiedDevice("phone-1", "Phone"))))
    }

    @Test
    fun requestOnlyContainsNormalizedBookAndDeviceIds() {
        assertEquals(
            DeviceTransferRequest("book-1", "phone-1"),
            DeviceTransferCore.request("  book-1 ", " phone-1 "),
        )
        assertNull(DeviceTransferCore.request(" ", "phone-1"))
        assertNull(DeviceTransferCore.request("book-1", null))
        assertNull(DeviceTransferCore.request("book\n1", "phone-1"))
        assertNull(DeviceTransferCore.request("b".repeat(257), "phone-1"))
        assertNull(DeviceTransferCore.request("book-1", "p".repeat(129)))
    }

    @Test
    fun readinessIgnoresMalformedDeviceIdentifiers() {
        assertEquals(
            DeviceTransferReadiness.PairDevice,
            DeviceTransferCore.readiness(true, listOf(VerifiedDevice(" \n ", "Unnamed"), VerifiedDevice("bad\u0000id", "Bad"))),
        )
        assertEquals(
            DeviceTransferReadiness.Ready,
            DeviceTransferCore.readiness(true, listOf(VerifiedDevice("  device-2 ", "Phone"))),
        )
    }
}
