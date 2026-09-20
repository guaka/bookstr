package app.bookstr.data

import java.util.Locale

/** Result-derived facets; blank selections include missing metadata. */
data class BookListFilters(val language: String = "", val format: String = "") {
    fun matches(language: String?, format: String?): Boolean =
        (this.language.isEmpty() || this.language == normalizedLanguage(language)) &&
            (this.format.isEmpty() || this.format == normalizedFormat(format))

    fun sanitize(languages: List<String>, formats: List<String>) = BookListFilters(
        language.takeIf { it in languages }.orEmpty(),
        format.takeIf { it in formats }.orEmpty(),
    )

    companion object {
        private val languageAliases by lazy {
            buildMap {
                Locale.getISOLanguages().forEach { code ->
                    val locale = Locale.forLanguageTag(code)
                    put(locale.getDisplayLanguage(Locale.ENGLISH).lowercase(Locale.ROOT), code)
                    put(locale.isO3Language, code)
                }
            }
        }
        fun normalizedLanguage(value: String?): String {
            val raw = value.orEmpty().trim().lowercase(Locale.ROOT)
            return languageAliases[raw] ?: raw.substringBefore('-').substringBefore('_')
        }
        fun normalizedFormat(value: String?): String = value.orEmpty().trim()
            .lowercase(Locale.ROOT).removePrefix(".").let { if (it == "fb2.zip") "fb2" else it }
        fun languages(values: List<String?>) = values.map(::normalizedLanguage).filter(String::isNotEmpty).distinct().sorted()
        fun formats(values: List<String?>) = values.map(::normalizedFormat).filter(String::isNotEmpty).distinct().sorted()
    }
}

/** Hide catalog placeholders while preserving real names containing these words. */
fun displayBookAuthor(value: String?): String? = value?.trim()?.takeUnless {
    it.isEmpty() || it.lowercase(Locale.ROOT) in setOf("unknown", "unknown author", "author unknown")
}
