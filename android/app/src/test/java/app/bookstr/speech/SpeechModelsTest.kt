package app.bookstr.speech

import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SpeechModelsTest {
    @get:Rule val temporary = TemporaryFolder()
    private val fixture = SpeechModel("test", "nl", "Dutch", "test/repo", "123", "vits", "voice.onnx", listOf(SpeechModelFile("voice.onnx", 4), SpeechModelFile("data/tokens", 2)))
    @Test fun catalogIncludesPinnedVoicesAndCompletePronunciationData() {
        val models = SpeechModels.parse(File("src/main/assets/speech-models.json").readText())
        assertEquals(15, models.size)
        assertEquals(setOf("en", "pt-pt", "fr", "de", "es", "ca", "nl", "it"), models.map { it.language }.toSet())
        val brazilian = models.single { it.id == "kokoro_pt_br" }
        assertEquals(42, brazilian.speaker)
        assertEquals("pt-br", brazilian.engineLanguage)
        assertEquals("csukuangfj/kokoro-multi-lang-v1_0", brazilian.repository)
        assertTrue(brazilian.files.any { it.path == "espeak-ng-data/lang/roa/pt-BR" && it.bytes == 109L })
        val italian = models.single { it.id == "kokoro_it" }
        assertEquals("Kokoro · Italiano", italian.label)
        assertEquals("it", italian.language)
        assertEquals("kokoro", italian.kind)
        assertEquals(35, italian.speaker) // if_sara in the pinned multilingual voice pack.
        assertEquals("it", italian.engineLanguage)
        assertEquals(brazilian.repository, italian.repository)
        assertEquals(brazilian.revision, italian.revision)
        assertEquals(brazilian.files.filterNot { it.path.endsWith("/pt-BR") }, italian.files)
        val portugal = models.single { it.id == "kokoro_pt_pt" }
        assertEquals("pt-pt", portugal.language)
        assertEquals("Kokoro · Português (Portugal)", portugal.label)
        assertEquals("logus2k/kokoro_tts_eu_pt", portugal.repository)
        assertEquals("kokoro", portugal.kind)
        assertEquals(0, portugal.speaker)
        assertEquals("pt", portugal.engineLanguage)
        assertTrue(portugal.files.all { it.url?.startsWith("https://") == true })
        assertEquals(325510089L, portugal.files.single { it.path == "model.onnx" }.bytes)
        assertEquals(522240L, portugal.files.single { it.path == "voices.bin" }.bytes)
        assertTrue(portugal.files.single { it.path == "model.onnx" }.url!!.endsWith("/kokoro-portuguese-eu-pt-v1.0.onnx"))
        assertTrue(portugal.files.single { it.path == "voices.bin" }.url!!.endsWith("/voices-portuguese-eu-pt-v1.0.raw.bin"))
        val ios = File("../../ios/BookstrIOS/Sources/Data/SpeechModelStore.swift").readText()
        models.forEach { model ->
            assertTrue(model.revision.matches(Regex("[a-f0-9]{40}")))
            assertTrue(model.files.all { it.bytes > 0 && !it.path.contains("..") })
            assertTrue(model.bytes > 60_000_000)
            assertTrue(model.files.any { it.path == model.model })
            if (model.kind == "pocket") return@forEach
            assertTrue(model.files.any { it.path == "espeak-ng-data/lang/gmw/nl" })
            assertTrue(model.files.any { it.path == "espeak-ng-data/lang/gmw/en-US" })
            assertTrue(model.files.any { it.path == "espeak-ng-data/it_dict" && it.bytes == 152889L })
            assertTrue(model.files.any { it.path == "espeak-ng-data/lang/roa/it" && it.bytes == 109L })
            if (model.id != "kokoro_pt_pt" && model.language != "nl") assertTrue(ios.contains(model.revision))
        }
    }
    @Test fun completeInstallIsValidatedAndRemovable() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("1234")); server.enqueue(MockResponse().setBody("ab"))
            val store = SpeechModels(temporary.newFolder(), listOf(fixture), baseURL = server.url("/").toString().trimEnd('/'))
            assertFalse(store.installed(fixture))
            val progress = mutableListOf<Float>()
            store.install(fixture) { progress += it }
            assertTrue(store.installed(fixture)); assertEquals(1f, progress.last())
            assertEquals("/test/repo/resolve/123/voice.onnx", server.takeRequest().path)
            assertEquals("ab", File(store.directory(fixture), "data/tokens").readText())
            store.remove(fixture); assertFalse(store.installed(fixture)); store.remove(fixture)
        }
    }
    @Test fun installsExplicitArtifactURLsUnderTheirLocalFileNames() = runBlocking {
        MockWebServer().use { server ->
            val json = """[{"id":"release","language":"pt-pt","label":"Portugal","repository":"upstream/repo","revision":"pin","kind":"kokoro","model":"model.onnx","files":[{"path":"model.onnx","bytes":4,"url":"${server.url("/release/acoustic.onnx")}"},{"path":"voices.bin","bytes":2,"url":""}]}]"""
            val model = SpeechModels.parse(json).single()
            assertEquals(server.url("/release/acoustic.onnx").toString(), model.files.first().url)
            assertNull(model.files.last().url)
            assertEquals(0, model.speaker)
            assertNull(model.engineLanguage)
            server.enqueue(MockResponse().setBody("1234")); server.enqueue(MockResponse().setBody("ab"))
            val store = SpeechModels(temporary.newFolder(), listOf(model), baseURL = server.url("/").toString().trimEnd('/'))
            store.install(model) {}
            assertTrue(store.installed(model))
            assertEquals("/release/acoustic.onnx", server.takeRequest().path)
            assertEquals("/upstream/repo/resolve/pin/voices.bin", server.takeRequest().path)
            assertEquals("1234", File(store.directory(model), "model.onnx").readText())
        }
    }
    @Test fun failedAndTruncatedDownloadsPreserveInstalledVoiceAndCleanStaging() = runBlocking {
        MockWebServer().use { server ->
            val store = SpeechModels(temporary.newFolder(), listOf(fixture), baseURL = server.url("/").toString().trimEnd('/'))
            store.directory(fixture).mkdirs()
            val original = File(store.directory(fixture), "voice.onnx").apply { writeText("original") }
            for (response in listOf(MockResponse().setResponseCode(404), MockResponse().setBody("x"))) {
                server.enqueue(response)
                assertTrue(runCatching { store.install(fixture) {} }.isFailure)
                assertEquals("original", original.readText())
                assertFalse(File(store.root, "test.partial").exists())
            }
        }
    }
    @Test fun cancelledDownloadDoesNotInstallPartialFiles() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("1234"))
            val store = SpeechModels(temporary.newFolder(), listOf(fixture), baseURL = server.url("/").toString().trimEnd('/'))
            val job = launch { store.install(fixture) { cancel() } }
            job.join()
            assertFalse(store.installed(fixture)); assertFalse(File(store.root, "test.partial").exists())
        }
    }
    @Test fun reusesValidatedFilesAndKeepsSharedPronunciationAfterRemoval() = runBlocking {
        MockWebServer().use { server ->
            val model = fixture.copy(files = fixture.files + SpeechModelFile("espeak-ng-data/lang/gmw/nl", 2))
            val store = SpeechModels(temporary.newFolder(), listOf(model), baseURL = server.url("/").toString().trimEnd('/'))
            store.directory(model).mkdirs()
            File(store.directory(model), "voice.onnx").writeText("1234")
            server.enqueue(MockResponse().setBody("ab")); server.enqueue(MockResponse().setBody("nl"))
            store.install(model) {}
            assertEquals(2, server.requestCount)
            val data = store.pronunciationDirectory(model)
            assertEquals("nl", File(data, "lang/gmw/nl").readText())
            assertEquals(data, store.pronunciationDirectory(model))
            store.remove(model)
            assertEquals("nl", File(data, "lang/gmw/nl").readText())
        }
    }
    @Test fun repairsStaleSharedPronunciationData() {
        val model = fixture.copy(files = listOf(SpeechModelFile("espeak-ng-data/lang/roa/it", 2)))
        val store = SpeechModels(temporary.newFolder(), listOf(model))
        File(store.directory(model), model.files.single().path).apply { parentFile!!.mkdirs(); writeText("it") }
        File(store.root, model.files.single().path).apply { parentFile!!.mkdirs(); writeText("stale") }
        assertEquals("it", File(store.pronunciationDirectory(model), "lang/roa/it").readText())
    }
    @Test fun phrasesStayBoundedWithoutLosingWords() {
        val text = "A short sentence. " + "longword ".repeat(70)
        val phrases = NeuralSpeech.phrases(text)
        assertTrue(phrases.all { it.length <= 140 })
        assertTrue(phrases.first().length <= 70)
        assertEquals(text.trim(), phrases.joinToString(" "))
        assertEquals(listOf("a".repeat(70), "a".repeat(130)), NeuralSpeech.phrases("a".repeat(200)))
        assertEquals(emptyList<String>(), NeuralSpeech.phrases(" ... ! "))
        assertEquals(emptyList<String>(), NeuralSpeech.phrases(""))
        assertEquals(listOf("Hallo!"), NeuralSpeech.phrases(" Hallo! "))
    }
    @Test fun phraseWavsBecomePlayableIndependentlyAndStopOnCancellation() {
        val directory = temporary.newFolder()
        val text = "First phrase. " + "Second phrase. ".repeat(12)
        val ready = mutableListOf<File>()
        val readyPhrases = mutableListOf<String>()
        var rendered = 0

        NeuralSpeech.emitPhrases(
            text = text,
            directory = directory,
            fileStem = "chunk",
            cancelled = { ready.size == 1 },
            render = {
                rendered += 1
                PhraseAudio(floatArrayOf(-0.5f, 0.25f), 22_050)
            },
            onPhraseReady = { _, phrase, file ->
                ready += file
                readyPhrases += phrase
            },
        )

        assertEquals(1, rendered)
        assertEquals(1, ready.size)
        assertTrue(readyPhrases.single().length <= 140)
        val wav = ready.single().readBytes()
        assertEquals("RIFF", String(wav, 0, 4))
        assertEquals("WAVE", String(wav, 8, 4))
        assertEquals(4, wav.size - 44)
        assertFalse(File(directory, "chunk-1.wav").exists())
    }

    @Test fun failedPhraseDeliveryRemovesItsIncompleteOutputFile() {
        val directory = temporary.newFolder()
        val file = File(directory, "chunk-0.wav")

        assertTrue(runCatching {
            NeuralSpeech.emitPhrases(
                text = "One phrase.",
                directory = directory,
                fileStem = "chunk",
                cancelled = { false },
                render = { PhraseAudio(floatArrayOf(0.1f), 22_050) },
                onPhraseReady = { _, _, _ -> error("consumer stopped") },
            )
        }.isFailure)

        assertFalse(file.exists())
    }
    @Test fun normalizesDutchAliasesAndIncludesLibraryLanguages() {
        for (alias in listOf("nl", "nld", "dut", "Dutch", " Nederlands ", "nl_NL", "nl-BE")) assertEquals("nl", SpeechLanguages.tag(alias))
        for (alias in listOf("it", "ita", "Italian", " Italiano ", "it_IT", "it-CH")) assertEquals("it", SpeechLanguages.tag(alias))
        assertTrue("it" in SpeechLanguages.seeded)
        assertTrue("it" in SpeechLanguages.available(emptyList()))
        assertEquals("en", SpeechLanguages.tag(" "))
        assertEquals("pt-br", SpeechLanguages.tag("pt_BR"))
        assertEquals("pt-pt", SpeechLanguages.tag("Portuguese"))
        assertEquals("de", SpeechLanguages.tag("German"))
        val languages = SpeechLanguages.available(listOf("", "Dutch", "nl-NL", "it", "French"))
        assertEquals(1, languages.count { it == "nl" }); assertTrue("it" in languages)
        assertTrue(SpeechLanguages.name("nl").isNotBlank())
    }
}
