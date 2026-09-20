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
}
