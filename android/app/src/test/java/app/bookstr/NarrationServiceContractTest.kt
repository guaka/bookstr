package app.bookstr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class NarrationServiceContractTest {
    @Test
    fun manifestPublishesForegroundMediaAndAndroidAutoService() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val automotive = File("src/main/res/xml/automotive_app_desc.xml").readText()

        assertTrue(manifest.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"))
        assertTrue(manifest.contains("android:foregroundServiceType=\"mediaPlayback\""))
        assertTrue(manifest.contains("android.media.browse.MediaBrowserService"))
        assertTrue(manifest.contains("android.media.action.MEDIA_PLAY_FROM_SEARCH"))
        assertTrue(manifest.contains("com.google.android.gms.car.application"))
        assertTrue(automotive.contains("<uses name=\"media\""))
    }

    @Test
    fun serviceSupportsExternalControlsAndWordLevelResume() {
        val source = File("src/main/java/app/bookstr/NarrationService.kt").readText()

        assertTrue(source.contains("override fun onPlay()"))
        assertTrue(source.contains("override fun onPause()"))
        assertTrue(source.contains("override fun onSkipToNext()"))
        assertTrue(source.contains("override fun onSkipToPrevious()"))
        assertTrue(source.contains("override fun onPlayFromSearch"))
        assertTrue(source.contains("resumeOffset = currentRangeStart"))
        assertTrue(source.contains("synthesizeToFile(chunk.speak, Bundle(), file, chunk.id)"))
        assertTrue(source.contains("SpeechSpokenText.normalize"))
        assertTrue(source.contains("override fun onRangeStart"))
        assertTrue(source.contains("markerAt(currentPlaybackIndex"))
        assertTrue(source.contains("AUDIOFOCUS_LOSS_TRANSIENT"))
        assertTrue(source.contains("MediaStyle()"))
        assertTrue(source.contains("setWillPauseWhenDucked(true)"))
        assertTrue(source.contains("setPlaybackToLocal(AudioManager.STREAM_MUSIC)"))
        assertTrue(source.contains("MediaButtonReceiver.handleIntent"))
        assertFalse(source.contains("MediaButtonReceiver.buildMediaButtonPendingIntent"))
        assertTrue(source.contains("Intent(Intent.ACTION_MEDIA_BUTTON)"))
        assertTrue(source.contains("setComponent(ComponentName(this, MediaButtonReceiver::class.java))"))
        assertTrue(
            source.contains(
                "Intent(ACTION_STOP).setComponent(ComponentName(this, NarrationService::class.java))",
            ),
        )
        assertTrue(
            source.contains("setComponent(ComponentName(this, MainActivity::class.java))"),
        )
        assertFalse(source.contains("Intent(this, NarrationService::class.java)"))
        assertFalse(source.contains("Intent(this, MainActivity::class.java)"))
        assertTrue(source.contains("PendingIntent.getBroadcast"))
        assertTrue(source.contains("PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE"))
        assertTrue(
            Regex("PendingIntent\\.FLAG_UPDATE_CURRENT or PendingIntent\\.FLAG_IMMUTABLE")
                .findAll(source)
                .count() == 3,
        )
        assertTrue(Regex("mediaButtonPendingIntent\\(").findAll(source).count() == 4)
        assertTrue(source.contains("Service.START_STICKY"))
        assertTrue(source.contains("abandonAudioFocusRequest"))
    }
}
