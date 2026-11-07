package app.bookstr.speech

import java.io.File
import com.google.mediapipe.tasks.audio.texttospeech.AudioResult
import android.content.res.AssetManager
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.GeneratedAudio
import org.robolectric.util.ReflectionHelpers
import org.junit.Assert.assertTrue
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class, shadows = [MediaPipeTtsJniShadow::class, SherpaTtsShadow::class])
class NeuralSpeechEngineContractTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun pocketEngineConfiguresDutchDaanMapsPcmAndClosesNativeTask() {
        val model = SpeechModel(
            id = "pocket_nl_daan", language = "nl", label = "Pocket", repository = "test/repo",
            revision = "revision", kind = "pocket", model = "daan.litertlm",
            files = listOf(SpeechModelFile("daan.litertlm", 12)),
        )
        val root = temporary.newFolder()
        val store = SpeechModels(root, listOf(model))
        MediaPipeTtsJniShadow.reset()

        val engine = createNeuralSpeechEngine(model, store)

        assertEquals(File(root, "pocket_nl_daan/daan.litertlm").path, MediaPipeTtsJniShadow.modelPath)
        assertEquals("daan", MediaPipeTtsJniShadow.voiceId)
        assertEquals("nl-NL", MediaPipeTtsJniShadow.locale)
        assertEquals(24_000, engine.sampleRate)
        val expected = floatArrayOf(0.1f, -0.2f, 0.3f)
        MediaPipeTtsJniShadow.samples = expected
        val phrase = engine.generate("Hallo, wereld.")
        assertEquals("Hallo, wereld.", MediaPipeTtsJniShadow.text)
        assertArrayEquals(expected, phrase.samples, 0f)
        assertEquals(24_000, phrase.sampleRate)

        engine.close()
        assertEquals(42L, MediaPipeTtsJniShadow.destroyedHandle)
    }
    @Test fun sherpaPreservesPiperAndKokoroConfigurationsAndLifecycle() {
        for ((kind, language) in listOf("vits" to null, "kokoro" to "it", "kokoro" to null)) {
            val model = SpeechModel("voice", "nl", "Voice", "repo", "pin", kind, "model.onnx", emptyList(), speaker = 3, engineLanguage = language)
            val store = SpeechModels(temporary.newFolder(), listOf(model))
            SherpaTtsShadow.released = false
            val engine = createNeuralSpeechEngine(model, store)
            val config = checkNotNull(SherpaTtsShadow.config)
            val path = File(store.directory(model), "model.onnx").path
            assertEquals(4, config.model.numThreads)
            if (kind == "vits") {
                assertEquals(path, config.model.vits.model)
                assertEquals(File(store.root, "espeak-ng-data").path, config.model.vits.dataDir)
            } else {
                assertEquals(path, config.model.kokoro.model)
                assertEquals(language.orEmpty(), config.model.kokoro.lang)
                assertEquals(File(store.directory(model), "voices.bin").path, config.model.kokoro.voices)
            }
            assertEquals(22_050, engine.sampleRate)
            assertArrayEquals(floatArrayOf(0.25f), engine.generate("Dag.").samples, 0f)
            assertEquals("Dag.", SherpaTtsShadow.text)
            assertEquals(3, SherpaTtsShadow.speaker)
            engine.close()
            assertTrue(SherpaTtsShadow.released)
        }
    }

}

@Implements(className = "com.google.mediapipe.tasks.audio.texttospeech.MediaPipeTtsJni", isInAndroidSdk = false)
class MediaPipeTtsJniShadow {
    companion object {
        @Implementation @JvmStatic fun __staticInitializer__() {
            val type = Class.forName("com.google.mediapipe.tasks.audio.texttospeech.MediaPipeTtsJni")
            val instance = type.getDeclaredConstructor().apply { isAccessible = true }.newInstance()
            ReflectionHelpers.setStaticField(type, "INSTANCE", instance)
        }
        var modelPath = ""
        var voiceId = ""
        var locale = ""
        var text = ""
        var samples = floatArrayOf(0.1f, -0.2f, 0.3f)
        var destroyedHandle = 0L

        fun reset() {
            modelPath = ""; voiceId = ""; locale = ""; text = ""
            samples = floatArrayOf(0.1f, -0.2f, 0.3f); destroyedHandle = 0L
        }
    }


    @Implementation fun nativeCreate(
        modelAssetPath: String, delegate: Int, speakingRate: Float, targetBucket: Int,
        defaultVoiceId: String, defaultLocale: String, cacheDirectory: String,
    ): Long {
        modelPath = modelAssetPath; voiceId = defaultVoiceId; locale = defaultLocale
        return 42L
    }

    @Implementation fun nativeSynthesize(handle: Long, text: String, voiceId: String?, locale: String?): AudioResult {
        Companion.text = text
        return AudioResult(samples, 24_000)
    }

    @Implementation fun nativeDestroy(handle: Long) { destroyedHandle = handle }
}

@Implements(value = OfflineTts::class, isInAndroidSdk = false)
class SherpaTtsShadow {
    companion object {
        var config: OfflineTtsConfig? = null
        var released = false
        var text = ""
        var speaker = 0
        @Implementation @JvmStatic fun __staticInitializer__() = Unit
    }
    @Implementation fun newFromFile(value: OfflineTtsConfig): Long { config = value; return 7L }
    @Implementation fun getSampleRate(pointer: Long): Int = 22_050
    @Implementation fun generateImpl(pointer: Long, value: String, sid: Int, speed: Float): GeneratedAudio {
        text = value; speaker = sid
        return GeneratedAudio(floatArrayOf(0.25f), 22_050)
    }
    @Implementation fun delete(pointer: Long) { released = true }
}
