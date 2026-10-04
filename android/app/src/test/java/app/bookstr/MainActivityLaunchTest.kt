package app.bookstr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityLaunchTest {
    @Test fun restoresLastReaderOnlyOnFreshLockScreenLaunch() {
        assertTrue(shouldRestoreReaderOnLaunch(true, true, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(false, true, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, false, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, true, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, false, true, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, false, false, 3))
    }
}
