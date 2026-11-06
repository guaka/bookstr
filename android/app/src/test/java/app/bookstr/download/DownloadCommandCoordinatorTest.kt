package app.bookstr.download

import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import app.bookstr.data.TorrentEdition
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadCommandCoordinatorTest {
    private fun job(state: String, error: String? = null) = DownloadJob(
        book = CatalogBook("a".repeat(32), "Fixture", "Author", "", null,
            libvaultMd5 = "a".repeat(32), format = BookFormat.Pdf),
        edition = TorrentEdition("a".repeat(32), 1, "fiction", 12),
        state = state,
        error = error,
    )

    @Test fun resumeWaitsForCancelCleanupAndCannotBeOverwrittenByTheOlderCancel() = runBlocking {
        var stored = job("downloading")
        val cancelEntered = CompletableDeferred<Unit>()
        val finishCancel = CompletableDeferred<Unit>()
        var cancellations = 0
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it },
            cancelAndJoin = {
                cancellations++
                cancelEntered.complete(Unit)
                finishCancel.await()
            },
        )

        assertFalse(coordinator.hasPendingCommands())
        val cancel = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.handle("cancel", stored.book.id)
        }
        cancelEntered.await()
        assertEquals("cancelled", stored.state)
        assertTrue(coordinator.hasPendingCommands())

        val resume = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.handle("resume", stored.book.id)
        }
        assertTrue(coordinator.hasPendingCommands())
        assertFalse(coordinator.stopIfIdle(hasActiveJobs = false) { error("must not stop with pending controls") })
        finishCancel.complete(Unit)
        cancel.await()
        resume.await()

        assertEquals("queued", stored.state)
        assertEquals(1, cancellations)
        assertFalse(coordinator.hasPendingCommands())
    }

    @Test fun idleStopUsesLatestStartIdAndHonorsActiveAndStopResultGuards() = runBlocking {
        var stored = job("cancelled")
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it },
            cancelAndJoin = {},
        )
        val attemptedIds = mutableListOf<Int>()
        var frameworkLatestStartId = 0

        assertTrue(coordinator.stopIfIdle(hasActiveJobs = false) { startId ->
            attemptedIds += startId
            startId == frameworkLatestStartId
        })
        assertEquals(listOf(0), attemptedIds)

        assertFalse(coordinator.stopIfIdle(hasActiveJobs = true) { startId ->
            attemptedIds += startId
            true
        })
        assertEquals(listOf(0), attemptedIds)

        coordinator.onStart(1)
        frameworkLatestStartId = 2
        assertFalse(coordinator.stopIfIdle(hasActiveJobs = false) { startId ->
            attemptedIds += startId
            startId == frameworkLatestStartId
        })
        assertEquals(listOf(0, 1), attemptedIds)

        coordinator.onStart(2)
        coordinator.onStart(1)
        coordinator.handle("resume", stored.book.id)
        assertEquals("queued", stored.state)
        assertFalse(coordinator.stopIfIdle(hasActiveJobs = stored.active) { startId ->
            attemptedIds += startId
            true
        })
        assertEquals(listOf(0, 1), attemptedIds)

        stored = stored.copy(state = "cancelled")
        assertFalse(coordinator.stopIfIdle(hasActiveJobs = false) { startId ->
            attemptedIds += startId
            false
        })
        assertTrue(coordinator.stopIfIdle(hasActiveJobs = false) { startId ->
            attemptedIds += startId
            startId == 2
        })
        assertEquals(listOf(0, 1, 2, 2), attemptedIds)
    }

    @Test fun pausePublishesPausedBeforeJoiningAndKeepsThatStateAfterCleanup() = runBlocking {
        var stored = job("downloading")
        val updates = mutableListOf<String>()
        var joined = 0
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it; updates += it.state },
            cancelAndJoin = { joined++ },
        )

        coordinator.handle("pause", stored.book.id)

        assertEquals(listOf("paused", "paused"), updates)
        assertEquals("paused", stored.state)
        assertEquals(1, joined)
        assertFalse(coordinator.hasPendingCommands())
    }

    @Test fun resumeQueuesPausedJobsButLeavesActiveAndCompleteJobsAlone() = runBlocking {
        var stored = job("paused", error = "old failure")
        var updates = 0
        var joins = 0
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it; updates++ },
            cancelAndJoin = { joins++ },
        )

        coordinator.handle("resume", stored.book.id)
        assertEquals("queued", stored.state)
        assertNull(stored.error)
        assertEquals(1, updates)

        stored = stored.copy(state = "downloading")
        coordinator.handle("resume", stored.book.id)
        assertEquals(1, updates)
        stored = stored.copy(state = "complete")
        coordinator.handle("resume", stored.book.id)
        assertEquals(1, updates)
        assertEquals(0, joins)
        assertFalse(coordinator.hasPendingCommands())
    }

    @Test fun missingJobsAndUnknownActionsDoNothingAndClearPendingCount() = runBlocking {
        val existing = job("paused")
        var present = false
        var updates = 0
        var joins = 0
        val coordinator = DownloadCommandCoordinator(
            find = { existing.takeIf { present } },
            update = { updates++ },
            cancelAndJoin = { joins++ },
        )

        coordinator.handle("resume", existing.book.id)
        assertFalse(coordinator.hasPendingCommands())
        present = true
        coordinator.handle("restart", existing.book.id)
        coordinator.handle(null, existing.book.id)

        assertEquals(0, updates)
        assertEquals(0, joins)
        assertFalse(coordinator.hasPendingCommands())
    }

    @Test fun cancelUsesOriginalJobMetadataIfTheJobDisappearsDuringCleanup() = runBlocking {
        val original = job("downloading", error = "preserved metadata")
        var stored: DownloadJob? = original
        val updates = mutableListOf<DownloadJob>()
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it; updates += it },
            cancelAndJoin = { stored = null },
        )

        coordinator.handle("cancel", original.book.id)

        assertEquals(original.copy(state = "cancelled"), stored)
        assertEquals(listOf(original.copy(state = "cancelled"), original.copy(state = "cancelled")), updates)
        assertFalse(coordinator.hasPendingCommands())
    }

    @Test fun pendingCountIsReleasedWhenCleanupCallbackFails() = runBlocking {
        var stored = job("downloading")
        val cleanupFailure = IllegalStateException("cleanup failed")
        val coordinator = DownloadCommandCoordinator(
            find = { stored },
            update = { stored = it },
            cancelAndJoin = { throw cleanupFailure },
        )

        val result = runCatching { coordinator.handle("cancel", stored.book.id) }

        assertEquals(cleanupFailure, result.exceptionOrNull())
        assertEquals("cancelled", stored.state)
        assertFalse(coordinator.hasPendingCommands())
    }
}
