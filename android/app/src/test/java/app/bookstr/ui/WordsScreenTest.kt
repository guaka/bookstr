package app.bookstr.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WordsScreenTest {
    @Test
    fun exactDeletedWordFilterIsClearedIgnoringCaseAndWhitespace() {
        assertTrue(shouldClearWordFilter("  Ephemeral ", "ephemeral"))
    }

    @Test
    fun partialOrUnrelatedFiltersArePreserved() {
        assertFalse(shouldClearWordFilter("ephem", "ephemeral"))
        assertFalse(shouldClearWordFilter("another", "ephemeral"))
    }
}
