package app.bookstr.ui

import android.content.Context
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import app.bookstr.ui.theme.BookstrTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class TabletThemeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun appTextRespectsSystemScaleAndTabletSize() {
        val systemScale = ApplicationProvider.getApplicationContext<Context>()
            .resources.configuration.fontScale
        val smallestWidth = ApplicationProvider.getApplicationContext<Context>()
            .resources.configuration.smallestScreenWidthDp
        var renderedScale = 0f
        compose.setContent {
            BookstrTheme { renderedScale = LocalDensity.current.fontScale }
        }
        compose.runOnIdle {
            assertEquals(systemScale * if (smallestWidth >= 600) 1.2f else 1f, renderedScale, 0.01f)
        }
    }
}
