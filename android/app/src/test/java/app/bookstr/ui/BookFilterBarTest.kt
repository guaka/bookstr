package app.bookstr.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class BookFilterBarTest {
    @Test fun languageLabelsResolveThreeLetterCodesAndPreserveUnknownValues() {
        assertEquals("English", languageDisplayName("eng"))
        assertEquals("Portuguese", languageDisplayName(" pt_BR "))
        assertEquals("Undefined", languageDisplayName("UND"))
        assertEquals("", languageDisplayName(""))
        assertEquals("zz", languageDisplayName("zz"))
        assertEquals("zzz", languageDisplayName("zzz"))
    }
}
