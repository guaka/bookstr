package app.bookstr.speech

import android.content.Context
import android.content.ContextWrapper
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import androidx.test.core.app.ApplicationProvider
import app.bookstr.NarrationService
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.Locale

class DeviceVoicePreferenceTest {
    private class Engine(context: Context) : TextToSpeech(context, {}) {
        val dutch = Voice("Dutch device voice", Locale.forLanguageTag("nl-NL"), Voice.QUALITY_HIGH, Voice.LATENCY_NORMAL, false, emptySet())
        var selected: Voice? = null
        var text: String? = null
        var selectedLocale: Locale? = null
        override fun getVoices(): Set<Voice> = setOf(dutch)
        override fun setVoice(voice: Voice): Int { selected = voice; return SUCCESS }
        override fun isLanguageAvailable(locale: Locale): Int = LANG_AVAILABLE
        override fun setLanguage(locale: Locale): Int { selectedLocale = locale; return LANG_AVAILABLE }
        override fun synthesizeToFile(text: CharSequence, params: android.os.Bundle, file: File, utteranceId: String): Int {
            this.text = text.toString(); return SUCCESS
        }
    }
    @Test fun appliesDevicePreferenceToSynthesisAndKeepsNeuralIndependentOfSystemInitialization() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val service = NarrationService()
        ContextWrapper::class.java.getDeclaredMethod("attachBaseContext", Context::class.java).apply { isAccessible = true }.invoke(service, app)
        fun field(name: String, value: Any) { NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }.set(service, value) }
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val before = settings.voice("nl")
        val engine = Engine(app)
        try {
            settings.setVoice("nl", engine.dutch.name)
            field("textToSpeech", engine); field("speechLanguage", "nl"); field("speechText", "Hallo wereld.")
            NarrationService::class.java.getDeclaredMethod("startSpeakingAt", Int::class.javaPrimitiveType).apply { isAccessible = true }.invoke(service, 0)
            assertEquals(engine.dutch, engine.selected); assertEquals("Hallo wereld.", engine.text)
            settings.setVoice("nl", "uninstalled")
            NarrationService::class.java.getDeclaredMethod("selectVoice", TextToSpeech::class.java, String::class.java).apply { isAccessible = true }.invoke(service, engine, "nl")
            assertEquals("nl", engine.selectedLocale?.language)
            settings.setVoice("nl", "piper_nl_nl_dii")
            service.onInit(TextToSpeech.ERROR)
        } finally { engine.shutdown(); settings.setVoice("nl", before) }
    }
}
