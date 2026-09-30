package app.bookstr

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class NarrationServiceContractTest {
    @Test
    fun duplicateReaderRequestsBelongToNewestReaderUntilItIsDestroyed() {
        val ownership = NarrationRequestOwnership<Any>()
        val olderReader = Any()
        val newerReader = Any()

        ownership.register("book", olderReader)
        ownership.register("book", newerReader)
        assertFalse(ownership.isOwner("book", olderReader))
        assertTrue(ownership.isOwner("book", newerReader))

        // Ownership is retained while the app's MainActivity is foregrounded.
        assertTrue(ownership.isOwner("book", newerReader))
        ownership.unregister("book", newerReader)
        assertTrue(ownership.isOwner("book", olderReader))
    }

    @Test
    fun preparationSpinnerStopsWhenAudioStartsEvenDuringPrefetch() {
        assertTrue(NarrationPreparationState.isPreparing(true, textMissing = false, audioPlaying = false))
        assertFalse(NarrationPreparationState.isPreparing(true, textMissing = false, audioPlaying = true))
        assertFalse(NarrationPreparationState.isPreparing(false, textMissing = true, audioPlaying = false))
    }

    @Test
    fun narrationFailureFeedbackNamesSelectedVoiceAndSuggestsRecovery() {
        assertEquals(
            "Kokoro · Português (Brasil) could not read this passage. Try another voice for this language in Settings.",
            NarrationFailureFeedback.message("Kokoro · Português (Brasil)"),
        )
        assertEquals(
            "Speech could not read this passage. Try another voice in Settings.",
            NarrationFailureFeedback.message(null),
        )
    }

    @Test
    fun readingSpeedMapsIosRateRangeToAndroidPlaybackMultiplier() {
        assertEquals(0.35f / 0.48f, NarrationSpeed.multiplier(0.35f), 0.0001f)
        assertEquals(1.0f, NarrationSpeed.multiplier(0.48f), 0.0001f)
        assertEquals(0.60f / 0.48f, NarrationSpeed.multiplier(0.60f), 0.0001f)
        assertEquals(0.35f / 0.48f, NarrationSpeed.multiplier(0.1f), 0.0001f)
        assertEquals(0.60f / 0.48f, NarrationSpeed.multiplier(2.0f), 0.0001f)
    }

    @Test
    fun staleOrDuplicateDelayedChunksCannotStartAndKokoroUsesShorterPauses() {
        assertFalse(NarrationSessionTransition.shouldStop("same-book", "same-book"))
        assertTrue(NarrationSessionTransition.shouldStop("active-book", "other-book"))
        assertTrue(NarrationPlaybackTiming.shouldComplete(4, 4, 1, 1))
        assertFalse(NarrationPlaybackTiming.shouldComplete(3, 4, 1, 1))
        assertFalse(NarrationPlaybackTiming.shouldComplete(4, 4, 0, 1))
        assertTrue(NarrationPlaybackTiming.shouldStart(4, 4, 2, 2, false))
        assertFalse(NarrationPlaybackTiming.shouldStart(3, 4, 2, 2, false))
        assertFalse(NarrationPlaybackTiming.shouldStart(4, 4, 1, 2, false))
        assertFalse(NarrationPlaybackTiming.shouldStart(4, 4, 2, 2, true))
        assertEquals(120L, NarrationPlaybackTiming.pauseMillis(480, neural = false))
        assertEquals(120L, NarrationPlaybackTiming.pauseMillis(480, neural = true))
        assertEquals(120L, NarrationPlaybackTiming.pauseMillis(750, neural = true))
        assertEquals(13L, NarrationPlaybackTiming.pauseMillis(40, neural = true))
        assertEquals(0L, NarrationPlaybackTiming.pauseMillis(-1, neural = false))
    }

    @Test
    fun neuralChunksSplitIntoPlayablePhrasesWithMonotonicSourceOffsets() {
        val source = (1..60).joinToString(" ") { "word$it" }
        val next = "A new section begins."
        val original = NarrationChunk("original", source, source, 100, 0, 8, false)
        val continuation = NarrationChunk("continuation", next, next, 100 + source.length + 1, 750, 8, true)

        val phrases = prepareNeuralNarrationQueue(listOf(original, continuation), generation = 9)

        assertTrue(phrases.size > 1)
        assertEquals("$source $next", phrases.joinToString(" ") { it.text })
        assertEquals(100, phrases.first().offset)
        val continuationIndex = phrases.indexOfFirst { it.offset == continuation.offset }
        assertTrue(continuationIndex > 0)
        assertEquals(750L, phrases[continuationIndex].pauseMillis)
        assertTrue(phrases.drop(1).filterIndexed { index, _ -> index + 1 != continuationIndex }
            .all { it.pauseMillis == 0L })
        assertTrue(phrases.zipWithNext().all { (left, right) -> left.offset + left.text.length < right.offset })
        assertTrue(phrases.all { it.speak.length <= 140 })
        assertTrue(phrases.first().speak.length <= 70)
        assertTrue(phrases[continuationIndex].speak.length <= 70)
        assertEquals("synth-9-0", phrases.first().id)
        assertTrue(phrases.dropLast(1).none { it.isFinal })
        assertTrue(phrases.last().isFinal)
    }

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
        assertTrue(source.contains("EXTRA_REQUEST_CONTINUE"))
        assertTrue(source.contains("requestContinue = true"))
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

    @Test
    fun appIslandCanObserveAndControlAnExistingSession() {
        val service = File("src/main/java/app/bookstr/NarrationService.kt").readText()
        val island = File("src/main/java/app/bookstr/ui/NarrationIsland.kt").readText()

        assertTrue(service.contains("const val EXTRA_SESSION_ACTIVE = \"session_active\""))
        assertTrue(service.contains(".putExtra(EXTRA_SESSION_ACTIVE, sessionActive)"))
        assertTrue(service.contains("fun togglePlayback(context: Context)"))
        assertTrue(service.contains("fun stopIfDifferentBook(context: Context, targetBookId: String)"))
        assertTrue(service.contains("EXTRA_IS_PREPARING"))
        assertTrue(island.contains("NarrationService.sync(context)"))
        assertTrue(island.contains("NarrationService.togglePlayback(context)"))
        assertTrue(island.contains("NarrationService.stop(context)"))
        assertTrue(island.contains("testTag(\"narration.island\")"))
        assertTrue(island.contains("testTag(\"narration.preparing\")"))
        assertTrue(island.contains("onOpenBook?.invoke(state.bookId, state.title, state.author)"))
        assertTrue(service.contains("fun setSpeechRate(context: Context, language: String, rate: Float)"))
        assertTrue(service.contains("ACTION_RATE ->"))
        assertTrue(service.contains("applyNeuralPlaybackRate(player)"))
        assertTrue(service.contains("putExtra(EXTRA_RATE, speechSettings.rate(speechLanguage))"))
        assertTrue(island.contains("NarrationService.setSpeechRate(context, state.language, rate)"))
    }
}
