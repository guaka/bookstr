package app.bookstr.speech

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PocketSpeechCatalogContractTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun pocketCatalogMatchesPinnedDescriptor() {
        val catalog = SpeechModels.parse(File("src/main/assets/speech-models.json").readText())
        val model = catalog.single { it.id == "pocket_nl_daan" }
        assertEquals(PocketSpeechModel.language, model.language)
        assertEquals(PocketSpeechModel.label, model.label)
        assertEquals(PocketSpeechModel.repository, model.repository)
        assertEquals(PocketSpeechModel.revision, model.revision)
        assertEquals("pocket", model.kind)
        // Avoid recursive companion discovery for a standalone language bundle (MediaPipe #6395).
        assertEquals("daan.litertlm", model.model)
        assertEquals(model.model, model.files.single().path)
        assertEquals(PocketSpeechModel.resolvedUrl, model.files.single().url)
        assertEquals(PocketSpeechModel.bundleBytes, model.bytes)
        assertEquals(PocketSpeechModel.sha256, model.files.single().sha256)
    }

    @Test fun handoffDocumentationMatchesPinnedDraftDescriptor() {
        val handoff = File("../../docs/pocket-tts-draft.md").readText()

        assertTrue(handoff.contains(PocketSpeechModel.revision))
        assertTrue(handoff.replace(",", "").contains(PocketSpeechModel.bundleBytes.toString()))
        assertTrue(handoff.contains(PocketSpeechModel.sha256))
        assertTrue(handoff.contains(PocketSpeechModel.bundleFile))
        assertTrue(handoff.contains(PocketSpeechModel.resolvedUrl))
        assertTrue(handoff.contains("draft"))
    }

    @Test fun phraseWaveWritesClampedPcmAndSampleRateMetadata() {
        val file = temporary.newFile("phrase.wav")
        PhraseWaveFile.write(file, floatArrayOf(-2f, 0.5f, 2f), 16_000)
        val wav = file.readBytes()
        val header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)

        assertEquals("RIFF", String(wav, 0, 4))
        assertEquals(wav.size - 8, header.getInt(4))
        assertEquals(16_000, header.getInt(24))
        assertEquals(32_000, header.getInt(28))
        assertEquals(6, header.getInt(40))
        assertEquals(-32767, header.getShort(44).toInt())
        assertEquals(16_383, header.getShort(46).toInt())
        assertEquals(32767, header.getShort(48).toInt())
    }
}
