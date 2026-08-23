package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ReaderTextToSpeechTest {
    @Test
    fun shortTextStaysInOneUtterance() {
        assertEquals(listOf("A short sentence."), ReaderActivity.speechChunks("A short sentence."))
    }

    @Test
    fun longTextIsSplitWithoutLosingWords() {
        val text = List(400) { "Sentence $it has enough words to exercise chunking." }.joinToString(" ")
        val chunks = ReaderActivity.speechChunks(text)

        assertTrue(chunks.size > 1)
        assertEquals(text, chunks.joinToString(" "))
        assertTrue(chunks.none(String::isBlank))
        assertTrue(chunks.all { it.length <= 160 })
    }

    @Test
    fun genericPortugueseDefaultsToEuropeanWhileRegionalTagsArePreserved() {
        assertEquals("pt-PT", ReaderActivity.preferredSpeechLocale("pt").toLanguageTag())
        assertEquals("pt-BR", ReaderActivity.preferredSpeechLocale("pt-BR").toLanguageTag())
        assertEquals("pt-PT", ReaderActivity.preferredSpeechLocale("pt-PT").toLanguageTag())
    }

    @Test
    fun voiceSelectionFallsBackToAnyOfflineVoiceInTheRequestedLanguage() {
        val source = File("src/main/java/app/bookstr/NarrationService.kt").readText()

        assertTrue(source.contains("val sameLanguageOfflineVoices"))
        assertTrue(source.contains("val exactRegionOfflineVoices"))
        assertTrue(source.contains("exactRegionOfflineVoices.ifEmpty { sameLanguageOfflineVoices }"))
    }

    @Test
    fun activeNarrationUsesVolumeKeysAndNaturalVoiceConfiguration() {
        val readerSource = File("src/main/java/app/bookstr/ReaderActivity.kt").readText()
        val serviceSource = File("src/main/java/app/bookstr/NarrationService.kt").readText()

        assertTrue(readerSource.contains("if (isSpeaking && (keyCode == KeyEvent.KEYCODE_VOLUME_UP"))
        assertTrue(readerSource.contains("showSpeechProgress("))
        assertTrue(serviceSource.contains("engine.setSpeechRate(1.0f)"))
        assertTrue(serviceSource.contains("engine.voices"))
        assertTrue(serviceSource.contains("it.quality"))
        assertTrue(serviceSource.contains("synthesizeToFile"))
        assertTrue(serviceSource.contains("MediaPlayer()"))
        assertTrue(serviceSource.contains("player.currentPosition"))
        assertTrue(serviceSource.contains("SENTENCE_PAUSE_MILLIS = 240L"))
        assertTrue(serviceSource.contains("matchingOfflineVoices"))
        assertTrue(serviceSource.contains("val resolvedVoice = currentMatchingVoice"))
    }
}
