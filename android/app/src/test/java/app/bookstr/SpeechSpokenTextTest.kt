package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechSpokenTextTest {
    @Test
    fun groupedThousandsAreSpokenWithoutCommasOrSpaces() {
        assertEquals("100000", SpeechSpokenText.normalize("100,000"))
        assertEquals("There were 1000000.5 people.", SpeechSpokenText.normalize("There were 1,000,000.5 people."))
        assertEquals("Wait, then go.", SpeechSpokenText.normalize("Wait, then go."))
        assertEquals("100000", SpeechSpokenText.normalize("100\u00A0000"))
        assertEquals("He left at dawn.", SpeechSpokenText.normalize("He left[1] at dawn."))
        assertEquals("He left at dawn.", SpeechSpokenText.normalize("He left\u00B9 at dawn."))
        assertEquals("See chapter 12.", SpeechSpokenText.normalize("See chapter 12."))
        assertEquals("word next", SpeechSpokenText.normalize("word(1) next"))
        assertEquals("(1) First item", SpeechSpokenText.normalize("(1) First item"))
        assertEquals("", SpeechSpokenText.normalize(""))
    }
}
