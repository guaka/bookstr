package app.bookstr.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceTransferTransportTest {
    @Test
    fun mapperOnlyReturnsUserSafeTransferState() {
        assertEquals(TransferPhase.Transferring, TransferUpdateMapper.safe("request-1", "transferring", -2, -1)?.phase)
        assertEquals(0, TransferUpdateMapper.safe("request-1", "transferring", -2, -1)?.completedBytes)
        assertNull(TransferUpdateMapper.safe("", "completed"))
        assertNull(TransferUpdateMapper.safe("request-1", "unknown"))
    }
}
