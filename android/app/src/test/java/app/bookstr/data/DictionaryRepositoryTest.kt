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
}
