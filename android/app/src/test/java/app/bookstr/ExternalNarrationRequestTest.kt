package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalNarrationRequestTest {
    @Test
    fun requestTokenIsBoundToBookAndCanOnlyBeConsumedOnce() {
        val token = "external-reader-token-test"
        ExternalNarrationRequestTokens.register(token, "0123456789abcdef0123456789abcdef")

        assertFalse(ExternalNarrationRequestTokens.consume(token, "fedcba9876543210fedcba9876543210"))
        assertTrue(ExternalNarrationRequestTokens.consume(token, "0123456789abcdef0123456789abcdef"))
        assertFalse(ExternalNarrationRequestTokens.consume(token, "0123456789abcdef0123456789abcdef"))
        ExternalNarrationRequestTokens.revoke(token)
    }

    @Test
    fun canceledReaderRevokesItsRequestToken() {
        val token = "external-reader-token-canceled"
        val bookId = "0123456789abcdef0123456789abcdef"
        ExternalNarrationRequestTokens.register(token, bookId)

        ExternalNarrationRequestTokens.revoke(token)

        assertFalse(ExternalNarrationRequestTokens.consume(token, bookId))
    }

    @Test
    fun oldReaderResponseRemainsValidUntilNewReaderRequestsPlayback() {
        val oldBook = "11111111111111111111111111111111"
        val newBook = "22222222222222222222222222222222"
        val oldToken = "external-reader-old"
        val newToken = "external-reader-new"
        ExternalNarrationRequestTokens.register(oldToken, oldBook)
        assertTrue(ExternalNarrationRequestTokens.activate(oldToken, oldBook))

        ExternalNarrationRequestTokens.register(newToken, newBook)
        assertTrue("A remains active while B is still loading", ExternalNarrationRequestTokens.isCurrent(oldToken, oldBook))
        assertFalse(ExternalNarrationRequestTokens.isCurrent(newToken, newBook))

        assertTrue("B becomes current only after its ready request", ExternalNarrationRequestTokens.consume(newToken, newBook))
        assertFalse("A's late speech response is now stale", ExternalNarrationRequestTokens.isCurrent(oldToken, oldBook))
        assertTrue(ExternalNarrationRequestTokens.isCurrent(newToken, newBook))

        ExternalNarrationRequestTokens.revoke(oldToken)
        ExternalNarrationRequestTokens.revoke(newToken)
    }

    @Test
    fun externalReaderUsesLatestSavedPositionBeforeCatalogSnapshot() {
        val requested = "epubcfi(/6/4!/4/2)"
        val latest = "epubcfi(/6/8!/4/6)"

        assertEquals(latest, ReaderInitialLocation.resolve(true, latest, requested))
        assertEquals(requested, ReaderInitialLocation.resolve(true, "", requested))
        assertEquals(requested, ReaderInitialLocation.resolve(false, latest, requested))
    }
}
