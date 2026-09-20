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
    @Test fun catalogMatchesIOSAndIncludesPinnedDutchVoice() {
        val models = SpeechModels.parse(File("src/main/assets/speech-models.json").readText())
        assertEquals(9, models.size)
        assertEquals(setOf("en", "pt-pt", "fr", "de", "es", "ca", "nl"), models.map { it.language }.toSet())
        val ios = File("../../ios/BookstrIOS/Sources/Data/SpeechModelStore.swift").readText()
        models.forEach { model ->
            assertTrue(model.revision.matches(Regex("[a-f0-9]{40}")))
            assertTrue(model.files.all { it.bytes > 0 && !it.path.contains("..") })
            assertTrue(model.bytes > 60_000_000)
            assertTrue(model.files.any { it.path == model.model })
            assertTrue(model.files.any { it.path == "espeak-ng-data/lang/gmw/nl" })
            assertTrue(model.files.any { it.path == "espeak-ng-data/lang/gmw/en-US" })
            if (model.language != "nl") assertTrue(ios.contains(model.revision))
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
    @Test fun phrasesStayBoundedWithoutLosingWords() {
        val text = "A short sentence. " + "longword ".repeat(70)
        val phrases = NeuralSpeech.phrases(text)
        assertTrue(phrases.all { it.length <= 140 })
        assertEquals(text.trim(), phrases.joinToString(" "))
        assertEquals(listOf("a".repeat(140), "a".repeat(60)), NeuralSpeech.phrases("a".repeat(200)))
        assertEquals(emptyList<String>(), NeuralSpeech.phrases(" ... ! "))
        assertEquals(emptyList<String>(), NeuralSpeech.phrases(""))
        assertEquals(listOf("Hallo!"), NeuralSpeech.phrases(" Hallo! "))
    }
    @Test fun normalizesDutchAliasesAndIncludesLibraryLanguages() {
        for (alias in listOf("nl", "nld", "dut", "Dutch", " Nederlands ", "nl_NL", "nl-BE")) assertEquals("nl", SpeechLanguages.tag(alias))
        assertEquals("en", SpeechLanguages.tag(" "))
        assertEquals("pt-br", SpeechLanguages.tag("pt_BR"))
        assertEquals("pt-pt", SpeechLanguages.tag("Portuguese"))
        assertEquals("de", SpeechLanguages.tag("German"))
        val languages = SpeechLanguages.available(listOf("", "Dutch", "nl-NL", "it", "French"))
        assertEquals(1, languages.count { it == "nl" }); assertTrue("it" in languages)
        assertTrue(SpeechLanguages.name("nl").isNotBlank())
    }
}
