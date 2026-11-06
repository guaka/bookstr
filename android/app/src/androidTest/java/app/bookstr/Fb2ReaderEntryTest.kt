package app.bookstr

import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.data.BookFormat
import app.bookstr.data.ReaderSession
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Fb2ReaderEntryTest {
    @Test fun explicitReaderLaunchFinishesWithoutReplacingSavedReaderSession() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BookstrApp
        val settings = app.settingsRepository
        val prior = settings.readerSession()
        val saved = ReaderSession("d".repeat(32), "Legacy FB2", BookFormat.Fb2, locator = "fb2:section-2:4:17")
        settings.saveReaderSession(saved)

        try {
            ActivityScenario.launch<Fb2ReaderActivity>(
                Fb2ReaderActivity.intent(app, "e".repeat(32), "Legacy FB2", null, null, locator = "fb2:old:1"),
            ).use { scenario ->
                InstrumentationRegistry.getInstrumentation().waitForIdleSync()
                assertEquals(Lifecycle.State.DESTROYED, scenario.state)
            }
            assertEquals(saved, settings.readerSession())
        } finally {
            if (prior == null) settings.clearReaderSession() else settings.saveReaderSession(prior)
        }
    }
}
