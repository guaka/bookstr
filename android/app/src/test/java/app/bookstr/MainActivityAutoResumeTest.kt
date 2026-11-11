package app.bookstr

import android.app.KeyguardManager
import android.content.Intent
import android.os.Looper
import app.bookstr.data.BookFormat
import app.bookstr.data.BookProgress
import app.bookstr.data.ReaderSession
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(
    sdk = [35],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedPreferences::class, LockedKeyguardManagerShadow::class],
    instrumentedPackages = ["androidx.security.crypto"],
)
class MainActivityAutoResumeTest {
    @Test fun lockedLaunchResumesEpubAtCurrentDatabaseProgress() {
        val app = org.robolectric.RuntimeEnvironment.getApplication() as BookstrApp
        val bookId = "a".repeat(32)
        val staleSessionCfi = "stale-session-cfi"
        val currentProgressCfi = "latest-database-cfi"
        val epub = app.catalogRepository.epubFile(bookId).apply { writeText("EPUB fixture") }
        app.settingsRepository.saveReaderSession(
            ReaderSession(bookId, "Resume fixture", BookFormat.Epub, locator = staleSessionCfi),
        )
        runBlocking {
            app.database.bookProgressDao().upsert(
                BookProgress(bookId, 0.7, currentProgressCfi, System.currentTimeMillis()),
            )
        }

        val activityController = Robolectric.buildActivity(MainActivity::class.java)
        try {
            activityController.create()

            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            var launched: Intent? = null
            val activityShadow = shadowOf(activityController.get())
            while (launched == null && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idleFor(50, TimeUnit.MILLISECONDS)
                Thread.sleep(10)
                launched = activityShadow.nextStartedActivity ?: shadowOf(app).nextStartedActivity
            }

            assertNotNull("A locked fresh launch should open the saved EPUB", launched)
            assertEquals(ReaderActivity::class.java.name, launched!!.component?.className)
            assertEquals(currentProgressCfi, launched!!.getStringExtra("initial_cfi"))
        } finally {
            activityController.destroy()
            epub.delete()
            app.settingsRepository.clearReaderSession()
            runBlocking { app.catalogRepository.clearProgress(bookId) }
        }
    }
}

@Implements(KeyguardManager::class)
class LockedKeyguardManagerShadow {
    @Implementation
    protected fun isKeyguardLocked(): Boolean = true
}
