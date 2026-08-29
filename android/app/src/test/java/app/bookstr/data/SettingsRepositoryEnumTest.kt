package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsRepositoryEnumTest {
    @Test
    fun readerThemeDefaultsToPaperForUnknownKey() {
        assertEquals(ReaderTheme.Paper, ReaderTheme.fromKey("not-a-theme"))
        assertEquals(ReaderTheme.Paper, ReaderTheme.fromKey(null))
    }

    @Test
    fun readerThemeParsesKnownKeys() {
        assertEquals(ReaderTheme.White, ReaderTheme.fromKey("white"))
        assertEquals(ReaderTheme.Night, ReaderTheme.fromKey("night"))
        assertEquals(ReaderTheme.Paper, ReaderTheme.fromKey("paper"))
    }

    @Test
    fun readerFontAndAlignmentDefaultToArialAndJustified() {
        assertEquals(ReaderFont.Arial, ReaderFont.fromKey(null))
        assertEquals(ReaderFont.Arial, ReaderFont.fromKey("nope"))
        assertEquals(ReaderFont.Georgia, ReaderFont.fromKey("georgia"))
        assertEquals(ReaderAlignment.Justified, ReaderAlignment.fromKey(null))
        assertEquals(ReaderAlignment.Left, ReaderAlignment.fromKey("left"))
    }

    @Test
    fun nostrAuthModeDefaultsToNoneForUnknownKey() {
        assertEquals(NostrAuthMode.None, NostrAuthMode.fromKey("not-a-mode"))
        assertEquals(NostrAuthMode.None, NostrAuthMode.fromKey(null))
    }

    @Test
    fun nostrAuthModeParsesKnownKeys() {
        assertEquals(NostrAuthMode.None, NostrAuthMode.fromKey("none"))
        assertEquals(NostrAuthMode.Nsec, NostrAuthMode.fromKey("nsec"))
        assertEquals(NostrAuthMode.Amber, NostrAuthMode.fromKey("amber"))
    }

    @Test
    fun nostrAuthModeDefaultsToNoneForWhitespaceAndCapitalizedKey() {
        assertEquals(NostrAuthMode.None, NostrAuthMode.fromKey("   "))
        assertEquals(NostrAuthMode.None, NostrAuthMode.fromKey("NSEC"))
    }
}
