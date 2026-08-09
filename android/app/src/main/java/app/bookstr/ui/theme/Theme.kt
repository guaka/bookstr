package app.bookstr.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import app.bookstr.data.ReaderTheme

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
fun BookstrTheme(
    readerTheme: ReaderTheme = ReaderTheme.Paper,
    content: @Composable () -> Unit,
) {
    val colorScheme = when (readerTheme) {
        ReaderTheme.Paper -> PaperColorScheme
        ReaderTheme.Night -> NightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content,
    )
}

@Composable
fun BookstrThemeFromSettings(
    readerTheme: ReaderTheme,
    content: @Composable () -> Unit,
) = BookstrTheme(readerTheme = readerTheme, content = content)
