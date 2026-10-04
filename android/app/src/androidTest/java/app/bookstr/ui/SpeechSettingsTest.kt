package app.bookstr.ui

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import app.bookstr.speech.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class SpeechSettingsTest {
    @get:Rule val compose = createComposeRule()
    @Test fun filtersVoicesDownloadsSelectsAndRemovesWithoutChangingOtherLanguages() {
        val dutch = SpeechModel("dutch", "nl", "Dii · Nederlands", "repo", "revision", "vits", "model", listOf(SpeechModelFile("model", 63_000_000)))
        val dutch2 = dutch.copy(id = "dutch2", label = "Dutch alternate")
        val english = dutch.copy(id = "english", language = "en", label = "Kokoro · English")
        var language by mutableStateOf("en")
        var installed by mutableStateOf(setOf("english"))
        var voices by mutableStateOf(mapOf("en" to "english"))
        var downloads by mutableStateOf<Map<String, Float>>(emptyMap())
        var errors by mutableStateOf<Map<String, String>>(emptyMap())
        compose.setContent {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                SpeechSettingsControls(SpeechLanguages.available(emptyList()), language, voices[language].orEmpty(), listOf(dutch, dutch2, english), installed,
                    listOf("device" to "Device voice"), downloads, errors,
                    { language = it }, { voices = voices + (language to it) },
                    { downloads = downloads + (it.id to 0.5f) }, { installed = installed - it.id; voices = voices + (language to "") })
            }
        }
        compose.onNodeWithTag("speech-language").performClick()
        compose.onNodeWithTag("speech-language-option-nl").performClick()
        compose.onNodeWithTag("speech-model-english").assertDoesNotExist()
        compose.onNodeWithTag("speech-model-dutch").performClick()
        compose.onNodeWithTag("speech-download-progress-dutch").assertExists()
        compose.onNodeWithTag("speech-model-dutch").assertIsNotEnabled()
        compose.onNodeWithTag("speech-model-dutch2").assertIsEnabled().performClick()
        compose.onNodeWithTag("speech-download-progress-dutch2").assertExists()
        compose.runOnIdle { downloads = emptyMap(); installed = installed + "dutch" }
        compose.onNodeWithTag("speech-voice").performClick()
        compose.onNodeWithTag("speech-voice-option-dutch").performClick()
        compose.runOnIdle { assertEquals("dutch", voices["nl"]); assertEquals("english", voices["en"]) }
        compose.onNodeWithTag("speech-voice").performClick()
        compose.onNodeWithTag("speech-voice-option-device").performClick()
        compose.onNodeWithTag("speech-model-dutch").performClick()
        compose.runOnIdle { assertEquals("", voices["nl"]); assertEquals("english", voices["en"]); errors = mapOf("dutch" to "Download failed") }
        compose.onNodeWithTag("speech-error-dutch").assertTextEquals("Download failed")
        compose.onNodeWithTag("speech-voice").performClick()
        compose.onNodeWithTag("speech-voice-option-dutch").assertDoesNotExist()
        compose.onNodeWithTag("speech-voice-option-").performClick()
    }
}
