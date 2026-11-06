package app.bookstr.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceTransferTransportTest {
    @Test
    fun mapperHandlesUnknownTotalsAndOptionalErrorsAcrossLifecycleStates() {
        for (phase in TransferPhase.entries) {
            val update = TransferUpdateMapper.safe("request-2", phase.name)!!
            assertEquals(phase, update.phase)
            assertEquals(0L, update.completedBytes)
            assertEquals(0L, update.totalBytes)
            assertNull(update.errorCode)
        }
        assertNull(TransferUpdateMapper.safe(null, "idle"))
        assertNull(TransferUpdateMapper.safe("request-2", null))
        val unknownTotal = TransferUpdateMapper.safe("request-2", "transferring", 12, -1, "  ")!!
        assertEquals(12L, unknownTotal.completedBytes)
        assertEquals(0L, unknownTotal.totalBytes)
        assertNull(unknownTotal.errorCode)
        val failed = TransferUpdateMapper.safe("request-2", "failed", -1, errorCode = "e".repeat(100))!!
        assertEquals(0L, failed.completedBytes)
        assertEquals(80, failed.errorCode!!.length)
    }

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
