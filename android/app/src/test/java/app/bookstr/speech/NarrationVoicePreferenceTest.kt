package app.bookstr.speech

import android.app.Application
import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import app.bookstr.NarrationService
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class NarrationVoicePreferenceTest {
    private class Engine(context: Context) : TextToSpeech(context, {}) {
        val dutch = Voice("Dutch device voice", Locale.forLanguageTag("nl-NL"), Voice.QUALITY_HIGH, Voice.LATENCY_NORMAL, false, emptySet())
        var selected: Voice? = null
        var selectedLocale: Locale? = null
        override fun getVoices(): Set<Voice> = setOf(dutch)
        override fun setVoice(voice: Voice): Int { selected = voice; return SUCCESS }
        override fun synthesizeToFile(text: CharSequence, params: android.os.Bundle, file: java.io.File, utteranceId: String): Int = SUCCESS
        override fun isLanguageAvailable(locale: Locale): Int = LANG_AVAILABLE
        override fun setLanguage(locale: Locale): Int { selectedLocale = locale; return LANG_AVAILABLE }
    }
    @Test fun resumingAfterChangingVoiceDiscardsCachedAudioAndUsesTheCurrentPosition() {
        for ((previous, selected) in listOf("" to "kokoro_pt_pt", "kokoro_pt_pt" to "", "device-old" to "Dutch device voice")) {
            val controller = Robolectric.buildService(NarrationService::class.java).create()
            val service = controller.get()
            val engine = Engine(service)
            fun field(name: String) = NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }
            val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
            try {
                field("textToSpeech").set(service, engine)
                field("textToSpeechReady").set(service, true)
                field("speechLanguage").set(service, "pt-pt")
                field("speechText").set(service, "Antes. Depois da pausa.")
                field("activeVoice").set(service, previous)
                field("currentRangeStart").set(service, 7)
                field("speechQueue").set(service, listOf(app.bookstr.NarrationChunk("old", "Antes.", "Antes.", 0, 0, 0, false)))
                settings.setVoice("Portuguese", selected)
                val play = NarrationService::class.java.getDeclaredMethod("playOrRequestText").apply { isAccessible = true }
                play.invoke(service)
                assertEquals(selected, field("activeVoice").get(service))
                assertEquals(selected.takeIf { it == "kokoro_pt_pt" }, (field("neuralModel").get(service) as? SpeechModel)?.id)
                val queue = field("speechQueue").get(service) as List<*>
                assertEquals(7, (queue.first() as app.bookstr.NarrationChunk).offset)
                val generation = field("generation").get(service)
                play.invoke(service)
                assertEquals("Resuming the same voice retains its audio queue", generation, field("generation").get(service))
            } finally { settings.setVoice("pt-pt", ""); controller.destroy(); engine.shutdown() }
        }
    }

    @Test fun changingFromNeuralToAnInitializingSystemVoiceWaitsWithoutReusingOldAudio() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val engine = Engine(service)
        fun field(name: String) = NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        try {
            field("textToSpeech").set(service, engine)
            field("textToSpeechReady").set(service, false)
            field("speechLanguage").set(service, "pt-pt")
            field("speechText").set(service, "Antes. Depois da pausa.")
            field("activeVoice").set(service, "kokoro_pt_pt")
            field("currentRangeStart").set(service, 7)
            field("speechQueue").set(service, listOf(app.bookstr.NarrationChunk("old", "Antes.", "Antes.", 0, 0, 0, false)))
            settings.setVoice("pt-pt", "")
            NarrationService::class.java.getDeclaredMethod("playOrRequestText").apply { isAccessible = true }.invoke(service)
            assertTrue(field("pendingPlay").getBoolean(service))
            assertTrue((field("speechQueue").get(service) as List<*>).isEmpty())
            assertEquals(7, field("resumeOffset").getInt(service))
            service.onInit(TextToSpeech.SUCCESS)
            assertEquals("", field("activeVoice").get(service))
            assertEquals(7, ((field("speechQueue").get(service) as List<*>).first() as app.bookstr.NarrationChunk).offset)
        } finally { controller.destroy(); engine.shutdown() }
    }

    @Test fun missingNeuralVoiceReportsAnErrorAndStoppedSynthesisCannotReportStaleErrors() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice("nl", "piper_nl_nl_dii")
        fun speak() = service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_SPEAK")
            .putExtra("text", "Hallo wereld.").putExtra("language", "nl").putExtra("book_id", "test"), 0, 1)
        fun drain() {
            val executor = NarrationService::class.java.getDeclaredField("neuralExecutor").apply { isAccessible = true }.get(service) as java.util.concurrent.ExecutorService
            executor.submit {}.get(5, java.util.concurrent.TimeUnit.SECONDS)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        val application = org.robolectric.Shadows.shadowOf(org.robolectric.RuntimeEnvironment.getApplication())
        try {
            speak(); drain()
            assertTrue(application.broadcastIntents.any { it.getStringExtra(NarrationService.EXTRA_MESSAGE)?.contains("could not read") == true })
            val before = application.broadcastIntents.size
            speak()
            service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_STOP"), 0, 2)
            drain()
            assertFalse(application.broadcastIntents.drop(before).any { it.getStringExtra(NarrationService.EXTRA_MESSAGE)?.contains("could not read") == true })
            val engine = Engine(service)
            NarrationService::class.java.getDeclaredField("textToSpeech").apply { isAccessible = true }.set(service, engine)
            settings.setVoice("nl", engine.dutch.name)
            service.onInit(TextToSpeech.SUCCESS)
            speak()
            assertEquals(engine.dutch, engine.selected)
        } finally { controller.destroy() }
    }
    @Test fun foregroundStartsAreAcknowledgedBeforeStaleReaderValidationAndOnlyIdleSessionsStop() {
        val application = org.robolectric.Shadows.shadowOf(org.robolectric.RuntimeEnvironment.getApplication())
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val shadow = org.robolectric.Shadows.shadowOf(service)
        fun deliver() {
            val intent = application.nextStartedService
            assertTrue(intent.getBooleanExtra("app.bookstr.extra.FOREGROUND_START", false))
            service.onStartCommand(intent, 0, 1)
        }
        try {
            NarrationService.toggle(service, "active", "Active book", null, null)
            deliver()
            val notification = shadow.lastForegroundNotification
            assertNotNull(notification)
            NarrationService.speak(service, "Stale", "en", bookId = "old", title = "Old book", author = null, coverUrl = null, requestToken = "revoked")
            deliver()
            assertNotSame("A new foreground request must call startForeground again", notification, shadow.lastForegroundNotification)
            assertFalse(shadow.isForegroundStopped)
            assertFalse(shadow.isStoppedBySelf)
        } finally { controller.destroy() }

        for (action in listOf("speak", "toggle", "reader")) {
            val idleController = Robolectric.buildService(NarrationService::class.java).create()
            val idle = idleController.get()
            val idleShadow = org.robolectric.Shadows.shadowOf(idle)
            try {
                when (action) {
                    "speak" -> NarrationService.speak(idle, "Stale", "en", bookId = "old", title = "Old", author = null, coverUrl = null, requestToken = "revoked")
                    "toggle" -> NarrationService.toggle(idle, "old", "Old", null, null, requestToken = "revoked")
                    else -> NarrationService.requestReaderPlayback(idle, "11111111111111111111111111111111", "Old", null, null, "revoked")
                }
                val intent = application.nextStartedService
                assertTrue(intent.getBooleanExtra("app.bookstr.extra.FOREGROUND_START", false))
                idle.onStartCommand(intent, 0, 1)
                assertEquals(4107, idleShadow.lastForegroundNotificationId)
                assertTrue(idleShadow.isForegroundStopped)
                assertTrue(idleShadow.isStoppedBySelf)
                assertEquals(1, idleShadow.stopSelfId)
            } finally { idleController.destroy() }
        }
    }

    @Test fun ordinaryStopsAndMediaStopsRetainTheirStartId() {
        for (action in listOf("NARRATION_STOP", "NARRATION_STOP_IF_DIFFERENT_BOOK")) {
            val controller = Robolectric.buildService(NarrationService::class.java).create()
            val service = controller.get()
            try {
                service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_TOGGLE")
                    .putExtra("book_id", "active"), 0, 41)
                service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.$action")
                    .putExtra("target_book_id", "another"), 0, 42)
                assertEquals("An older stop must not cancel a newer queued foreground start", 42,
                    org.robolectric.Shadows.shadowOf(service).stopSelfId)
            } finally { controller.destroy() }
        }
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        try {
            service.onStartCommand(android.content.Intent().setAction("app.bookstr.action.NARRATION_RATE")
                .putExtra("language", "en").putExtra("rate", 0.8f), 0, 43)
            val callback = NarrationService::class.java.getDeclaredField("mediaSessionCallback")
                .apply { isAccessible = true }.get(service) as android.support.v4.media.session.MediaSessionCompat.Callback
            callback.onStop()
            assertEquals(43, org.robolectric.Shadows.shadowOf(service).stopSelfId)
        } finally { controller.destroy() }
    }

    @Test fun ordinaryAndNullServiceStartsDoNotCreateForegroundNotifications() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        try {
            assertEquals(android.app.Service.START_STICKY, service.onStartCommand(null, 0, 1))
            NarrationService.setSpeechRate(service, "en", 0.55f)
            val intent = org.robolectric.Shadows.shadowOf(org.robolectric.RuntimeEnvironment.getApplication()).nextStartedService
            assertFalse(intent.hasExtra("app.bookstr.extra.FOREGROUND_START"))
            service.onStartCommand(intent, 0, 2)
            assertNull(org.robolectric.Shadows.shadowOf(service).lastForegroundNotification)
        } finally { controller.destroy() }
    }

    @Test fun selectedDeviceVoiceOverridesTheEngineDefaultAndMissingVoiceFallsBack() {
        val controller = Robolectric.buildService(NarrationService::class.java).create()
        val service = controller.get()
        val settings = SpeechSettings(service.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        val engine = Engine(service)
        val select = NarrationService::class.java.getDeclaredMethod("selectVoice", TextToSpeech::class.java, String::class.java).apply { isAccessible = true }
        try {
            settings.setVoice("nl", engine.dutch.name)
            select.invoke(service, engine, "Dutch")
            assertEquals(engine.dutch, engine.selected)
            settings.setVoice("nl", "uninstalled voice")
            select.invoke(service, engine, "nl")
            assertEquals("nl", engine.selectedLocale?.language)
            settings.setVoice("nl", "piper_nl_nl_dii")
            NarrationService::class.java.getDeclaredField("speechLanguage").apply { isAccessible = true }.set(service, "nl")
            service.onInit(TextToSpeech.ERROR)
        } finally { engine.shutdown(); controller.destroy() }
    }
}
