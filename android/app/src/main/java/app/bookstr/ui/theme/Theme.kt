package app.bookstr.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.input.InputMode
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInputModeManager
import androidx.compose.ui.unit.Density
import app.bookstr.appFontMultiplier
import app.bookstr.isTelevision
import app.bookstr.data.ReaderTheme

private val WhiteColorScheme = lightColorScheme(
    primary = WhitePrimary,
    onPrimary = WhiteSurface,
    secondary = WhiteSecondary,
    background = WhiteBackground,
    surface = WhiteSurface,
    onBackground = WhiteOnBackground,
    onSurface = WhiteOnBackground,
)

private val PaperColorScheme = lightColorScheme(
    primary = PaperPrimary,
    onPrimary = PaperSurface,
    secondary = PaperSecondary,
    background = PaperBackground,
    surface = PaperSurface,
    onBackground = PaperOnBackground,
    onSurface = PaperOnBackground,
)

private val NightColorScheme = darkColorScheme(
    primary = NightPrimary,
    onPrimary = NightBackground,
    secondary = NightSecondary,
    background = NightBackground,
    surface = NightSurface,
    onBackground = NightOnBackground,
    onSurface = NightOnBackground,
)

@Composable
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun BookstrTheme(
    readerTheme: ReaderTheme = ReaderTheme.Paper,
    content: @Composable () -> Unit,
) {
    val colorScheme = when (readerTheme) {
        ReaderTheme.White -> WhiteColorScheme
        ReaderTheme.Paper -> PaperColorScheme
        ReaderTheme.Night -> NightColorScheme
    }

    val density = LocalDensity.current
    val configuration = LocalConfiguration.current
    val television = isTelevision(configuration.uiMode)
    val inputMode = LocalInputModeManager.current
    LaunchedEffect(television, inputMode) {
        if (television) inputMode.requestInputMode(InputMode.Keyboard)
    }
    val multiplier = appFontMultiplier(configuration.uiMode, configuration.smallestScreenWidthDp)
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * multiplier)) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = Typography,
            content = content,
        )
    }
}

@Composable
fun BookstrThemeFromSettings(
    readerTheme: ReaderTheme,
    content: @Composable () -> Unit,
) = BookstrTheme(readerTheme = readerTheme, content = content)
