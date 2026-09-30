package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Test

class TabletTypographyTest {
    @Test fun phoneKeepsSystemFontScale() {
        assertEquals(1f, tabletFontMultiplier(599))
    }

    @Test fun tabletIncreasesSystemFontScale() {
        assertEquals(1.2f, tabletFontMultiplier(600))
        assertEquals(1.2f, tabletFontMultiplier(800))
    }
}
