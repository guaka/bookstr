package app.bookstr

import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityLaunchTest {
    @Test fun readerResumeRequiresAnExistingPublicationAndBookId() {
        for (format in BookFormat.entries) {
            val session = ReaderSession("a".repeat(32), "Book", format)
            assertTrue(canRestoreReaderSession(session, publicationExists = true))
            assertFalse(canRestoreReaderSession(session, publicationExists = false))
            assertFalse(canRestoreReaderSession(session.copy(bookId = ""), publicationExists = true))
        }
    }
    @Test fun restoresLastReaderOnlyOnFreshLockScreenLaunch() {
        assertTrue(shouldRestoreReaderOnLaunch(true, true, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(false, true, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, false, false, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, true, false, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, false, true, null))
        assertFalse(shouldRestoreReaderOnLaunch(true, true, false, false, 3))
    }
}
