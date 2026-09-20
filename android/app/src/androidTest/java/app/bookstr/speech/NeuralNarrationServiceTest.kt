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

class NeuralNarrationServiceTest {
    @Test fun dutchNarrationPlaysReportsProgressAndRequestsTheNextSection() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<BookstrApp>()
        app.settingsRepository.clearReaderSession()
        val models = SpeechModels(app)
        val model = models.models.first { it.language == "nl" }
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
