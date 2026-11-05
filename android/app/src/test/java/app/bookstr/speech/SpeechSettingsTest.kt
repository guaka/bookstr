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
    @Test fun normalizesLanguageAliasesRegionsAndBlankInput() {
        assertEquals("en", SpeechLanguages.tag("  English "))
        assertEquals("pt-br", SpeechLanguages.tag("Portuguese-BR"))
        assertEquals("pt-pt", SpeechLanguages.tag("por"))
        assertEquals("fr", SpeechLanguages.tag("FRA_ca"))
        assertEquals("de", SpeechLanguages.tag("German-DE"))
        assertEquals("it", SpeechLanguages.tag("Italiano-IT"))
        assertEquals("es", SpeechLanguages.tag("spa"))
        assertEquals("ca", SpeechLanguages.tag("CAT"))
        assertEquals("nl", SpeechLanguages.tag("Nederlands"))
        assertEquals("en", SpeechLanguages.tag("  "))
        assertFalse(SpeechLanguages.name("en").isBlank())
    }

    @Test fun availableLanguagesNormalizesAndDeduplicatesSeedAndDeviceCodes() {
        val available = SpeechLanguages.available(listOf("EN-us", "pt_BR", " Dutch ", "", "fr"))
        assertEquals(available.size, available.toSet().size)
        assertTrue(available.containsAll(listOf("en", "pt-br", "pt-pt", "nl", "fr", "ca", "de", "es", "it")))
        assertFalse(available.contains(""))
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
