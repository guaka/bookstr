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
    fun activeNarrationUsesVolumeKeysAndNaturalVoiceConfiguration() {
        val source = File("src/main/java/app/bookstr/ReaderActivity.kt").readText()

        assertTrue(source.contains("if (isSpeaking && (keyCode == KeyEvent.KEYCODE_VOLUME_UP"))
        assertTrue(source.contains("engine.setSpeechRate(0.92f)"))
        assertTrue(source.contains("engine.voices"))
        assertTrue(source.contains("it.quality"))
        assertTrue(source.contains("override fun onRangeStart"))
        assertTrue(source.contains("showSpeechProgress("))
        assertTrue(source.contains("enqueueNextSpeechUtterance"))
        assertTrue(source.contains("playSilentUtterance"))
        assertTrue(source.contains("SENTENCE_PAUSE_MILLIS = 240L"))
        assertTrue(source.contains("matchingOfflineVoices"))
        assertTrue(source.contains("val resolvedVoice = currentMatchingVoice"))
    }
}
