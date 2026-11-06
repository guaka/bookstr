package app.bookstr

import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityLaunchTest {
    @Test fun readerResumeRequiresAnAvailableDownloadedFormatAndKeepsLegacySessionData() {
        val fb2 = ReaderSession("b".repeat(32), "Legacy", BookFormat.Fb2, locator = "fb2:1:2")
        val epub = fb2.copy(bookId = "a".repeat(32), bookTitle = "Current", format = BookFormat.Epub)

        assertFalse(canRestoreReaderSession(fb2, publicationExists = true))
        assertFalse(canRestoreReaderSession(fb2, publicationExists = false))
        assertTrue(canRestoreReaderSession(epub, publicationExists = true))
        assertFalse(canRestoreReaderSession(epub, publicationExists = false))
        assertEquals("fb2:1:2", fb2.locator)
        assertEquals(BookFormat.Fb2, fb2.format)
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
