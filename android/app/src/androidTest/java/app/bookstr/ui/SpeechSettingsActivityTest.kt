package app.bookstr.ui

import android.content.Context
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.NarrationService
import app.bookstr.speech.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.Rule
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain

class SpeechSettingsActivityTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val app get() = ApplicationProvider.getApplicationContext<BookstrApp>()
    private val clean = object : ExternalResource() {
        override fun before() { app.settingsRepository.clearReaderSession(); app.settingsRepository.catalogConnection = null }
    }
    @get:Rule val rules: RuleChain = RuleChain.outerRule(clean).around(compose)
    private fun dutch() {
        compose.onNodeWithTag("speech-language").performScrollTo().performClick()
        compose.onNodeWithTag("speech-language-option-nl").performClick()
    }
    @Test fun realVoiceDownloadPersistsThroughRecreationAndCanBeRemoved() {
        val store = SpeechModels(app)
        val model = store.models.first { it.language == "nl" }
        store.remove(model)
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice("nl", "")
        compose.onNodeWithContentDescription("Settings").performClick()
        dutch()
        compose.onNodeWithTag("speech-model-${model.id}").performScrollTo().performClick()
        compose.waitUntil(180_000) { store.installed(model) && settings.voice("Dutch") == model.id }
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains("Dii · Nederlands", substring = true)
        compose.activityRule.scenario.recreate()
        compose.onNodeWithContentDescription("Settings").performClick()
        dutch()
        compose.onNodeWithTag("speech-voice").performScrollTo().assertTextContains("Dii · Nederlands", substring = true)
        compose.onNodeWithTag("speech-model-${model.id}").performScrollTo().performClick()
        compose.runOnIdle { assertFalse(store.installed(model)); assertEquals("", settings.voice("nl")) }
    }
}
