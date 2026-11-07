package app.bookstr.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import app.bookstr.NarrationService
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class NeuralNarrationServiceTest {
    @Test fun ordinaryStopQueuedBeforeForegroundStartKeepsTheNewSession() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        app.stopService(Intent(app, NarrationService::class.java))
        val idle = CountDownLatch(1)
        val started = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (!intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, true) &&
                    intent.getFloatExtra(NarrationService.EXTRA_RATE, 0f) == SpeechSettings.MAXIMUM_RATE
                ) idle.countDown()
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "stop-start-race" &&
                    intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false)
                ) started.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { NarrationService.setSpeechRate(it, "en", 0.82f) }
                assertTrue("Idle narration service did not start", idle.await(10, TimeUnit.SECONDS))
                // Queue both commands before the main thread can deliver either one.
                // Android has already required foreground for the newer start when
                // the older stop runs, so an unconditional stopSelf kills the process.
                scenario.onActivity {
                    NarrationService.stop(it)
                    NarrationService.toggle(it, "stop-start-race", "Stop then start", null, null)
                }
                assertTrue("An older stop discarded the newer narration request", started.await(10, TimeUnit.SECONDS))
                Thread.sleep(12_000)
                val notifications = app.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                assertTrue(notifications.any { it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE) == "Stop then start" })
            }
        } finally {
            app.unregisterReceiver(receiver)
            app.stopService(Intent(app, NarrationService::class.java))
        }
    }

    @Test fun validForegroundStartQueuedAfterARejectedRequestKeepsItsSession() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        app.stopService(Intent(app, NarrationService::class.java))
        val started = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "queued-valid-reader" &&
                    intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false)
                ) started.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity {
                    NarrationService.speak(it, "Stale response", "en", bookId = "rejected-reader", title = "Rejected", author = null, coverUrl = null, requestToken = "revoked-reader-token")
                    NarrationService.toggle(it, "queued-valid-reader", "Queued valid reader", null, null)
                }
                assertTrue("Rejecting an older request stopped the newer session", started.await(10, TimeUnit.SECONDS))
                Thread.sleep(12_000)
                val notifications = app.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                assertTrue(notifications.any { it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE) == "Queued valid reader" })
            }
        } finally {
            app.unregisterReceiver(receiver)
            app.stopService(Intent(app, NarrationService::class.java))
        }
    }

    @Test fun stickyRestartWithoutAnIntentDoesNotRequireANarrationSession() {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val service = NarrationService()
            try {
                assertEquals(android.app.Service.START_STICKY, service.onStartCommand(null, 0, 1))
            } finally {
                for (name in listOf("neuralExecutor", "artworkExecutor")) {
                    val executor = NarrationService::class.java.getDeclaredField(name).apply { isAccessible = true }.get(service) as java.util.concurrent.ExecutorService
                    executor.shutdownNow()
                }
            }
        }
    }

    @Test fun rejectedForegroundReaderRequestStopsWithoutCrashingAfterAndroidsDeadline() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        app.stopService(Intent(app, NarrationService::class.java))
        val stopped = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (!intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, true)) stopped.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity {
                    NarrationService.speak(it, "Stale response", "en", bookId = "rejected-reader", title = "Rejected reader", author = null, coverUrl = null, requestToken = "revoked-reader-token")
                    NarrationService.toggle(it, "rejected-reader", "Rejected reader", null, null, requestToken = "revoked-reader-token")
                    NarrationService.requestReaderPlayback(it, "11111111111111111111111111111111", "Rejected reader", null, null, "revoked-reader-token")
                }
                assertTrue("Rejected foreground request did not stop its idle service", stopped.await(10, TimeUnit.SECONDS))
                // The platform posts a delayed process-killing error when a foreground
                // launch is rejected without first acknowledging startForegroundService.
                Thread.sleep(12_000)
                val notifications = app.getSystemService(android.app.NotificationManager::class.java).activeNotifications
                assertFalse(notifications.any { it.id == 4107 })
            }
        } finally {
            app.unregisterReceiver(receiver)
            app.stopService(Intent(app, NarrationService::class.java))
        }
    }

    @Test fun readerReadySyncRepeatsAnUnansweredNarrationTextRequest() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val firstRequest = CountDownLatch(1)
        val repeatedRequest = CountDownLatch(1)
        val ordinarySync = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val requestCount = AtomicInteger(0)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "reader-ready-test" &&
                    intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)
                ) {
                    if (requestCount.incrementAndGet() == 1) firstRequest.countDown()
                    else repeatedRequest.countDown()
                } else if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "reader-ready-test" &&
                    intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false)
                ) {
                    ordinarySync.countDown()
                } else if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "reader-ready-test") {
                    finished.countDown()
                }
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { NarrationService.toggle(it, "reader-ready-test", "Portuguese fixture", null, null) }
                assertTrue("First narration text request was not sent", firstRequest.await(10, TimeUnit.SECONDS))
                scenario.onActivity { NarrationService.sync(it) }
                assertTrue("Ordinary sync state was not sent", ordinarySync.await(10, TimeUnit.SECONDS))
                assertEquals(1, requestCount.get())
                scenario.onActivity { NarrationService.sync(it, requestTextIfPending = true) }
                assertTrue("Reader-ready sync did not retry the text request", repeatedRequest.await(10, TimeUnit.SECONDS))
                scenario.onActivity { NarrationService.stop(it) }
                assertTrue("Narration did not stop", finished.await(10, TimeUnit.SECONDS))
            }
        } finally {
            app.unregisterReceiver(receiver)
        }
    }

    @Test fun narrationRateActionPersistsAndPublishesTheSelectedLanguageRate() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        val observed = CountDownLatch(1)
        val reportedRate = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_LANGUAGE) == "en" &&
                    intent.getFloatExtra(NarrationService.EXTRA_RATE, 0f) == 0.56f
                ) {
                    reportedRate.set(true)
                    observed.countDown()
                }
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { NarrationService.setSpeechRate(it, "en", 0.56f) }
                assertTrue("Rate action did not publish narration state", observed.await(10, TimeUnit.SECONDS))
                assertTrue(reportedRate.get())
                assertEquals(0.56f, SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)).rate("en"), 0f)
            }
        } finally {
            app.unregisterReceiver(receiver)
            app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).edit().remove("speech_rate_en").apply()
        }
    }

    @Test fun stopIfDifferentBookKeepsMatchingSessionAndStopsForAnotherBook() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        val kept = CountDownLatch(1)
        val stopped = CountDownLatch(1)
        val differentBookStopped = CountDownLatch(1)
        val stopEvents = AtomicInteger(0)
        val expectDifferentBookStop = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, false) &&
                    intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "stop-if-different-test"
                ) kept.countDown()
                if (!intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, true)) {
                    stopped.countDown()
                    if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "stop-if-different-test") {
                        stopEvents.incrementAndGet()
                        if (expectDifferentBookStop.get()) differentBookStopped.countDown()
                    }
                }
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { NarrationService.stop(it) }
                assertTrue("Prior narration session did not stop", stopped.await(10, TimeUnit.SECONDS))
                scenario.onActivity {
                    NarrationService.toggle(it, "stop-if-different-test", "Stop test", null, null)
                }
                assertTrue("Narration session did not start", kept.await(10, TimeUnit.SECONDS))
                val stopsBeforeMatchingBook = stopEvents.get()
                scenario.onActivity { NarrationService.stopIfDifferentBook(it, "stop-if-different-test") }
                // The matching request must leave the service session running.
                Thread.sleep(300)
                assertEquals(stopsBeforeMatchingBook, stopEvents.get())
                expectDifferentBookStop.set(true)
                scenario.onActivity { NarrationService.stopIfDifferentBook(it, "another-book") }
                assertTrue("Different-book request did not stop narration", differentBookStopped.await(10, TimeUnit.SECONDS))
            }
        } finally {
            app.unregisterReceiver(receiver)
            app.stopService(Intent(app, NarrationService::class.java))
        }
    }

    @Test fun startingNarrationRequestsReaderTextInAutoplayState() {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        val requested = CountDownLatch(1)
        val stopped = CountDownLatch(1)
        val suppliedWhilePaused = CountDownLatch(1)
        val playing = AtomicBoolean(false)
        val remainedPaused = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getStringExtra(NarrationService.EXTRA_BOOK_ID) == "autoplay-test" &&
                    !intent.getBooleanExtra(NarrationService.EXTRA_SESSION_ACTIVE, true)
                ) stopped.countDown()
                if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_TEXT, false)) {
                    playing.set(intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false))
                    requested.countDown()
                }
                if (intent.getBooleanExtra(NarrationService.EXTRA_HAS_TEXT, false) &&
                    !intent.getBooleanExtra(NarrationService.EXTRA_IS_PLAYING, false)
                ) {
                    remainedPaused.set(true)
                    suppliedWhilePaused.countDown()
                }
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity {
                    NarrationService.toggle(it, "autoplay-test", "Autoplay fixture", null, null)
                }
                assertTrue("Narration did not request text", requested.await(10, TimeUnit.SECONDS))
                assertTrue("Text request was left paused", playing.get())
                scenario.onActivity {
                    NarrationService.toggle(it, "autoplay-test", "Autoplay fixture", null, null)
                }
                scenario.onActivity {
                    NarrationService.speak(it, "A short fixture sentence.", "en", bookId = "autoplay-test", title = "Autoplay fixture", author = null, coverUrl = null)
                }
                assertTrue("Pause during text request was ignored", suppliedWhilePaused.await(10, TimeUnit.SECONDS))
                assertTrue(remainedPaused.get())
                scenario.onActivity { NarrationService.stop(it) }
                assertTrue("Autoplay session did not stop", stopped.await(10, TimeUnit.SECONDS))
            }
        } finally {
            app.unregisterReceiver(receiver)
        }
    }

    @Test fun dutchNarrationPlaysReportsProgressAndRequestsTheNextSection() = verifyDutchNarration("piper_nl_nl_dii")

    @Test fun pocketNarrationPlaysReportsProgressAndRequestsTheNextSection() = verifyDutchNarration("pocket_nl_daan")

    private fun verifyDutchNarration(modelId: String) = runBlocking {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        val models = SpeechModels(app)
        val model = models.models.single { it.id == modelId }
        if (!models.installed(model)) models.install(model) {}
        val settings = SpeechSettings(app.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE))
        settings.setVoice("Dutch", model.id)
        val done = CountDownLatch(1)
        val progress = AtomicBoolean(false)
        val failed = AtomicBoolean(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (!intent.getStringExtra(NarrationService.EXTRA_MESSAGE).isNullOrBlank()) failed.set(true)
                if (intent.getIntExtra(NarrationService.EXTRA_OFFSET, 0) > 0) progress.set(true)
                if (intent.getBooleanExtra(NarrationService.EXTRA_REQUEST_CONTINUE, false)) done.countDown()
            }
        }
        app.registerReceiver(receiver, IntentFilter(NarrationService.ACTION_EVENT), Context.RECEIVER_NOT_EXPORTED)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { NarrationService.speak(it, "Hallo. Dit is een Nederlands boek. We lezen samen.", "nld", bookId = "speech-test", title = "Dutch speech test", author = null, coverUrl = null) }
                assertTrue("Narration did not finish", done.await(60, TimeUnit.SECONDS))
                assertTrue("No reading progress", progress.get()); assertFalse("Narration reported an error", failed.get())
                scenario.onActivity { NarrationService.stop(it) }
            }
        } finally { app.unregisterReceiver(receiver) }
        Unit
    }
}
