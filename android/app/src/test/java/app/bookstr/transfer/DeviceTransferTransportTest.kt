package app.bookstr.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceTransferTransportTest {
    @Test
    fun mapperOnlyReturnsUserSafeTransferState() {
        val update = TransferUpdateMapper.safe("request-1", " TRANSFERRING ", 12, 10, "  failed  ")
        assertEquals(TransferPhase.Transferring, update?.phase)
        assertEquals(10L, update?.completedBytes)
        assertEquals(10L, update?.totalBytes)
        assertEquals("failed", update?.errorCode)
        assertNull(TransferUpdateMapper.safe("", "completed"))
        assertNull(TransferUpdateMapper.safe("request-1", "unknown"))
        assertNull(TransferUpdateMapper.safe("request\n1", "completed"))
        assertNull(TransferUpdateMapper.safe("r".repeat(129), "completed"))
        assertNull(TransferUpdateMapper.safe("request-1", "failed", errorCode = "bad\nerror")?.errorCode)
    }

    @Test
    fun controlPayloadIsUsableOnlyThroughTheRedactedWrapper() {
        val control = TransferControl.fromOpaquePayload("private-control")
        assertEquals("private-control", control.usePayload { it })
        assertEquals("TransferControl(redacted)", control.toString())
    }
}
