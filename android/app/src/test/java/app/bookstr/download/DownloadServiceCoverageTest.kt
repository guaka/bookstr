package app.bookstr.download

import android.content.Intent
import android.os.Looper
import app.bookstr.BookstrApp
import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import app.bookstr.data.TorrentEdition
import app.bookstr.data.ShadowEncryptedSharedPreferences
import app.bookstr.data.ShadowMasterKeyBuilder
import kotlinx.coroutines.Job
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowService
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(
    application = BookstrApp::class,
    shadows = [
        ShadowMasterKeyBuilder::class,
        ShadowEncryptedSharedPreferences::class,
        ShadowDownloadService::class,
    ],
    sdk = [35],
)
@LooperMode(LooperMode.Mode.PAUSED)
class DownloadServiceCoverageTest {
    private val id = "a".repeat(32)
    private val book = CatalogBook(
        id, "A title", "An author", "", null,
        libvaultMd5 = id, format = BookFormat.Pdf,
    )
    private val edition = TorrentEdition(id, 1, "fiction", 10)

    @Test
    fun commandIntentUpdatesTheRealDownloadStoreThroughCoordinatorCallbacks() {
        val app = org.robolectric.RuntimeEnvironment.getApplication() as BookstrApp
        app.downloadStore.enqueue(book, edition)
        val service = Robolectric.buildService(DownloadService::class.java).get()

        assertEquals(android.app.Service.START_STICKY, service.onStartCommand(
            Intent().setAction("pause").putExtra("id", id), 0, 17,
        ))
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals("paused", app.downloadStore.find(id)?.state)
    }

    @Test
    fun idleServiceStopsUsingLatestStartIdAndDetachesForegroundNotification() {
        val controller = Robolectric.buildService(DownloadService::class.java).create()
        val service = controller.get()
        val serviceShadow = shadowOf(service)
        try {
            service.onStartCommand(null, 0, 24)
            service.onStartCommand(Intent(), 0, 25)
            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)

            assertTrue(serviceShadow.isStoppedBySelf)
            assertEquals(25, serviceShadow.stopSelfResultId)
            assertTrue(serviceShadow.isForegroundStopped)
        } finally {
            controller.destroy()
        }
    }

    @Test
    fun activeWorkerPreventsIdleStopUntilPauseCancelsAndJoinsIt() {
        val app = org.robolectric.RuntimeEnvironment.getApplication() as BookstrApp
        app.downloadStore.enqueue(book, edition)
        app.downloadStore.update(DownloadJob(book, edition, "paused"))
        val controller = Robolectric.buildService(DownloadService::class.java).create()
        val service = controller.get()
        val serviceShadow = shadowOf(service)
        val worker = Job()
        runningJobs(service)[id] = worker

        try {
            service.onStartCommand(null, 0, 24)
            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)
            assertFalse("the registered active worker keeps the service alive", serviceShadow.isStoppedBySelf)

            service.onStartCommand(Intent().setAction("pause").putExtra("id", id), 0, 25)
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals("paused", app.downloadStore.find(id)?.state)
            assertFalse(runningJobs(service).containsKey(id))
            assertTrue(worker.isCancelled)

            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)
            assertTrue(serviceShadow.isStoppedBySelf)
            assertEquals(25, serviceShadow.stopSelfResultId)
        } finally {
            controller.destroy()
        }
    }

    @Test
    fun inactiveTrackedWorkerDoesNotPreventIdleServiceStop() {
        val controller = Robolectric.buildService(DownloadService::class.java).create()
        val service = controller.get()
        val serviceShadow = shadowOf(service)
        val completedWorker = Job().apply { complete() }
        runningJobs(service)["completed"] = completedWorker

        try {
            service.onStartCommand(null, 0, 26)
            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)

            assertTrue(completedWorker.isCompleted)
            assertTrue(serviceShadow.isStoppedBySelf)
            assertEquals(26, serviceShadow.stopSelfResultId)
        } finally {
            controller.destroy()
        }
    }

    @Test
    fun queuedJobWithoutInternetWaitsForNetworkAndKeepsServiceAlive() {
        val app = org.robolectric.RuntimeEnvironment.getApplication() as BookstrApp
        app.downloadStore.enqueue(book, edition)
        val connectivity = app.getSystemService(android.net.ConnectivityManager::class.java)
        shadowOf(connectivity).setActiveNetworkInfo(null)
        val controller = Robolectric.buildService(DownloadService::class.java).create()
        val service = controller.get()
        val serviceShadow = shadowOf(service)

        try {
            service.onStartCommand(null, 0, 27)
            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)

            assertEquals("waiting-network", app.downloadStore.find(id)?.state)
            assertFalse("queued work prevents the idle stop", serviceShadow.isStoppedBySelf)
        } finally {
            controller.destroy()
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun runningJobs(service: DownloadService): MutableMap<String, Job> {
        val field = DownloadService::class.java.getDeclaredField("running")
        field.isAccessible = true
        return field.get(service) as MutableMap<String, Job>
    }
}

/** Model Android rejecting stopSelfResult(0) while a newly started service has pending starts. */
@Implements(android.app.Service::class)
class ShadowDownloadService : ShadowService() {
    @Implementation
    override fun stopSelfResult(startId: Int): Boolean {
        if (startId == 0) return false
        return super.stopSelfResult(startId)
    }
}
