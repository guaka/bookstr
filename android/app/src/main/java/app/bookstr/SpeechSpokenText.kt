package app.bookstr

import com.ibm.icu.text.BreakIterator
import com.ibm.icu.text.RuleBasedNumberFormat
import app.bookstr.speech.SpeechLanguages
import java.util.Locale

internal object SpeechSpokenText {
    private val grouped = Regex("""\d{1,3}(?:,\d{3})+(?:\.\d+)?""")
    private val spaced = Regex("""\d{1,3}(?:[\u00A0\u202F ]\d{3})+(?:[.,]\d+)?""")
    private val groupingSpace = Regex("""[\u00A0\u202F ]""")

    private val footnoteBrackets = Regex("""\[\d{1,3}\]""")
    private val superscripts = Regex("""[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+""")
    private val attachedParens = Regex("""(?<=\S)\(\d{1,3}\)""")
    private val europeanGrouped = Regex("""(?<![\p{L}\p{N}])\d{1,3}(?:\.\d{3})+(?:,\d+)?(?![\p{L}\p{N}])""")

    fun normalize(text: String): String = normalize(text, null)

    fun normalize(text: String, languageTag: String?): String {
        val locale = languageTag?.let { Locale.forLanguageTag(SpeechLanguages.tag(it)) }
        val withoutCommas = if (locale == null || locale.language == "en") {
            text.replace(grouped) { match -> match.value.replace(",", "") }
        } else text
        val withoutSpaces = withoutCommas.replace(spaced) { match -> groupingSpace.replace(match.value, "") }
        val cleaned = withoutSpaces
            .replace(footnoteBrackets, "")
            .replace(superscripts, "")
            .replace(attachedParens, "")
            .replace(Regex(""" {2,}"""), " ")
            .replace(" ,", ",")
            .replace(" .", ".")
            .trim()
        if (cleaned.isEmpty()) return cleaned
        if (locale == null) return cleaned

        val prepared = if (locale.language == "en") expandEnglishAbbreviations(cleaned) else cleaned
        val spellout = RuleBasedNumberFormat(locale, RuleBasedNumberFormat.SPELLOUT)
        val sentences = BreakIterator.getSentenceInstance(locale)
        sentences.setText(prepared)
        val output = StringBuilder(prepared.length)
        var start = sentences.first()
        var end = sentences.next()
        while (end != BreakIterator.DONE) {
            output.append(spellNumbers(prepared.substring(start, end), spellout, locale))
            start = end
            end = sentences.next()
        }
        if (start < prepared.length) output.append(spellNumbers(prepared.substring(start), spellout, locale))
        return output.toString()
    }

    private fun expandEnglishAbbreviations(text: String): String {
        val abbreviations = listOf(
            Regex("(?i)\\bMrs\\.") to "missus",
            Regex("(?i)\\bMr\\.") to "mister",
            Regex("(?i)\\bDr\\.") to "doctor",
            Regex("(?i)\\be\\.g\\.") to "for example",
            Regex("(?i)\\bU\\.S\\.") to "United States",
        )
        return abbreviations.fold(text) { value, (pattern, expansion) ->
            pattern.replace(value, expansion)
        }
    }

    private val number = Regex("""(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])""")

    private fun spellNumbers(sentence: String, formatter: RuleBasedNumberFormat, locale: Locale): String {
        var result = if (locale.language == "nl" || locale.language == "pt") {
            europeanGrouped.replace(sentence) { match ->
                val value = match.value.replace(".", "").replace(',', '.').toDoubleOrNull()
                if (value == null) match.value else runCatching { formatter.format(value) }.getOrDefault(match.value)
            }
        } else sentence
        result = number.replace(result) { match ->
            val value = match.value.replace(',', '.').toDoubleOrNull()
            if (value == null) match.value else runCatching { formatter.format(value) }.getOrDefault(match.value)
        }
        return result
    }
}
