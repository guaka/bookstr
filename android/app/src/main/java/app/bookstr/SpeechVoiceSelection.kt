package app.bookstr

import java.util.Locale

data class SpeechVoiceCandidate(
    val name: String,
    val language: String,
    val country: String,
    val quality: Int,
    val networkRequired: Boolean,
)

sealed class SpeechVoiceDecision {
    data class UseVoice(val name: String) : SpeechVoiceDecision()
    data class UseLocale(val languageTag: String) : SpeechVoiceDecision()
    data object KeepEngineDefault : SpeechVoiceDecision()
}

/**
 * Chooses a TTS voice without forcing a locale the engine cannot load.
 *
 * Language-specific engine settings come first: `setLanguage` loads the speaker,
 * rate, and other options the user configured for that locale. Voice-list ranking
 * is only an optional fallback when the engine does not advertise the language.
 *
 * Neural engines such as Kokoro/sherpa often advertise a single ISO 639-2 language
 * (`eng`) while still speaking other locales through a per-language speaker.
 * Setting `TextToSpeech.language` to an unsupported tag makes `synthesizeToFile` fail.
 */
object SpeechVoiceSelection {
    fun resolve(
        voices: Collection<SpeechVoiceCandidate>,
        requestedLocale: Locale,
        currentVoiceName: String?,
        languageAvailable: Boolean,
    ): SpeechVoiceDecision {
        if (languageAvailable) return SpeechVoiceDecision.UseLocale(requestedLocale.toLanguageTag())
        val offlineVoices = voices.filter { !it.networkRequired }
        val matching = offlineVoices.filter { sameLanguage(it, requestedLocale) }
        val exactRegion = matching.filter { exactRegion(it, requestedLocale) }
        val resolved = matching.maxWithOrNull(
            compareBy<SpeechVoiceCandidate> { it.quality }
                .thenBy { voice -> exactRegion.any { it.name == voice.name } }
                .thenBy { it.name == currentVoiceName },
        )
        if (resolved != null) return SpeechVoiceDecision.UseVoice(resolved.name)
        return SpeechVoiceDecision.KeepEngineDefault
    }

    internal fun sameLanguage(voice: SpeechVoiceCandidate, requestedLocale: Locale): Boolean {
        val requested = languageCodes(requestedLocale.language)
        if (requested.isEmpty()) return false
        val advertised = languageCodes(voice.language)
        if (advertised.any { it in requested }) return true
        val named = languageFromKokoroName(voice.name) ?: return false
        return named in requested
    }

    internal fun languageFromKokoroName(name: String): String? {
        val match = KOKORO_SPEAKER.matchEntire(name.trim().lowercase(Locale.ROOT)) ?: return null
        return KOKORO_LANGUAGE_PREFIX[match.groupValues[1]]
    }

    private fun exactRegion(voice: SpeechVoiceCandidate, requestedLocale: Locale): Boolean {
        val requestedCountry = requestedLocale.country
        return requestedCountry.isNotBlank() &&
            voice.country.equals(requestedCountry, ignoreCase = true)
    }

    private fun languageCodes(language: String): Set<String> {
        val normalized = language.trim().lowercase(Locale.ROOT)
        if (normalized.isEmpty()) return emptySet()
        val codes = mutableSetOf(normalized)
        ISO3_TO_ISO2[normalized]?.let(codes::add)
        ISO2_TO_ISO3[normalized]?.let(codes::add)
        runCatching {
            Locale(normalized).isO3Language.lowercase(Locale.ROOT)
        }.getOrNull()?.let(codes::add)
        return codes
    }

    private val KOKORO_SPEAKER = Regex("^([a-z])[fm]_.+")
    private val KOKORO_LANGUAGE_PREFIX = mapOf(
        "a" to "en",
        "b" to "en",
        "e" to "es",
        "f" to "fr",
        "h" to "hi",
        "i" to "it",
        "j" to "ja",
        "p" to "pt",
        "z" to "zh",
    )
    private val ISO3_TO_ISO2 = mapOf(
        "eng" to "en",
        "por" to "pt",
        "zho" to "zh",
        "chi" to "zh",
        "cmn" to "zh",
        "fra" to "fr",
        "fre" to "fr",
        "deu" to "de",
        "ger" to "de",
        "spa" to "es",
        "ita" to "it",
        "jpn" to "ja",
        "hin" to "hi",
    )
    private val ISO2_TO_ISO3 = ISO3_TO_ISO2.entries
        .groupBy({ it.value }, { it.key })
        .mapValues { (_, values) -> values.first() }
}
