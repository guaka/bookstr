package app.bookstr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.MediaBrowserServiceCompat
import androidx.media.app.NotificationCompat.MediaStyle
import androidx.media.session.MediaButtonReceiver
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import java.net.URL
import java.io.File
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Owns spoken-book playback independently from ReaderActivity. The media session makes narration
 * controllable from the lock screen, Bluetooth headsets, car controls, Assistant, and Android Auto.
 */
class NarrationService : MediaBrowserServiceCompat(), TextToSpeech.OnInitListener {
    private lateinit var mediaSession: MediaSessionCompat
    private lateinit var notificationManager: NotificationManager
    private lateinit var audioManager: AudioManager
    private lateinit var audioFocusRequest: AudioFocusRequest
    private var textToSpeech: TextToSpeech? = null
    private var textToSpeechReady = false
    private var foregroundStarted = false
    private var isPlaying = false
    private var resumeAfterAudioFocus = false
    private var pendingPlay = false
    private var generation = 0
    private var speechText = ""
    private var speechLanguage = "en"
    private var speechChunkInputs: List<IncomingNarrationChunk> = emptyList()
    private var resumeOffset = 0
    private var currentRangeStart = 0
    private var speechQueue: List<NarrationChunk> = emptyList()
    private var currentPlaybackIndex = 0
    private var synthesizingIndex = -1
    private var mediaPlayer: MediaPlayer? = null
    private val audioFiles = ConcurrentHashMap<Int, File>()
    private val readyAudio = Collections.newSetFromMap(ConcurrentHashMap<Int, Boolean>())
    private val speechMarkers = ConcurrentHashMap<Int, MutableList<SpeechMarker>>()
    private val synthesisSampleRates = ConcurrentHashMap<Int, Int>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private var artworkRequestUrl: String? = null
    private var artwork: Bitmap? = null

    private var bookId = ""
    private var bookTitle = "Bookstr"
    private var bookAuthor = ""
    private var bookCoverUrl: String? = null
    private var currentParagraph = ""

    private val progressTicker = object : Runnable {
        override fun run() {
            val player = mediaPlayer ?: return
            val chunk = speechQueue.getOrNull(currentPlaybackIndex) ?: return
            if (!isPlaying || !player.isPlaying) return
            val duration = player.duration.coerceAtLeast(1)
            val marker = markerAt(currentPlaybackIndex, player.currentPosition)
            val fraction = (player.currentPosition.toDouble() / duration).coerceIn(0.0, 1.0)
            currentRangeStart = marker?.let { chunk.offset + it.start }
                ?: (chunk.offset + (chunk.text.length * fraction).toInt())
                    .coerceIn(chunk.offset, chunk.offset + chunk.text.length)
            resumeOffset = currentRangeStart
            publishState(
                offset = currentRangeStart,
                length = marker?.let { (it.end - it.start).coerceAtLeast(1) } ?: 1,
            )
            mainHandler.postDelayed(this, PROGRESS_INTERVAL_MILLIS)
        }
    }

