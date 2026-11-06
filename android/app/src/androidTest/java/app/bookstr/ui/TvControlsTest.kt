package app.bookstr.ui

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import app.bookstr.ui.theme.BookstrTheme
import app.bookstr.speech.SpeechModel
import app.bookstr.speech.SpeechModelFile
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalTestApi::class)
class TvControlsTest {
    @get:Rule val compose = createComposeRule()

    private fun television(content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.setContent {
            val configuration = Configuration(LocalConfiguration.current).apply {
                uiMode = Configuration.UI_MODE_TYPE_TELEVISION or Configuration.UI_MODE_NIGHT_YES
            }
            CompositionLocalProvider(LocalConfiguration provides configuration) { BookstrTheme { content() } }
        }
    }

    @Test fun remoteFocusAndSelectReachEveryReaderControl() {
        var previous = 0; var next = 0; var speech = 0; var tab = -1
        television {
            ReaderBottomNavigation({ tab = it }, onPrevious = { previous++ }, onNext = { next++ }, onSpeech = { speech++ })
        }
        compose.onNodeWithTag("reader.show-navigation").assertDoesNotExist()
        compose.onNodeWithTag("tv.reader.speech").assertIsFocused()
            .performKeyInput { pressKey(Key.DirectionLeft) }
        compose.onNodeWithTag("tv.reader.next").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter) }
        compose.onNodeWithTag("tv.reader.next").performKeyInput { pressKey(Key.DirectionLeft) }
        compose.onNodeWithTag("tv.reader.previous").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter); pressKey(Key.DirectionRight); pressKey(Key.DirectionRight) }
        compose.onNodeWithTag("tv.reader.speech").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter); pressKey(Key.DirectionRight) }
        compose.onNodeWithTag("tv.reader.library").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter) }
        compose.runOnIdle { assertEquals(1, previous); assertEquals(1, next); assertEquals(1, speech); assertEquals(0, tab) }
    }

    @Test fun narrationControlShowsPlaybackStateWithoutStealingFocusOnPause() {
        television {
            var speaking by remember { mutableStateOf(true) }
            ReaderBottomNavigation({}, onSpeech = { speaking = !speaking }, isSpeaking = speaking)
        }
        compose.onNodeWithContentDescription("Pause narration").assertIsFocused()
            .performKeyInput { pressKey(Key.DirectionCenter) }
        compose.onNodeWithContentDescription("Resume narration").assertIsFocused()
            .performKeyInput { pressKey(Key.DirectionCenter) }
        compose.onNodeWithContentDescription("Pause narration").assertIsFocused()
    }

    @Test fun readersWithoutSpeechHaveNoInertSpeechControl() {
        television { ReaderBottomNavigation({}, onPrevious = {}, onNext = {}) }
        compose.onNodeWithTag("tv.reader.speech").assertDoesNotExist()
        compose.onNodeWithTag("tv.reader.next").assertIsFocused().performKeyInput { pressKey(Key.DirectionRight) }
        compose.onNodeWithTag("tv.reader.library").assertIsFocused()
    }

    @Test fun remoteCanSelectEveryAppDestination() {
        var selected = -1
        television { BookstrNavigationBar(0) { selected = it } }
        for ((tag, id) in listOf("library" to 0, "search" to 3, "words" to 1, "settings" to 2)) {
            compose.onNodeWithTag("tab.$tag")
                .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus)
            compose.onNodeWithTag("tab.$tag").assertIsFocused()
                .performKeyInput { pressKey(Key.DirectionCenter) }
            compose.runOnIdle { assertEquals(id, selected) }
        }
    }

    @Test fun remoteReachesEnglishKokoroDownloadBelowScrolledSettings() {
        val english = SpeechModel("kokoro_en", "en", "Kokoro · English", "fixture", "revision", "kokoro", "model",
            listOf(SpeechModelFile("model", 1024)))
        var downloaded = false
        television {
            var downloads by remember { mutableStateOf<Map<String, Float>>(emptyMap()) }
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(1200.dp))
                SpeechSettingsControls(listOf("en"), "en", "", listOf(english), emptySet(), emptyList(), downloads, emptyMap(),
                    {}, {}, { downloaded = true; downloads = mapOf(it.id to 0.5f) }, {})
            }
        }
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag("speech-language").assertIsDisplayed() }.isSuccess }
        compose.onNodeWithTag("speech-language").assertIsFocused().assertIsDisplayed()
            .performKeyInput { pressKey(Key.DirectionDown) }
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag("speech-model-kokoro_en").assertIsDisplayed() }.isSuccess }
        compose.onNodeWithTag("speech-model-kokoro_en").assertIsFocused().assertIsDisplayed()
            .performKeyInput { pressKey(Key.DirectionCenter) }
        compose.runOnIdle { assertTrue(downloaded) }
        compose.onNodeWithTag("speech-download-progress-kokoro_en").assertExists()
        compose.onNodeWithTag("speech-language")
            .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus)
        compose.onNodeWithTag("speech-language").performKeyInput { pressKey(Key.DirectionDown) }
        compose.onNodeWithTag("speech-voice").assertIsFocused()
            .performKeyInput { pressKey(Key.DirectionUp) }
        compose.onNodeWithTag("speech-language").assertIsFocused()
    }

    @Test fun libraryRowsAndFiltersWorkWithDpad() {
        val book = CatalogBook("tv-fixture", "Remote book", "Author", "https://example.org/a.epub", null, format = BookFormat.Epub)
        var opened: CatalogBook? = null
        television {
            LibraryScreen(listOf(book), emptySet(), emptyList(), emptyMap(), false, error = null,
                onRefresh = {}, onOpenBook = { opened = it }, onOpenExternal = {}, publicationSize = { 1024L })
        }
        compose.onNodeWithTag("library.language").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus)
        compose.onNodeWithTag("library.language").performKeyInput { pressKey(Key.DirectionCenter) }
        compose.onNodeWithTag("library.language.all").assertIsDisplayed().performKeyInput { pressKey(Key.Back) }
        compose.onNodeWithTag("library.open.tv-fixture").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.RequestFocus)
        compose.onNodeWithTag("library.open.tv-fixture").assertIsFocused().performKeyInput { pressKey(Key.DirectionCenter) }
        compose.runOnIdle { assertEquals(book, opened) }
    }

    @Test fun themeUsesDistanceScaleAndInsetLeavesControlsSpace() {
        var scale = 0f
        var systemScale = 0f
        compose.setContent {
            val configuration = Configuration(LocalConfiguration.current).apply { uiMode = Configuration.UI_MODE_TYPE_TELEVISION }
            systemScale = LocalDensity.current.fontScale
            CompositionLocalProvider(LocalConfiguration provides configuration) {
                BookstrTheme { scale = LocalDensity.current.fontScale
                    androidx.compose.foundation.layout.Box(Modifier.testTag("publication").tvReaderInset())
                }
            }
        }
        compose.runOnIdle { assertEquals(systemScale * 1.5f, scale, 0.01f) }
        compose.onNodeWithTag("publication").assertHeightIsEqualTo(androidx.compose.ui.unit.Dp(112f))
    }
}
