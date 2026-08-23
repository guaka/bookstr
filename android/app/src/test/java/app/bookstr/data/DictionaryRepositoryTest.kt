package app.bookstr.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DictionaryRepositoryTest {
    @Test
    fun parsesPortuguesePlainTextExtract() {
        val extract = """
            = Português =

            == Preposição ==
            pa.ra

            exprime fim, destino, lugar, tempo, direção etc

            === Etimologia ===
            Do latim per ad.

            = Asturiano =
        """.trimIndent()

        assertEquals(
            "Preposição" to listOf("exprime fim, destino, lugar, tempo, direção etc"),
            DictionaryRepository().parseExtract(extract, "pt", "para"),
        )
    }

    @Test
    fun exposesWikDictLanguagePairsBeyondEnglishAndPortuguese() {
        val packs = DictionaryRepository().packs()
        assertTrue(packs.any { it.id == "en-pt" && it.label == "English → Portuguese" })
        assertTrue(packs.any { it.id == "ja-de" && it.label == "Japanese → German" })
        assertTrue(packs.any { it.id == "fr-es" && it.label == "French → Spanish" })
        assertTrue(
            packs.any {
                it.id == "kaikki-pt-pt" && it.label == "Portuguese → Portuguese (Kaikki)"
            },
        )
    }

    @Test
    fun detectsPortugueseAndDefaultsOtherContextToEnglish() {
        val repository = DictionaryRepository()

        assertEquals("pt", repository.languageFor("Uma história que não terminou."))
        assertEquals("pt", repository.languageFor("A publicação contém informação."))
        assertEquals("en", repository.languageFor("A story that never ended."))
    }

    @Test
    fun missingRequestedLanguageSectionReturnsNoDefinitions() {
        val parsed = DictionaryRepository().parseExtract(
            """= Español =\n\n== Sustantivo ==\nuna definición""",
            "pt",
            "palavra",
        )

        assertEquals("" to emptyList<String>(), parsed)
    }

    @Test
    fun ignoresPronunciationAndEtymologySections() {
        val parsed = DictionaryRepository().parseExtract(
            """
              = English =
              == Pronunciation ==
              IPA: /test/
              == Etymology 1 ==
              From somewhere.
              == Noun ==
              test
              a procedure used to establish quality
            """.trimIndent(),
            "en",
            "test",
        )

        assertEquals("Noun", parsed.first)
        assertEquals(listOf("a procedure used to establish quality"), parsed.second)
    }

    @Test
    fun limitsAndDeduplicatesExtractDefinitions() {
        val parsed = DictionaryRepository().parseExtract(
            """
              = English =
              == Noun ==
              first definition
              first definition
              second definition
              third definition
              fourth definition
              fifth definition
            """.trimIndent(),
            "en",
            "word",
        )

        assertEquals(4, parsed.second.size)
        assertEquals(4, parsed.second.distinct().size)
        assertTrue("fifth definition" !in parsed.second)
    }

    @Test
    fun packIdsAreUniqueAndNeverTranslateLanguageToItself() {
        val packs = DictionaryRepository().packs()

        assertEquals(packs.size, packs.map { it.id }.distinct().size)
        assertTrue(packs.filter { it.id != "kaikki-pt-pt" }.none { it.sourceLanguage == it.targetLanguage })
    }

    @Test
    fun regionalPortugueseContextSignalsStillResolveToPortuguese() {
        val repository = DictionaryRepository()

        assertEquals("pt", repository.languageFor("Isto é para alguém com atenção."))
        assertEquals("en", repository.languageFor("Portuguese is the language name."))
    }
}
