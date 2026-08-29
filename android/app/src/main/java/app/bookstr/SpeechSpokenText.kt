package app.bookstr

internal object SpeechSpokenText {
    private val grouped = Regex("""\d{1,3}(?:,\d{3})+(?:\.\d+)?""")
    private val spaced = Regex("""\d{1,3}(?:[\u00A0\u202F ]\d{3})+(?:[.,]\d+)?""")
    private val groupingSpace = Regex("""[\u00A0\u202F ]""")

    private val footnoteBrackets = Regex("""\[\d{1,3}\]""")
    private val superscripts = Regex("""[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+""")
    private val attachedParens = Regex("""(?<=\S)\(\d{1,3}\)""")

    fun normalize(text: String): String {
        val withoutCommas = grouped.replace(text) { match -> match.value.replace(",", "") }
        val withoutSpaces = spaced.replace(withoutCommas) { match -> groupingSpace.replace(match.value, "") }
        return attachedParens.replace(
            superscripts.replace(footnoteBrackets.replace(withoutSpaces, "")),
            "",
        )
            .replace(Regex(""" {2,}"""), " ")
            .replace(" ,", ",")
            .replace(" .", ".")
            .trim()
    }
}
