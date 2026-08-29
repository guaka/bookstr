package app.bookstr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class SpeechVoiceSelectionTest {
    @Test
    fun languageSettingsOutrankVoiceListWhenTheEngineSupportsTheLocale() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(
                voice("pt-br-low", language = "pt", country = "BR", quality = 300),
                voice("pt-pt-high", language = "pt", country = "PT", quality = 500),
            ),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = "pt-pt-high",
            languageAvailable = true,
        )

        assertEquals(SpeechVoiceDecision.UseLocale("pt-PT"), decision)
    }

    @Test
    fun optionalVoiceFallbackPrefersQualityThenRequestedRegionThenCurrentVoice() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(
                voice("pt-br-low", language = "pt", country = "BR", quality = 300),
                voice("pt-pt-high", language = "pt", country = "PT", quality = 400),
                voice("pt-pt-current", language = "pt", country = "PT", quality = 400),
            ),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = "pt-pt-current",
            languageAvailable = false,
        )

        assertEquals(SpeechVoiceDecision.UseVoice("pt-pt-current"), decision)
    }

    @Test
    fun matchesIso6392EngineLocalesWithIso6391BookMetadata() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(voice("kokoro-eng", language = "eng", country = "USA", quality = 400)),
            requestedLocale = Locale.forLanguageTag("en"),
            currentVoiceName = null,
            languageAvailable = false,
        )

        assertEquals(SpeechVoiceDecision.UseVoice("kokoro-eng"), decision)
    }

    @Test
    fun picksKokoroPortugueseSpeakerWhenLocalesAreEnglish() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(
                voice("af_heart", language = "eng", country = "", quality = 500),
                voice("pf_dora", language = "eng", country = "", quality = 400),
                voice("zf_xiaoxiao", language = "eng", country = "", quality = 500),
            ),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = "af_heart",
            languageAvailable = false,
        )

        assertEquals(SpeechVoiceDecision.UseVoice("pf_dora"), decision)
    }

    @Test
    fun keepsMultilingualEngineDefaultWhenLocaleCannotBeLoaded() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(voice("af_heart", language = "eng", country = "", quality = 400)),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = "af_heart",
            languageAvailable = false,
        )

        assertEquals(SpeechVoiceDecision.KeepEngineDefault, decision)
    }

    @Test
    fun usesRequestedLocaleWhenEngineAcceptsLanguageEvenWithoutAVoiceList() {
        val decision = SpeechVoiceSelection.resolve(
            voices = emptyList(),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = null,
            languageAvailable = true,
        )

        assertEquals(SpeechVoiceDecision.UseLocale("pt-PT"), decision)
    }

    @Test
    fun ignoresNetworkVoicesAndBlankLanguageTags() {
        val decision = SpeechVoiceSelection.resolve(
            voices = listOf(
                voice("cloud-pt", language = "pt", country = "PT", quality = 500, networkRequired = true),
                voice("unnamed", language = "  ", country = "", quality = 400),
            ),
            requestedLocale = Locale.forLanguageTag("pt-PT"),
            currentVoiceName = null,
            languageAvailable = false,
        )

        assertEquals(SpeechVoiceDecision.KeepEngineDefault, decision)
    }

    @Test
    fun kokoroNamePrefixesMapToLocalesAndRejectUnknownSpeakers() {
        assertEquals("en", SpeechVoiceSelection.languageFromKokoroName("af_heart"))
        assertEquals("en", SpeechVoiceSelection.languageFromKokoroName(" bm_george "))
        assertEquals("es", SpeechVoiceSelection.languageFromKokoroName("ef_dora"))
        assertEquals("fr", SpeechVoiceSelection.languageFromKokoroName("ff_siwis"))
        assertEquals("hi", SpeechVoiceSelection.languageFromKokoroName("hf_alpha"))
        assertEquals("it", SpeechVoiceSelection.languageFromKokoroName("if_sara"))
        assertEquals("ja", SpeechVoiceSelection.languageFromKokoroName("jf_alpha"))
        assertEquals("pt", SpeechVoiceSelection.languageFromKokoroName("pm_alex"))
        assertEquals("zh", SpeechVoiceSelection.languageFromKokoroName("zm_yunxi"))
        assertNull(SpeechVoiceSelection.languageFromKokoroName("Google"))
        assertNull(SpeechVoiceSelection.languageFromKokoroName("xf_unknown"))
        assertNull(SpeechVoiceSelection.languageFromKokoroName("a_missing_gender"))
    }

    @Test
    fun sameLanguageComparesIsoCodesAndKokoroNames() {
        val portuguese = Locale.forLanguageTag("pt-PT")
        assertTrue(
            SpeechVoiceSelection.sameLanguage(
                voice("pf_dora", language = "eng"),
                portuguese,
            ),
        )
        assertTrue(
            SpeechVoiceSelection.sameLanguage(
                voice("system-pt", language = "por"),
                portuguese,
            ),
        )
        assertTrue(
            !SpeechVoiceSelection.sameLanguage(
                voice("af_heart", language = "eng"),
                portuguese,
            ),
        )
        assertTrue(
            !SpeechVoiceSelection.sameLanguage(
                voice("pf_dora", language = "eng"),
                Locale("", ""),
            ),
        )
    }

    private fun voice(
        name: String,
        language: String,
        country: String = "",
        quality: Int = 300,
        networkRequired: Boolean = false,
    ) = SpeechVoiceCandidate(
        name = name,
        language = language,
        country = country,
        quality = quality,
        networkRequired = networkRequired,
    )
}