    private val mediaSessionCallback = object : MediaSessionCompat.Callback() {
        override fun onPlay() = playOrRequestText()
        override fun onPause() = pauseNarration()
        override fun onStop() = stopNarration(removeNotification = true)
        override fun onSkipToNext() = requestPage(1)
        override fun onSkipToPrevious() = requestPage(-1)
        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) = playOrRequestText()
        override fun onPlayFromSearch(query: String?, extras: Bundle?) = playOrRequestText()
    }

    private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (resumeAfterAudioFocus) {
                    resumeAfterAudioFocus = false
                    playOrRequestText()
                }
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
            -> {
                resumeAfterAudioFocus = isPlaying
                pauseNarration(abandonAudioFocus = false)
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                resumeAfterAudioFocus = false
                pauseNarration(abandonAudioFocus = false)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        running = true
        notificationManager = getSystemService(NotificationManager::class.java)
        audioManager = getSystemService(AudioManager::class.java)
        createNotificationChannel()

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(audioAttributes)
            .setOnAudioFocusChangeListener(audioFocusListener)
            .setWillPauseWhenDucked(true)
            .build()

        mediaSession = MediaSessionCompat(this, SESSION_TAG).apply {
            setCallback(mediaSessionCallback)
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS,
            )
            // The selected Android TTS engine renders in a separate process. Explicit local
            // routing still makes Bookstr the hardware media-button and car-control owner.
            setPlaybackToLocal(AudioManager.STREAM_MUSIC)
            setSessionActivity(mainActivityPendingIntent())
            isActive = true
        }
        sessionToken = mediaSession.sessionToken
        updatePlaybackState(PlaybackStateCompat.STATE_NONE)
        updateMetadata()

        textToSpeech = TextToSpeech(this, this)
    }

    override fun onInit(status: Int) {
        textToSpeechReady = status == TextToSpeech.SUCCESS
        val engine = textToSpeech
        if (!textToSpeechReady || engine == null) {
            pendingPlay = false
            publishState(message = "Text-to-speech is not available on this device.")
            return
        }
        engine.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onBeginSynthesis(
                utteranceId: String?,
                sampleRateInHz: Int,
                audioFormat: Int,
                channelCount: Int,
            ) {
                val parsed = parseSynthesisId(utteranceId) ?: return
                if (parsed.first == generation) synthesisSampleRates[parsed.second] = sampleRateInHz
            }

            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                val parsed = parseSynthesisId(utteranceId) ?: return
                if (parsed.first != generation) return
                speechMarkers.computeIfAbsent(parsed.second) {
                    Collections.synchronizedList(mutableListOf())
                }.add(SpeechMarker(start, end, frame))
            }

            override fun onDone(utteranceId: String?) {
                val parsed = parseSynthesisId(utteranceId) ?: return
                mainHandler.post { onChunkSynthesized(parsed.first, parsed.second) }
            }

            @Deprecated("Required by UtteranceProgressListener")
            override fun onError(utteranceId: String?) = onSpeechError(utteranceId, TextToSpeech.ERROR)

            override fun onError(utteranceId: String?, errorCode: Int) = onSpeechError(utteranceId, errorCode)
        })
        if (pendingPlay) {
            pendingPlay = false
            startSpeakingAt(resumeOffset)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == Intent.ACTION_MEDIA_BUTTON) {
            MediaButtonReceiver.handleIntent(mediaSession, intent)
            return Service.START_STICKY
        }
        when (intent?.action) {
            ACTION_SPEAK -> {
                readBookMetadata(intent)
                speechText = intent.getStringExtra(EXTRA_TEXT).orEmpty()
                speechLanguage = intent.getStringExtra(EXTRA_LANGUAGE).orEmpty().ifBlank { "en" }
                speechChunkInputs = parseIncomingSpeechChunks(intent.getStringExtra(EXTRA_CHUNKS).orEmpty())
                resumeOffset = 0
                currentRangeStart = 0
                currentParagraph = ""
                ensureForeground()
                loadArtwork(bookCoverUrl)
                playOrRequestText()
                notifyChildrenChanged(ROOT_ID)
            }
            ACTION_TOGGLE -> {
                readBookMetadata(intent)
                speechChunkInputs = emptyList()
                ensureForeground()
                if (isPlaying) pauseNarration() else playOrRequestText()
            }
            ACTION_STOP -> stopNarration(removeNotification = true)
            ACTION_SYNC -> publishState(offset = currentRangeStart, length = currentMarkerLength())
            ACTION_PARAGRAPH -> {
                currentParagraph = intent.getStringExtra(EXTRA_PARAGRAPH).orEmpty().take(600)
                updateMetadata()
                updateNotification()
            }
        }
        return Service.START_STICKY
    }

    override fun onGetRoot(
        clientPackageName: String,
        clientUid: Int,
        rootHints: Bundle?,
    ): BrowserRoot = BrowserRoot(ROOT_ID, null)

    override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowserCompat.MediaItem>>) {
        if (parentId != ROOT_ID || bookId.isBlank()) {
            result.sendResult(mutableListOf())
            return
        }
        val description = MediaDescriptionCompat.Builder()
            .setMediaId(bookId)
            .setTitle(bookTitle)
            .setSubtitle(bookAuthor)
            .setIconUri(bookCoverUrl?.let(Uri::parse))
            .build()
        result.sendResult(
            mutableListOf(
                MediaBrowserCompat.MediaItem(description, MediaBrowserCompat.MediaItem.FLAG_PLAYABLE),
            ),
        )
    }

    private fun playOrRequestText() {
        if (speechText.isBlank() || resumeOffset >= speechText.length) {
            publishState(requestText = true)
            updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
            updateNotification()
            return
        }
        if (!requestAudioFocus()) return
        isPlaying = true
        ensureForeground()
        updatePlaybackState(PlaybackStateCompat.STATE_PLAYING)
        updateNotification()
        publishState()
        mediaPlayer?.let { player ->
            if (!player.isPlaying) {
                player.start()
                mainHandler.removeCallbacks(progressTicker)
                mainHandler.post(progressTicker)
            }
            return
        }
        if (!textToSpeechReady) {
            pendingPlay = true
            return
        }
        if (speechQueue.isEmpty()) startSpeakingAt(resumeOffset)
    }

    private fun startSpeakingAt(offset: Int) {
        val engine = textToSpeech ?: return
        if (speechText.isBlank()) return
        generation += 1
        val activeGeneration = generation
        resetAudioPipeline(cancelSynthesis = true)
        val startOffset = offset.coerceIn(0, speechText.length)
        val chunkInputs = speechChunkInputs.takeIf { it.isNotEmpty() }?.map { it.text to it.pauseMillis }?.let { values ->
            if (values.any { it.first.isBlank() }) null else values
        } ?: emptyList()
        speechQueue = if (chunkInputs.isNotEmpty()) {
            val chunks = mutableListOf<NarrationChunk>()
            var searchFrom = startOffset
            var allMatched = true
            for (entry in speechChunkInputs) {
                val chunkText = entry.text.trim()
                if (chunkText.isBlank()) continue
                var chunkOffset = if (entry.start >= 0) {
                    val expectedOffset = entry.start
                    if (expectedOffset >= searchFrom &&
                        expectedOffset + chunkText.length <= speechText.length &&
                        speechText.regionMatches(expectedOffset, chunkText, 0, chunkText.length)
                    ) {
                        expectedOffset
                    } else {
                        -1
                    }
                } else {
                    -1
                }
                if (chunkOffset < 0) {
                    chunkOffset = speechText.indexOf(chunkText, searchFrom).takeIf { it >= 0 }
                        ?: speechText.indexOf(chunkText).takeIf { it >= 0 }
                        ?: -1
                }
                if (chunkOffset < 0) {
                    allMatched = false
                    break
                }
                chunks += NarrationChunk(
                    id = synthesisId(activeGeneration, chunks.size),
                    text = chunkText,
                    offset = chunkOffset,
                    generation = activeGeneration,
                    isFinal = false,
                    pauseMillis = entry.pauseMillis.coerceAtLeast(0L),
                )
                searchFrom = chunkOffset + chunkText.length
            }
            if (allMatched) {
                chunks.mapIndexed { index, chunk ->
                    chunk.copy(isFinal = index == chunks.lastIndex)
                }
            } else {
                emptyList()
            }
        } else {
            emptyList()
        }
        if (speechQueue.isEmpty()) {
            val remaining = speechText.substring(startOffset)
            var searchFrom = startOffset
            val chunkTexts = ReaderActivity.speechChunks(remaining)
            speechQueue = chunkTexts.mapIndexed { index, text ->
                val chunkOffset = speechText.indexOf(text, searchFrom).takeIf { it >= 0 } ?: searchFrom
                searchFrom = chunkOffset + text.length
                NarrationChunk(
                    id = synthesisId(activeGeneration, index),
                    text = text,
                    offset = chunkOffset,
                    generation = activeGeneration,
                    isFinal = index == chunkTexts.lastIndex,
                    pauseMillis = SENTENCE_PAUSE_MILLIS,
                )
            }
            speechChunkInputs = emptyList()
        } else {
            speechChunkInputs = emptyList()
        }
        currentPlaybackIndex = speechQueue.indexOfFirst { it.offset + it.text.length > startOffset }.takeIf { it >= 0 } ?: 0
        if (speechQueue.isEmpty()) {
            finishNaturally()
            return
        }
        selectVoice(engine, speechLanguage)
        // Piper voices are trained at their natural cadence. Slowing them down exaggerates
        // vocoder grain and room noise, so keep synthesis at the model's native rate.
        engine.setSpeechRate(1.0f)
        engine.setPitch(1.0f)
        synthesizeChunk(0)
    }

    private fun synthesizeChunk(index: Int) {
        if (index !in speechQueue.indices || audioFiles.containsKey(index) || synthesizingIndex >= 0) return
        val chunk = speechQueue[index]
        val engine = textToSpeech ?: return
        val directory = File(cacheDir, "narration-audio").apply { mkdirs() }
        val file = File(directory, "${chunk.id}.wav")
        audioFiles[index] = file
        synthesizingIndex = index
        val result = engine.synthesizeToFile(chunk.text, Bundle(), file, chunk.id)
        if (result == TextToSpeech.ERROR) {
            synthesizingIndex = -1
            audioFiles.remove(index)
            file.delete()
            onSpeechError(chunk.id, result)
        }
    }

    private fun onChunkSynthesized(completedGeneration: Int, index: Int) {
        if (completedGeneration != generation || index !in speechQueue.indices) return
        synthesizingIndex = -1
        readyAudio += index
        if (index == currentPlaybackIndex && mediaPlayer == null) playChunk(index)
        synthesizeChunk(index + 1)
    }

    private fun parseIncomingSpeechChunks(json: String): List<IncomingNarrationChunk> {
        val payload = runCatching { JSONArray(json) }.getOrNull() ?: return emptyList()
        val chunks = mutableListOf<IncomingNarrationChunk>()
        for (index in 0 until payload.length()) {
            val chunk = payload.optJSONObject(index) ?: continue
            val text = chunk.optString("text")
            if (text.isBlank()) continue
            val pause = chunk.optLong("pauseMs", SENTENCE_PAUSE_MILLIS)
            val start = chunk.optInt("start", -1)
            chunks += IncomingNarrationChunk(text = text, pauseMillis = pause, start = start)
        }
        return chunks
    }

    private fun playChunk(index: Int) {
        val chunk = speechQueue.getOrNull(index) ?: return finishNaturally()
        val file = audioFiles[index]?.takeIf(File::isFile) ?: return
        val player = MediaPlayer()
        runCatching {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            player.setDataSource(file.absolutePath)
            player.setOnCompletionListener { onChunkPlaybackComplete(index) }
            player.setOnErrorListener { _, what, extra ->
                onSpeechError(chunk.id, what.takeIf { it != 0 } ?: extra)
                true
            }
            player.prepare()
            mediaPlayer = player
            currentRangeStart = chunk.offset
            resumeOffset = chunk.offset
            publishState(offset = chunk.offset, length = 1)
            if (isPlaying) {
                player.start()
                mainHandler.removeCallbacks(progressTicker)
                mainHandler.post(progressTicker)
            }
        }.onFailure {
            player.release()
            onSpeechError(chunk.id, TextToSpeech.ERROR)
        }
    }

    private fun onChunkPlaybackComplete(index: Int) {
        if (index != currentPlaybackIndex) return
        mainHandler.removeCallbacks(progressTicker)
        mediaPlayer?.release()
        mediaPlayer = null
        audioFiles.remove(index)?.delete()
        readyAudio.remove(index)
        val completed = speechQueue[index]
        resumeOffset = completed.offset + completed.text.length
        currentRangeStart = resumeOffset
        if (completed.isFinal) {
            finishNaturally()
            return
        }
        currentPlaybackIndex += 1
        mainHandler.postDelayed(
            {
                if (readyAudio.contains(currentPlaybackIndex)) playChunk(currentPlaybackIndex)
                else synthesizeChunk(currentPlaybackIndex)
            },
            speechQueue.getOrNull(currentPlaybackIndex)?.pauseMillis ?: SENTENCE_PAUSE_MILLIS,
        )
    }

    private fun resetAudioPipeline(cancelSynthesis: Boolean) {
        mainHandler.removeCallbacks(progressTicker)
        mediaPlayer?.release()
        mediaPlayer = null
        if (cancelSynthesis) textToSpeech?.stop()
        synthesizingIndex = -1
        audioFiles.values.forEach(File::delete)
        audioFiles.clear()
        readyAudio.clear()
        speechMarkers.clear()
        synthesisSampleRates.clear()
        speechQueue = emptyList()
        currentPlaybackIndex = 0
    }

    private fun synthesisId(generation: Int, index: Int): String = "synth-$generation-$index"

    private fun parseSynthesisId(id: String?): Pair<Int, Int>? {
        val parts = id?.split('-') ?: return null
        if (parts.size != 3 || parts[0] != "synth") return null
        return (parts[1].toIntOrNull() ?: return null) to (parts[2].toIntOrNull() ?: return null)
    }

    private fun markerAt(index: Int, playbackPositionMillis: Int): SpeechMarker? {
        val sampleRate = synthesisSampleRates[index] ?: return null
        val frame = playbackPositionMillis.toLong() * sampleRate / 1_000L
        val markers = speechMarkers[index] ?: return null
        return synchronized(markers) { markers.lastOrNull { it.frame.toLong() <= frame } }
    }

    private fun currentMarkerLength(): Int {
        val marker = mediaPlayer?.let { markerAt(currentPlaybackIndex, it.currentPosition) }
        return marker?.let { (it.end - it.start).coerceAtLeast(1) } ?: 1
    }

    private fun selectVoice(engine: TextToSpeech, languageTag: String) {
        val requestedLocale = ReaderActivity.preferredSpeechLocale(languageTag)
        val sameLanguageOfflineVoices = engine.voices.orEmpty().filter { voice ->
            !voice.isNetworkConnectionRequired &&
                voice.locale.language.equals(requestedLocale.language, ignoreCase = true)
        }
        val exactRegionOfflineVoices = sameLanguageOfflineVoices.filter { voice ->
            requestedLocale.country.isNotBlank() &&
                voice.locale.country.equals(requestedLocale.country, ignoreCase = true)
        }
        val currentVoiceName = engine.voice?.name
        val resolvedVoice = sameLanguageOfflineVoices.maxWithOrNull(
            compareBy<Voice> { it.quality }
                .thenBy { voice -> exactRegionOfflineVoices.any { it.name == voice.name } }
                .thenBy { it.name == currentVoiceName },
        )
        if (resolvedVoice != null) {
            engine.voice = resolvedVoice
            Log.i(
                LOG_TAG,
                "Selected voice ${resolvedVoice.name} (${resolvedVoice.locale.toLanguageTag()}, " +
                    "quality=${resolvedVoice.quality})",
            )
        } else {
            engine.language = requestedLocale
            Log.i(LOG_TAG, "Using engine locale ${requestedLocale.toLanguageTag()}")
        }
    }

    private fun pauseNarration(abandonAudioFocus: Boolean = true) {
        if (!isPlaying && !pendingPlay) return
        pendingPlay = false
        isPlaying = false
        mediaPlayer?.takeIf { it.isPlaying }?.pause()
        mainHandler.removeCallbacks(progressTicker)
        if (abandonAudioFocus) audioManager.abandonAudioFocusRequest(audioFocusRequest)
        updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
        updateNotification()
        publishState()
    }

    private fun requestPage(direction: Int) {
        generation += 1
        resetAudioPipeline(cancelSynthesis = true)
        speechText = ""
        resumeOffset = 0
        currentRangeStart = 0
        currentParagraph = ""
        isPlaying = true
        ensureForeground()
        updatePlaybackState(PlaybackStateCompat.STATE_BUFFERING)
        updateMetadata()
        updateNotification()
        publishState(pageDirection = direction, requestText = true)
    }

    private fun finishNaturally() {
        isPlaying = false
        pendingPlay = false
        resumeOffset = speechText.length
        resetAudioPipeline(cancelSynthesis = false)
        audioManager.abandonAudioFocusRequest(audioFocusRequest)
        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
        updateNotification()
        publishState(clearProgress = true)
    }

    private fun onSpeechError(utteranceId: String?, errorCode: Int) {
        val parsed = parseSynthesisId(utteranceId)
        if (parsed != null && parsed.first != generation) return
        Log.e(LOG_TAG, "Speech failed for $utteranceId with error code $errorCode")
        generation += 1
        resetAudioPipeline(cancelSynthesis = true)
        isPlaying = false
        pendingPlay = false
        updatePlaybackState(PlaybackStateCompat.STATE_ERROR)
        updateNotification()
        publishState(
            message = "The selected speech voice could not read this text.",
            clearProgress = true,
        )
    }

    private fun stopNarration(removeNotification: Boolean) {
        generation += 1
        pendingPlay = false
        isPlaying = false
        speechText = ""
        currentParagraph = ""
        resumeOffset = 0
        currentRangeStart = 0
        resetAudioPipeline(cancelSynthesis = true)
        audioManager.abandonAudioFocusRequest(audioFocusRequest)
        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED)
        publishState(clearProgress = true)
        if (removeNotification) {
            foregroundStarted = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        } else {
            updateNotification()
        }
    }

    private fun requestAudioFocus(): Boolean {
        val granted = audioManager.requestAudioFocus(audioFocusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!granted) {
            isPlaying = false
            updatePlaybackState(PlaybackStateCompat.STATE_PAUSED)
            publishState(message = "Another app is currently using audio.")
        }
        return granted
    }

    private fun readBookMetadata(intent: Intent) {
        intent.getStringExtra(EXTRA_BOOK_ID)?.let { bookId = it }
        intent.getStringExtra(EXTRA_BOOK_TITLE)?.takeIf(String::isNotBlank)?.let { bookTitle = it }
        intent.getStringExtra(EXTRA_BOOK_AUTHOR)?.let { bookAuthor = it }
        intent.getStringExtra(EXTRA_COVER_URL)?.let { bookCoverUrl = it.takeIf(String::isNotBlank) }
        updateMetadata()
    }

    private fun updatePlaybackState(state: Int) {
        val actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
            PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID
        mediaSession.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(
                    state,
                    PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                    if (state == PlaybackStateCompat.STATE_PLAYING) 1f else 0f,
                    SystemClock.elapsedRealtime(),
                )
                .build(),
        )
    }

    private fun updateMetadata() {
        val paragraph = currentParagraph.trim()
        val paragraphLines = splitParagraph(paragraph)
        val byline = if (bookAuthor.isBlank()) bookTitle else "$bookTitle — $bookAuthor"
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, bookId)
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, paragraphLines?.first ?: bookTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, paragraphLines?.second ?: bookAuthor)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, if (paragraphLines == null) "Bookstr" else byline)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, paragraphLines?.first ?: bookTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, paragraphLines?.second ?: bookAuthor)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_DESCRIPTION, byline)
            // Platform media type 2 denotes an audiobook; MediaMetadataCompat does not expose it.
            .putLong("android.media.metadata.MEDIA_TYPE", 2L)
        artwork?.let {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it)
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }
        mediaSession.setMetadata(builder.build())
    }

    private fun splitParagraph(paragraph: String): Pair<String, String>? {
        if (paragraph.isBlank()) return null
        val firstLimit = minOf(paragraph.length, 110)
        val boundary = paragraph.substring(0, firstLimit).lastIndexOf(' ').takeIf { it > 40 } ?: firstLimit
        val first = paragraph.substring(0, boundary).trim()
        val continuation = paragraph.substring(boundary).trim().take(220)
            .ifBlank { if (bookAuthor.isBlank()) bookTitle else "$bookTitle — $bookAuthor" }
        return first to continuation
    }

    private fun loadArtwork(url: String?) {
        if (url.isNullOrBlank() || url == artworkRequestUrl) return
        artworkRequestUrl = url
        artworkExecutor.execute {
            val decoded = runCatching {
                URL(url).openConnection().apply {
                    connectTimeout = 10_000
                    readTimeout = 15_000
                }.getInputStream().use(BitmapFactory::decodeStream)
            }.getOrNull() ?: return@execute
            if (artworkRequestUrl != url) return@execute
            artwork = decoded
            updateMetadata()
            updateNotification()
        }
    }

    private fun ensureForeground() {
        val notification = buildNotification()
        if (!foregroundStarted) {
            foregroundStarted = true
            startForeground(NOTIFICATION_ID, notification)
        } else {
            notificationManager.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification() {
        if (foregroundStarted) notificationManager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val metadata = mediaSession.controller.metadata
        val description = metadata?.description
        val previous = mediaButtonPendingIntent(
            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS,
        )
        val playPause = mediaButtonPendingIntent(
            if (isPlaying) PlaybackStateCompat.ACTION_PAUSE else PlaybackStateCompat.ACTION_PLAY,
        )
        val next = mediaButtonPendingIntent(
            PlaybackStateCompat.ACTION_SKIP_TO_NEXT,
        )
        val stop = PendingIntent.getService(
            this,
            4,
            Intent(this, NarrationService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(description?.title ?: bookTitle)
            .setContentText(description?.subtitle ?: bookAuthor)
            .setSubText(description?.description ?: "Bookstr")
            .setLargeIcon(description?.iconBitmap)
            .setContentIntent(mainActivityPendingIntent())
            .setDeleteIntent(stop)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(isPlaying)
            .addAction(android.R.drawable.ic_media_previous, "Previous page", previous)
            .addAction(
                if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (isPlaying) "Pause" else "Play",
                playPause,
            )
            .addAction(android.R.drawable.ic_media_next, "Next page", next)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
                    .setShowCancelButton(true)
                    .setCancelButtonIntent(stop),
            )
            .build()
    }

    private fun mediaButtonPendingIntent(action: Long): PendingIntent {
        val keyCode = PlaybackStateCompat.toKeyCode(action)
        val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
            .setComponent(ComponentName(this, MediaButtonReceiver::class.java))
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        return PendingIntent.getBroadcast(
            this,
            keyCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun mainActivityPendingIntent(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(
            Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        ),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun createNotificationChannel() {
        notificationManager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Read aloud",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Book narration controls"
                setShowBadge(false)
            },
        )
    }

    private fun publishState(
        requestText: Boolean = false,
        pageDirection: Int = 0,
        offset: Int = -1,
        length: Int = 0,
        message: String? = null,
        clearProgress: Boolean = false,
    ) {
        sendBroadcast(
            Intent(ACTION_EVENT)
                .setPackage(packageName)
                .putExtra(EXTRA_IS_PLAYING, isPlaying)
                .putExtra(EXTRA_HAS_TEXT, speechText.isNotBlank())
                .putExtra(EXTRA_REQUEST_TEXT, requestText)
                .putExtra(EXTRA_PAGE_DIRECTION, pageDirection)
                .putExtra(EXTRA_OFFSET, offset)
                .putExtra(EXTRA_LENGTH, length)
                .putExtra(EXTRA_MESSAGE, message)
                .putExtra(EXTRA_CLEAR_PROGRESS, clearProgress),
        )
    }

    override fun onDestroy() {
        running = false
        resetAudioPipeline(cancelSynthesis = true)
        textToSpeech?.shutdown()
        textToSpeech = null
        artworkExecutor.shutdownNow()
        audioManager.abandonAudioFocusRequest(audioFocusRequest)
        mediaSession.release()
        super.onDestroy()
    }

    companion object {
        const val ACTION_EVENT = "app.bookstr.action.NARRATION_EVENT"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val EXTRA_HAS_TEXT = "has_text"
        const val EXTRA_REQUEST_TEXT = "request_text"
        const val EXTRA_PAGE_DIRECTION = "page_direction"
        const val EXTRA_OFFSET = "offset"
        const val EXTRA_LENGTH = "length"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_CLEAR_PROGRESS = "clear_progress"

        private const val ACTION_SPEAK = "app.bookstr.action.NARRATION_SPEAK"
        private const val ACTION_TOGGLE = "app.bookstr.action.NARRATION_TOGGLE"
        private const val ACTION_STOP = "app.bookstr.action.NARRATION_STOP"
        private const val ACTION_SYNC = "app.bookstr.action.NARRATION_SYNC"
        private const val ACTION_PARAGRAPH = "app.bookstr.action.NARRATION_PARAGRAPH"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_LANGUAGE = "language"
        private const val EXTRA_BOOK_ID = "book_id"
        private const val EXTRA_BOOK_TITLE = "book_title"
        private const val EXTRA_BOOK_AUTHOR = "book_author"
        private const val EXTRA_COVER_URL = "cover_url"
        private const val EXTRA_PARAGRAPH = "paragraph"
        private const val EXTRA_CHUNKS = "chunks"
        private const val CHANNEL_ID = "bookstr-narration"
        private const val NOTIFICATION_ID = 4107
        private const val SESSION_TAG = "BookstrNarration"
        private const val ROOT_ID = "bookstr-current-book"
        private const val LOG_TAG = "BookstrNarration"
        private const val SENTENCE_PAUSE_MILLIS = 240L
        private const val PROGRESS_INTERVAL_MILLIS = 300L
        @Volatile private var running = false

        fun speak(
            context: Context,
            text: String,
            language: String,
            chunks: String = "",
            bookId: String,
            title: String,
            author: String?,
            coverUrl: String?,
        ) {
            startForeground(
                context,
                Intent(context, NarrationService::class.java)
                    .setAction(ACTION_SPEAK)
                    .putExtra(EXTRA_TEXT, text)
                    .putExtra(EXTRA_LANGUAGE, language)
                    .putExtra(EXTRA_CHUNKS, chunks)
                    .putExtra(EXTRA_BOOK_ID, bookId)
                    .putExtra(EXTRA_BOOK_TITLE, title)
                    .putExtra(EXTRA_BOOK_AUTHOR, author)
                    .putExtra(EXTRA_COVER_URL, coverUrl),
            )
        }

        fun toggle(
            context: Context,
            bookId: String,
            title: String,
            author: String?,
            coverUrl: String?,
        ) {
            startForeground(
                context,
                Intent(context, NarrationService::class.java)
                    .setAction(ACTION_TOGGLE)
                    .putExtra(EXTRA_BOOK_ID, bookId)
                    .putExtra(EXTRA_BOOK_TITLE, title)
                    .putExtra(EXTRA_BOOK_AUTHOR, author)
                    .putExtra(EXTRA_COVER_URL, coverUrl),
            )
        }

        fun stop(context: Context) {
            context.startService(Intent(context, NarrationService::class.java).setAction(ACTION_STOP))
        }

        fun sync(context: Context) {
            if (running) {
                context.startService(Intent(context, NarrationService::class.java).setAction(ACTION_SYNC))
            }
        }

        fun updateParagraph(context: Context, paragraph: String) {
            context.startService(
                Intent(context, NarrationService::class.java)
                    .setAction(ACTION_PARAGRAPH)
                    .putExtra(EXTRA_PARAGRAPH, paragraph),
            )
        }

        private fun startForeground(context: Context, intent: Intent) {
            ContextCompat.startForegroundService(context, intent)
        }
    }
}

private data class NarrationChunk(
    val id: String,
    val text: String,
    val offset: Int,
    val pauseMillis: Long,
    val generation: Int,
    val isFinal: Boolean,
)

private data class IncomingNarrationChunk(
    val text: String,
    val pauseMillis: Long,
    val start: Int,
)

private data class SpeechMarker(val start: Int, val end: Int, val frame: Int)
