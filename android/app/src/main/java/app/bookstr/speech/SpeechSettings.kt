package app.bookstr.speech

import android.content.SharedPreferences
import java.util.Locale

/** Per-language choices shared by Settings and every narration entry point. */
class SpeechSettings(private val preferences: SharedPreferences) {
    fun rate(language: String): Float = preferences.getFloat(rateKey(language), DEFAULT_RATE).coerceIn(MINIMUM_RATE, MAXIMUM_RATE)
    fun setRate(language: String, rate: Float) {
        preferences.edit().putFloat(rateKey(language), rate.coerceIn(MINIMUM_RATE, MAXIMUM_RATE)).apply()
    }

    fun voice(language: String): String = preferences.getString("speech_voice_${SpeechLanguages.tag(language)}", "").orEmpty()
    fun setVoice(language: String, voice: String) {
        preferences.edit().putString("speech_voice_${SpeechLanguages.tag(language)}", voice).apply()
    }

    private fun rateKey(language: String) = "speech_rate_${SpeechLanguages.tag(language)}"

    companion object {
        const val DEFAULT_RATE = 0.48f
        const val MINIMUM_RATE = 0.35f
        const val MAXIMUM_RATE = 0.60f
    }
}

object SpeechLanguages {
    val seeded = listOf("en", "pt-pt", "fr", "de", "es", "ca", "nl")
    private val aliases = mapOf(
        "eng" to "en", "english" to "en", "por" to "pt", "portuguese" to "pt",
        "fra" to "fr", "fre" to "fr", "french" to "fr", "deu" to "de", "ger" to "de", "german" to "de",
        "spa" to "es", "spanish" to "es", "cat" to "ca", "catalan" to "ca",
        "nld" to "nl", "dut" to "nl", "dutch" to "nl", "nederlands" to "nl",
    )
    fun tag(raw: String): String {
        val normalized = raw.trim().lowercase(Locale.ROOT).replace('_', '-').ifBlank { "en" }
        val base = aliases[normalized.substringBefore('-')] ?: normalized.substringBefore('-')
        return if (base == "pt") {
            if (normalized.endsWith("-br")) "pt-br" else "pt-pt"
        } else base
    }
    fun name(language: String): String = Locale.forLanguageTag(tag(language)).getDisplayLanguage(Locale.getDefault())
    fun available(codes: List<String>): List<String> = (seeded + codes.filter(String::isNotBlank)).map(::tag).distinct().sortedBy(::name)
}
