package app.bookstr.speech

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

/** Runs outside Robolectric's sandbox so JaCoCo can measure the preference logic. */
class BookSpeechLanguageTest {
    @Test fun languageChoiceIsBookScopedWhileVoiceAndSpeedRemainLanguageScoped() {
        val preferences = MemoryPreferences().preferences
        val settings = SpeechSettings(preferences)
        assertNull(settings.bookLanguage("italian"))
        assertEquals("en", settings.resolvedLanguage("italian", ""))
        assertEquals("pt-BR", settings.resolvedLanguage("portuguese", "pt-BR"))
        settings.setVoice("it", "kokoro_it")
        settings.setRate("it", 0.55f)
        settings.setBookLanguage("italian", "ita")
        settings.setBookLanguage("portuguese", "por")
        val reopened = SpeechSettings(preferences)
        val language = reopened.resolvedLanguage("italian", "en")
        assertEquals("it", language)
        assertEquals("kokoro_it", reopened.voice(language))
        assertEquals(0.55f, reopened.rate(language), 0.0001f)
        assertEquals("pt-pt", reopened.resolvedLanguage("portuguese", "en"))
        reopened.setBookLanguage("italian", null)
        assertEquals("en-US", reopened.resolvedLanguage("italian", "en-US"))
        assertEquals("pt-pt", reopened.bookLanguage("portuguese"))
        reopened.setBookLanguage("portuguese", " ")
        assertNull(reopened.bookLanguage("portuguese"))
        preferences.edit().putFloat("speech_rate_en", 5f).apply()
        assertEquals(SpeechSettings.MAXIMUM_RATE, reopened.rate("en"), 0.0001f)
    }

    private class MemoryPreferences {
        private val values = mutableMapOf<String, Any?>()
        private val editor: SharedPreferences.Editor = Proxy.newProxyInstance(
            SharedPreferences.Editor::class.java.classLoader, arrayOf(SharedPreferences.Editor::class.java),
        ) { proxy, method, args ->
            when (method.name) {
                "putString", "putFloat" -> { values[args[0] as String] = args[1]; proxy }
                "apply" -> null
                else -> error("Unexpected editor operation: ${method.name}")
            }
        } as SharedPreferences.Editor
        val preferences: SharedPreferences = Proxy.newProxyInstance(
            SharedPreferences::class.java.classLoader, arrayOf(SharedPreferences::class.java),
        ) { _, method, args ->
            when (method.name) {
                "getString", "getFloat" -> values[args[0] as String] ?: args[1]
                "edit" -> editor
                else -> error("Unexpected preference operation: ${method.name}")
            }
        } as SharedPreferences
    }
}
