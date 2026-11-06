package app.bookstr

import android.content.res.Configuration
import org.junit.Assert.*
import org.junit.Test

class TvModeTest {
    @Test fun televisionDetectionIgnoresNightMode() {
        assertTrue(isTelevision(Configuration.UI_MODE_TYPE_TELEVISION))
        assertTrue(isTelevision(Configuration.UI_MODE_TYPE_TELEVISION or Configuration.UI_MODE_NIGHT_YES))
        for (type in listOf(Configuration.UI_MODE_TYPE_NORMAL, Configuration.UI_MODE_TYPE_CAR, Configuration.UI_MODE_TYPE_DESK, 0)) {
            assertFalse(isTelevision(type))
        }
    }

    @Test fun distanceTypographyPreservesPhoneAndTabletScaling() {
        assertEquals(1.5f, appFontMultiplier(Configuration.UI_MODE_TYPE_TELEVISION, 320))
        assertEquals(1.5f, appFontMultiplier(Configuration.UI_MODE_TYPE_TELEVISION, 960))
        assertEquals(1f, appFontMultiplier(Configuration.UI_MODE_TYPE_NORMAL, 599))
        assertEquals(1.2f, appFontMultiplier(Configuration.UI_MODE_TYPE_NORMAL, 600))
        // Existing uncovered boundary: unknown screen sizes use phone typography.
        assertEquals(1f, tabletFontMultiplier(0))
    }
}
