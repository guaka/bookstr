package app.bookstr

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
        assertTrue(source.contains("override fun onBeginSynthesis"))
        assertTrue(source.contains("override fun onRangeStart"))
        assertTrue(source.contains("markerAt(currentPlaybackIndex"))
        assertTrue(source.contains("AUDIOFOCUS_LOSS_TRANSIENT"))
        assertTrue(source.contains("MediaStyle()"))
        assertTrue(source.contains("setWillPauseWhenDucked(true)"))
        assertTrue(source.contains("setPlaybackToLocal(AudioManager.STREAM_MUSIC)"))
        assertTrue(source.contains("MediaButtonReceiver.handleIntent"))
        assertTrue(source.contains("Service.START_STICKY"))
        assertTrue(source.contains("abandonAudioFocusRequest"))
    }
}
