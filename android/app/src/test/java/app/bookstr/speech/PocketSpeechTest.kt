package app.bookstr.speech

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PocketSpeechTest {
    @Test fun descriptorPinsDutchDaanBundleAndLicense() {
        assertEquals("nl", PocketSpeechModel.language)
        assertEquals("daan", PocketSpeechModel.voice)
        assertEquals("Pocket TTS · Daan", PocketSpeechModel.label)
        assertEquals("litert-community/pocket-tts", PocketSpeechModel.repository)
        assertEquals("03f949ec418ccd4d153008f7ef9c58c754cc0616", PocketSpeechModel.revision)
        assertEquals("pocket_tts_nl_int8.litertlm", PocketSpeechModel.bundleFile)
        assertEquals(
            "https://huggingface.co/litert-community/pocket-tts/resolve/03f949ec418ccd4d153008f7ef9c58c754cc0616/pocket_tts_nl_int8.litertlm",
            PocketSpeechModel.resolvedUrl,
        )
        assertEquals(125_247_496L, PocketSpeechModel.bundleBytes)
        assertEquals("e38af0d6b726c550548b0126c5563245d9ac563c6669b66af924a2b545b51387", PocketSpeechModel.sha256)
        assertEquals("CC BY 4.0", PocketSpeechModel.license)
    }

    @Test fun delegatesAndReturnsValidAudio() {
        val bundle = File("pocket.bundle")
        val audio = PocketSpeechAudio(floatArrayOf(-0.25f, 0.5f), 24_000)
        var receivedFile: File? = null
        var receivedText: String? = null
        val speech = PocketSpeech(PocketSpeechRuntime { file, text, _ ->
            receivedFile = file
            receivedText = text
            audio
        })

        val result = speech.synthesize(bundle, "Hallo wereld", { false })

        assertSame(audio, result)
        assertEquals(bundle, receivedFile)
        assertEquals("Hallo wereld", receivedText)
    }

    @Test fun cancellationBeforeRuntimeSkipsRender() {
        var called = false
        val speech = PocketSpeech(PocketSpeechRuntime { _, _, _ ->
            called = true
            PocketSpeechAudio(floatArrayOf(0.1f), 24_000)
        })

        assertNull(speech.synthesize(File("unused"), "Hallo", { true }))
        assertFalse(called)
    }

    @Test fun cancellationDuringRuntimeDiscardsRenderedAudio() {
        var cancelled = false
        val speech = PocketSpeech(PocketSpeechRuntime { _, _, isCancelled ->
            assertFalse(isCancelled())
            cancelled = true
            PocketSpeechAudio(floatArrayOf(0.1f), 24_000)
        })

        assertNull(speech.synthesize(File("bundle"), "Hallo", { cancelled }))
    }

    @Test fun blankTextIsRejectedBeforeRuntime() {
        var called = false
        val speech = PocketSpeech(PocketSpeechRuntime { _, _, _ ->
            called = true
            PocketSpeechAudio(floatArrayOf(0.1f), 24_000)
        })

        val failure = runCatching { speech.synthesize(File("bundle"), " \n ", { false }) }.exceptionOrNull()

        assertTrue(failure is IllegalArgumentException)
        assertFalse(called)
    }

    @Test fun invalidAudioResultsAreRejected() {
        val noSamples = PocketSpeech(PocketSpeechRuntime { _, _, _ -> PocketSpeechAudio(floatArrayOf(), 24_000) })
        val noRate = PocketSpeech(PocketSpeechRuntime { _, _, _ -> PocketSpeechAudio(floatArrayOf(0.1f), 0) })

        assertTrue(runCatching { noSamples.synthesize(File("bundle"), "Hallo", { false }) }.exceptionOrNull() is IllegalArgumentException)
        assertTrue(runCatching { noRate.synthesize(File("bundle"), "Hallo", { false }) }.exceptionOrNull() is IllegalArgumentException)
    }

    @Test fun runtimeFailurePropagatesToCaller() {
        val failure = IllegalStateException("runtime failed")
        val speech = PocketSpeech(PocketSpeechRuntime { _, _, _ -> throw failure })

        val observed = runCatching { speech.synthesize(File("bundle"), "Hallo", { false }) }.exceptionOrNull()

        assertSame(failure, observed)
    }
}
