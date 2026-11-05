package app.bookstr.speech

import android.app.Application
import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class SpeechSettingsTest {
    @Test fun clampsPreviouslyStoredRatesWhenReadingPreferences() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-legacy-rate-test", Context.MODE_PRIVATE)
        prefs.edit().putFloat("speech_rate_it", 2f).putFloat("speech_rate_en", 0.1f).commit()
        val settings = SpeechSettings(prefs)
        assertEquals(SpeechSettings.MAXIMUM_RATE, settings.rate("it"), 0.0001f)
        assertEquals(SpeechSettings.MINIMUM_RATE, settings.rate("en"), 0.0001f)
    }

    @Test fun perBookLanguageDefaultsToAutoAndRestoresOverridesIndependently() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-book-test", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        val settings = SpeechSettings(prefs)
        assertNull(settings.bookLanguage("portuguese"))
        assertEquals("en", settings.resolvedLanguage("portuguese", ""))
        assertEquals("ita", settings.resolvedLanguage("italian", "ita"))
        settings.setBookLanguage("portuguese", "por")
        settings.setBookLanguage("italian", "Italiano")
        val restored = SpeechSettings(prefs)
        assertEquals("pt-pt", restored.resolvedLanguage("portuguese", "en"))
        assertEquals("it", restored.resolvedLanguage("italian", "en"))
        assertEquals("de-DE", restored.resolvedLanguage("other", "de-DE"))
        restored.setBookLanguage("portuguese", null)
        assertNull(restored.bookLanguage("portuguese"))
        assertEquals("fr", restored.resolvedLanguage("portuguese", "fr"))
        assertEquals("it", restored.bookLanguage("italian"))
        restored.setBookLanguage("italian", " ")
        assertEquals("en", restored.resolvedLanguage("italian", "en"))
    }

    @Test fun overriddenLanguageSelectsItsConfiguredVoiceAndRate() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-book-voice-test", Context.MODE_PRIVATE)
        val settings = SpeechSettings(prefs)
        settings.setVoice("it", "kokoro_it")
        settings.setVoice("pt-br", "kokoro_pt_br")
        settings.setRate("it", 0.55f)
        for ((book, language, voice) in listOf(Triple("italian", "it", "kokoro_it"), Triple("portuguese", "pt-br", "kokoro_pt_br"))) {
            settings.setBookLanguage(book, language)
            assertEquals(voice, settings.voice(settings.resolvedLanguage(book, "en")))
        }
        assertEquals(0.55f, settings.rate(settings.resolvedLanguage("italian", "en")), 0.0001f)
    }

    @Test fun storesSeparateLanguageChoicesAcrossRepositoryRecreation() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-test", Context.MODE_PRIVATE)
        val settings = SpeechSettings(prefs)
        assertEquals("", settings.voice("nl"))
        settings.setVoice("Dutch", "piper_nl_nl_dii"); settings.setVoice("en", "kokoro_en")
        val restored = SpeechSettings(prefs)
        assertEquals("piper_nl_nl_dii", restored.voice("nld")); assertEquals("kokoro_en", restored.voice("en"))
        restored.setVoice("nl", "")
        assertEquals("", restored.voice("Dutch")); assertEquals("kokoro_en", restored.voice("English"))
    }

    @Test fun persistsItalianVoiceAndRateAcrossAliasesWithoutChangingEnglish() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-italian-test", Context.MODE_PRIVATE)
        val settings = SpeechSettings(prefs)
        settings.setVoice("Italiano", "kokoro_it")
        settings.setRate("ita", 0.55f)
        settings.setVoice("en", "kokoro_en")
        val restored = SpeechSettings(prefs)
        assertEquals("kokoro_it", restored.voice("it-IT"))
        assertEquals(0.55f, restored.rate("Italian"), 0.0001f)
        assertEquals("kokoro_en", restored.voice("en"))
    }

    @Test fun storesClampedReadingRatePerLanguageAcrossRepositoryRecreation() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("speech-rate-test", Context.MODE_PRIVATE)
        val settings = SpeechSettings(prefs)
        assertEquals(SpeechSettings.DEFAULT_RATE, settings.rate("nl"), 0.0001f)
        settings.setRate("Dutch", 0.55f)
        settings.setRate("en", 0.1f)
        val restored = SpeechSettings(prefs)
        assertEquals(0.55f, restored.rate("nld"), 0.0001f)
        assertEquals(SpeechSettings.MINIMUM_RATE, restored.rate("English"), 0.0001f)
        restored.setRate("nl", 0.9f)
        assertEquals(SpeechSettings.MAXIMUM_RATE, restored.rate("Dutch"), 0.0001f)
    }
}
