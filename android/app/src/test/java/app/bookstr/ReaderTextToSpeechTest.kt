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
        assertTrue(chunks.all { it.length <= 240 })
    }

    @Test
    fun abbreviationPeriodDoesNotBecomeASpeechChunkBoundary() {
        val text = "word ".repeat(20) + "Dr. Smith continued with " + "more words ".repeat(20)
        val chunks = ReaderActivity.speechChunks(text, "en-US")

        assertTrue(chunks.size > 1)
        assertEquals(text.trim(), chunks.joinToString(" "))
        assertTrue(chunks.none { it.endsWith("Dr.") })
    }

    @Test
    fun genericPortugueseDefaultsToEuropeanWhileRegionalTagsArePreserved() {
        assertEquals("pt-PT", ReaderActivity.preferredSpeechLocale("pt").toLanguageTag())
        assertEquals("pt-BR", ReaderActivity.preferredSpeechLocale("pt-BR").toLanguageTag())
        assertEquals("pt-PT", ReaderActivity.preferredSpeechLocale("pt-PT").toLanguageTag())
        assertEquals("nl", ReaderActivity.preferredSpeechLocale("Dutch").toLanguageTag())
        assertEquals("nl", ReaderActivity.preferredSpeechLocale("nld").toLanguageTag())
        assertEquals("nl-NL", ReaderActivity.preferredSpeechLocale("nl_NL").toLanguageTag())
    }

    @Test
    fun voiceSelectionPrefersQualityThenRequestedRegionWithinTheLanguage() {
        val source = File("src/main/java/app/bookstr/NarrationService.kt").readText()

        assertTrue(source.contains("SpeechVoiceSelection.resolve("))
        assertTrue(source.contains("SpeechVoiceDecision.UseVoice"))
        assertTrue(source.contains("SpeechVoiceDecision.UseLocale"))
        assertTrue(source.contains("SpeechVoiceDecision.KeepEngineDefault"))
        assertTrue(source.contains("engine.isLanguageAvailable(requestedLocale)"))
        assertTrue(source.contains("Using engine language settings for"))
    }

    @Test
    fun activeNarrationUsesVolumeKeysAndNaturalVoiceConfiguration() {
        val readerSource = File("src/main/java/app/bookstr/ReaderActivity.kt").readText()
        val serviceSource = File("src/main/java/app/bookstr/NarrationService.kt").readText()

        assertTrue(readerSource.contains("if (isSpeaking && (keyCode == KeyEvent.KEYCODE_VOLUME_UP"))
        assertTrue(readerSource.contains("showSpeechProgress("))
        assertTrue(readerSource.contains("EXTRA_REQUEST_CONTINUE"))
        assertTrue(readerSource.contains("continueSpeechAfterSection"))
        assertTrue(readerSource.contains("optBoolean(\"exhausted\""))
        assertTrue(serviceSource.contains("engine?.setSpeechRate(speechSpeedMultiplier())"))
        assertTrue(serviceSource.contains("engine.voices"))
        assertTrue(serviceSource.contains("SpeechVoiceSelection.resolve("))
        assertTrue(serviceSource.contains("synthesizeToFile"))
        assertTrue(serviceSource.contains("MediaPlayer()"))
        assertTrue(serviceSource.contains("player.currentPosition"))
        assertTrue(serviceSource.contains("SENTENCE_PAUSE_MILLIS = 100L"))
        assertTrue(serviceSource.contains("KeepEngineDefault"))
    }

    @Test
    fun blankSpeechTextProducesNoUtterances() {
        assertTrue(ReaderActivity.speechChunks(" \n\n  ").isEmpty())
    }

    @Test
    fun paragraphBoundariesProduceSeparateUtterances() {
        assertEquals(
            listOf("First paragraph.", "Second paragraph."),
            ReaderActivity.speechChunks("First paragraph.\n\nSecond paragraph."),
        )
    }

    @Test
    fun shortFinalWordStaysWithSentenceWhenWithinHardLimit() {
        val text = List(28) { "word$it" }.joinToString(" ") + "."

        assertEquals(186, text.length)
        assertEquals(listOf(text), ReaderActivity.speechChunks(text))
    }

    @Test
    fun unbrokenTextUsesSafeHardLimitsWithoutLoss() {
        val text = "x".repeat(401)
        val chunks = ReaderActivity.speechChunks(text)

        assertEquals(text, chunks.joinToString(""))
        assertTrue(chunks.all { it.length <= 240 })
    }

    @Test
    fun emptyLanguageDefaultsToEnglish() {
        assertEquals("en", ReaderActivity.preferredSpeechLocale("  ").toLanguageTag())
        assertEquals("fr-FR", ReaderActivity.preferredSpeechLocale(" FR-fr ").toLanguageTag())
    }

    @Test
    fun spokenTextUsesLocaleSpelloutAndRetainsEnglishAbbreviations() {
        val source = "Dr. Smith saw Mr. Jones and Mrs. Brown on 9/10/2024. e.g. U.S. history changed in 2024!"
        for (locale in listOf("en", "nl", "pt-PT", "pt-BR")) {
            val numericText = if (locale == "en") "There were 1,234.5 coins." else "There were 1.234,5 coins."
            val spoken = SpeechSpokenText.normalize("$source $numericText", locale)
            if (locale == "en") {
                assertTrue(spoken.contains("doctor"))
                assertTrue(spoken.contains("mister"))
                assertTrue(spoken.contains("missus"))
                assertTrue(spoken.contains("for example"))
                assertTrue(spoken.contains("United States"))
            } else {
                assertTrue("$locale abbreviation", spoken.contains("Dr."))
                assertTrue("$locale abbreviation", spoken.contains("e.g."))
            }
            assertTrue("$locale sentence ending", spoken.contains("!"))
            assertTrue("$locale numbers spelled", !Regex("\\d").containsMatchIn(spoken))
        }
    }
}
