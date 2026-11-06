package app.bookstr

import android.app.Application
import android.content.Context
import android.content.Intent
import app.bookstr.speech.SpeechSettings
import app.bookstr.speech.SpeechModel
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class NarrationLanguageTest {
    @Test fun speechResponsesResolveOverridesAndAutoRestoresTheOriginalLanguage() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        try {
            settings.setBookLanguage("italian", "it")
            settings.setVoice("it", "kokoro_it")
            field(service, "pauseRequestedDuringTextRequest", true)
            service.onStartCommand(Intent("app.bookstr.action.NARRATION_SPEAK")
                .putExtra(NarrationService.EXTRA_BOOK_ID, "italian")
                .putExtra("text", "Una frase italiana.")
                .putExtra(NarrationService.EXTRA_LANGUAGE, "en")
                .putExtra("chunks", "[]"), 0, 1)
            assertEquals("it", field(service, "speechLanguage"))
            assertFalse(field(service, "isPlaying") as Boolean)
            val selected = NarrationService::class.java.getDeclaredMethod("selectedNeuralModel").apply { isAccessible = true }
            assertEquals("kokoro_it", (selected.invoke(service) as SpeechModel).id)

            field(service, "currentRangeStart", 4)
            service.onStartCommand(language("italian", null), 0, 2)
            assertEquals("en", field(service, "speechLanguage"))
            assertEquals(4, field(service, "resumeOffset"))
            assertNull(settings.bookLanguage("italian"))
            assertNull(selected.invoke(service))
            assertFalse(field(service, "isPlaying") as Boolean)

            settings.setVoice("pt-pt", "kokoro_pt_pt")
            service.onStartCommand(language("italian", "pt-pt"), 0, 3)
            assertEquals("kokoro_pt_pt", (selected.invoke(service) as SpeechModel).id)
            service.onStartCommand(language("italian", null), 0, 4)

            service.onStartCommand(language("different", "pt-br"), 0, 3)
            assertNull(settings.bookLanguage("different"))
            field(service, "sessionActive", false)
            service.onStartCommand(language("italian", "pt-br"), 0, 4)
            assertNull(settings.bookLanguage("italian"))
        } finally { controller.destroy() }
    }

    @Test fun autoPreservesRegionalMetadataAndReaderChunksAndPublishesTheSelection() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        try {
            field(service, "pauseRequestedDuringTextRequest", true)
            service.onStartCommand(Intent("app.bookstr.action.NARRATION_SPEAK")
                .putExtra(NarrationService.EXTRA_BOOK_ID, "auto")
                .putExtra("text", "An English sentence.")
                .putExtra("chunks", """[{"text":"An English sentence.","start":0}]""")
                .putExtra(NarrationService.EXTRA_LANGUAGE, "en-GB"), 0, 1)
            assertEquals("en-GB", field(service, "speechLanguage"))
            assertEquals(1, (field(service, "speechChunkInputs") as List<*>).size)
            NarrationService.setBookLanguage(service, "auto", "it")
            val command = org.robolectric.Shadows.shadowOf(service.application).nextStartedService
            assertEquals("auto", command.getStringExtra(NarrationService.EXTRA_BOOK_ID))
            assertEquals("it", command.getStringExtra(NarrationService.EXTRA_LANGUAGE_OVERRIDE))
            service.onStartCommand(command, 0, 2)
            val event = org.robolectric.Shadows.shadowOf(service.application).broadcastIntents.last {
                it.action == NarrationService.ACTION_EVENT
            }
            assertEquals("it", event.getStringExtra(NarrationService.EXTRA_LANGUAGE))
            assertEquals("it", event.getStringExtra(NarrationService.EXTRA_LANGUAGE_OVERRIDE))
            field(service, "pauseRequestedDuringTextRequest", true)
            service.onStartCommand(Intent("app.bookstr.action.NARRATION_SPEAK")
                .putExtra(NarrationService.EXTRA_BOOK_ID, "missing-metadata")
                .putExtra("text", "Un altro libro."), 0, 3)
            assertEquals("en", field(service, "speechLanguage"))
        } finally { controller.destroy() }
    }

    @Test fun changingLanguageDuringPlaybackInvalidatesAudioAndResumesAtTheCurrentWord() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        try {
            field(service, "bookId", "portuguese")
            field(service, "sessionActive", true)
            field(service, "isPlaying", true)
            field(service, "speechText", "Uma frase portuguesa para testar.")
            field(service, "currentRangeStart", 10)
            field(service, "textToSpeechReady", false)
            service.onStartCommand(language("portuguese", "pt-pt"), 0, 1)
            assertEquals("pt-pt", field(service, "speechLanguage"))
            assertEquals(10, field(service, "resumeOffset"))
            assertTrue(field(service, "isPlaying") as Boolean)
            assertTrue(field(service, "pendingPlay") as Boolean)
            assertTrue((field(service, "generation") as Int) > 0)
            assertTrue((field(service, "speechChunkInputs") as List<*>).isEmpty())
        } finally { controller.destroy() }
    }

    private fun language(book: String, language: String?) = Intent("app.bookstr.action.NARRATION_LANGUAGE")
        .putExtra(NarrationService.EXTRA_BOOK_ID, book)
        .putExtra(NarrationService.EXTRA_LANGUAGE_OVERRIDE, language)

    private fun field(service: NarrationService, name: String): Any? =
        NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }.get(service)

    private fun field(service: NarrationService, name: String, value: Any) {
        NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }.set(service, value)
    }
}
