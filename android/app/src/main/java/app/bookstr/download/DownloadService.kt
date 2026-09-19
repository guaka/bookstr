package app.bookstr.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.bookstr.BookstrApp
import app.bookstr.MainActivity
import kotlinx.coroutines.*

class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var wakeLock: android.os.PowerManager.WakeLock
    private val running = mutableMapOf<String, Job>()
    private val app get() = application as BookstrApp
    private val store get() = app.downloadStore
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Book downloads", NotificationManager.IMPORTANCE_LOW))
        wakeLock = getSystemService(android.os.PowerManager::class.java).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "Bookstr:downloads")
        startForeground(1002, notification())
        scope.launch {
            yield()
            while (isActive) {
                if (!wakeLock.isHeld) wakeLock.acquire(10 * 60 * 1000L)
                val connected = getSystemService(ConnectivityManager::class.java).let { it.getNetworkCapabilities(it.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true }
                for (job in store.jobs.value.filter { it.active }) {
                    if (!connected) {
                        running[job.book.id]?.cancelAndJoin(); running.remove(job.book.id)
                        if (store.find(job.book.id)?.active == true) store.update(job.copy(state = "waiting-network"))
                    } else if (running[job.book.id]?.isActive != true && running.values.count { it.isActive } < 2) start(job)
                }
                getSystemService(NotificationManager::class.java).notify(1002, notification())
                if (store.jobs.value.none { it.active } && running.values.none { it.isActive }) { stopForeground(STOP_FOREGROUND_DETACH); stopSelf(); break }
                delay(1500)
            }
        }
    }
    private fun start(job: DownloadJob) {
        running[job.book.id] = scope.launch {
            try {
                DownloadRunner().run(job, store.root(job.book.id), store::update) { book, file -> app.catalogRepository.importVerified(book, file) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (e: Exception) { store.update((store.find(job.book.id) ?: job).copy(state = "failed", error = e.message ?: "Download failed")) }
        }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra("id")
        if (id != null) scope.launch {
            val job = store.find(id) ?: return@launch
            when (intent.action) {
                "pause", "cancel" -> {
                    store.update(job.copy(state = if (intent.action == "pause") "paused" else "cancelled"))
                    running.remove(id)?.cancelAndJoin()
                    store.update((store.find(id) ?: job).copy(state = if (intent.action == "pause") "paused" else "cancelled"))
                }
                "resume" -> if (!job.active && job.state != "complete") store.update(job.copy(state = "queued", error = null))
            }
        }
        return START_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        store.jobs.value.filter { it.active }.forEach { store.update(it.copy(state = "paused", error = "Android paused background downloads; resume in Bookstr")) }
        scope.cancel(); stopSelf()
    }
    override fun onDestroy() { scope.cancel(); if (wakeLock.isHeld) wakeLock.release(); super.onDestroy() }
    private fun notification(): android.app.Notification {
        val jobs = store.jobs.value
        val active = jobs.firstOrNull { it.active }
        val displayed = active ?: jobs.lastOrNull()
        val pending = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).putExtra("open_downloads", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(displayed?.book?.title ?: "Bookstr downloads").setContentText(displayed?.error ?: displayed?.state ?: "Downloads finished")
            .setContentIntent(pending).setOnlyAlertOnce(true).setOngoing(active != null)
        if (active != null) {
            builder.setProgress(100, if (active.size > 0) (active.bytes * 100 / active.size).toInt() else 0, active.size == 0L)
        }
        if (displayed != null && displayed.state != "complete") {
            val action = if (active != null) "pause" else "resume"
            val control = Intent(this, DownloadService::class.java).setAction(action)
                .setData(android.net.Uri.parse("bookstr-download:${displayed.book.id}"))
                .putExtra("id", displayed.book.id)
            builder.addAction(0, if (active != null) "Pause" else "Resume", PendingIntent.getForegroundService(this, 0, control, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        return builder.build()
    }
    companion object {
        private const val CHANNEL = "book-downloads"
        fun dispatch(context: Context, action: String = "start", id: String? = null) {
            ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java).setAction(action).putExtra("id", id))
        }
    }
}
