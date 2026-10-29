package app.bookstr.speech

import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaControllerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.bookstr.NarrationService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class NarrationLockscreenMetadataTest {
    @Test fun currentBookRemainsTheMediaTitleWhenNarrationReportsAParagraph() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val connected = CountDownLatch(1)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var browser: MediaBrowserCompat
        instrumentation.runOnMainSync {
            browser = MediaBrowserCompat(
                context,
                ComponentName(context, NarrationService::class.java),
                object : MediaBrowserCompat.ConnectionCallback() {
                    override fun onConnected() { connected.countDown() }
                },
                null,
            )
            browser.connect()
        }
        try {
            assertTrue("Narration media browser did not connect", connected.await(10, TimeUnit.SECONDS))
            val controller = MediaControllerCompat(context, browser.sessionToken)
            NarrationService.toggle(context, "lockscreen-book", "The Current Book", "A. Writer", null)
            NarrationService.updateParagraph(context, "This paragraph is currently being read aloud and should not replace the book title.")

            assertTrue("Book metadata was not published", await(10_000) {
                controller.metadata?.getString(MediaMetadataCompat.METADATA_KEY_ALBUM)
                    ?.startsWith("This paragraph is currently") == true
            })
            val metadata = controller.metadata
            assertEquals("The Current Book", metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE))
            assertEquals("The Current Book", metadata.getString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE))
            assertEquals("A. Writer", metadata.getString(MediaMetadataCompat.METADATA_KEY_ARTIST))
            assertEquals("A. Writer", metadata.getString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE))

            val notificationManager = context.getSystemService(NotificationManager::class.java)
            assertTrue("Book notification was not published", await(10_000) {
                notificationManager.activeNotifications.any { notification ->
                    notification.notification.extras.getCharSequence(Notification.EXTRA_TITLE) == "The Current Book"
                }
            })
        } finally {
            NarrationService.stop(context)
            instrumentation.runOnMainSync { browser.disconnect() }
        }
    }

    private fun await(timeoutMillis: Long, condition: () -> Boolean): Boolean {
        val end = SystemClock.elapsedRealtime() + timeoutMillis
        while (SystemClock.elapsedRealtime() < end) {
            if (condition()) return true
            Thread.sleep(50)
        }
        return condition()
    }
}
