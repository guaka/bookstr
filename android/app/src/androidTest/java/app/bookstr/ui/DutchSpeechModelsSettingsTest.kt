package app.bookstr.ui

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.core.app.ApplicationProvider
import app.bookstr.speech.SpeechModel
import app.bookstr.speech.SpeechModels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class DutchSpeechModelsSettingsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun catalogDutchVoicesCanBeInstalledSelectedAndRemovedWithoutDownloads() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val models = SpeechModels(context).models
        val ids = listOf("piper_nl_nl_dii", "pocket_nl_daan", "piper_nl_be_nathalie", "piper_nl_be_rdh")
        val dutch = models.filter { it.id in ids }
        assertEquals("Expected the Dutch catalog voices", ids.toSet(), dutch.map { it.id }.toSet())

        var language by mutableStateOf("nl")
        var installed by mutableStateOf(setOf<String>())
        var voice by mutableStateOf("")
        compose.setContent {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                SpeechSettingsControls(
                    languages = listOf("nl"), language = language, voice = voice, models = dutch,
                    installed = installed, systemVoices = emptyList(), downloads = emptyMap(), errors = emptyMap(),
                    onLanguage = { language = it }, onVoice = { voice = it },
                    onInstall = { installed = installed + it.id },
                    onRemove = { model -> installed = installed - model.id; if (voice == model.id) voice = "" },
                )
            }
        }

        ids.forEach { id ->
            compose.onNodeWithTag("speech-model-$id").assertIsEnabled().performClick()
            compose.runOnIdle { assertTrue(id in installed) }
            compose.onNodeWithTag("speech-voice").performClick()
            compose.onNodeWithTag("speech-voice-option-$id").performClick()
            compose.runOnIdle { assertEquals(id, voice) }
            compose.onNodeWithTag("speech-model-$id").performClick()
            compose.runOnIdle { assertTrue(id !in installed); assertEquals("", voice) }
            compose.onNodeWithTag("speech-voice").performClick()
            compose.onNodeWithTag("speech-voice-option-$id").assertDoesNotExist()
            compose.onNodeWithTag("speech-voice-option-").performClick()
        }
    }
}
