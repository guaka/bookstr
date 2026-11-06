package app.bookstr.download

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicInteger

/** Serializes control actions so an older pause/cancel cannot overwrite a later resume. */
internal class DownloadCommandCoordinator(
    private val find: (String) -> DownloadJob?,
    private val update: (DownloadJob) -> Unit,
    private val cancelAndJoin: suspend (String) -> Unit,
) {
    private val terminalActions = mapOf("pause" to "paused", "cancel" to "cancelled")
    private val mutex = Mutex()
    private val pending = AtomicInteger()
    private val startLock = Any()
    private var latestStartId = 0

    /** Includes actions waiting for the mutex as well as the action currently running. */
    fun hasPendingCommands(): Boolean = pending.get() > 0

    /** Records each Android start request, even when it carries no download action. */
    fun onStart(startId: Int) = synchronized(startLock) {
        if (startId > latestStartId) latestStartId = startId
    }

    /** Stops an idle service only if there are no controls and Android accepts the latest start id. */
    fun stopIfIdle(hasActiveJobs: Boolean, stop: (Int) -> Boolean): Boolean = synchronized(startLock) {
        if (hasActiveJobs || hasPendingCommands()) return@synchronized false
        stop(latestStartId)
    }

    suspend fun handle(action: String?, id: String) {
        synchronized(startLock) { pending.incrementAndGet() }
        try {
            mutex.withLock {
                val job = find(id) ?: return@withLock
                val terminalState = terminalActions[action]
                if (terminalState != null) {
                    update(job.copy(state = terminalState))
                    cancelAndJoin(id)
                    update((find(id) ?: job).copy(state = terminalState))
                } else if (action == "resume") {
                    if (!job.active && job.state != "complete") {
                        update(job.copy(state = "queued", error = null))
                    }
                }
            }
        } finally {
            synchronized(startLock) { pending.decrementAndGet() }
        }
    }
}
