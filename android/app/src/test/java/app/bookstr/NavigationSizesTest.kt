package app.bookstr

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationSizesTest {
    @Test fun phoneIconsAndBarHaveStandardSize() {
        assertEquals(24.dp to 56.dp, navigationSizes(599))
    }

    @Test fun tabletIconsAndBarAreLarger() {
        assertEquals(32.dp to 64.dp, navigationSizes(600))
        assertEquals(32.dp to 64.dp, navigationSizes(800))
    }
}
