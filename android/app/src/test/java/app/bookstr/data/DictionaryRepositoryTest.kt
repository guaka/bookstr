package app.bookstr.data

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlin.test.assertFailsWith

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

    @Test
    fun parseExtractReturnsNothingWhenLanguageSectionIsMissing() {
        val parsed = DictionaryRepository().parseExtract(
            """
              = Français =
              == Nom ==
              bonjour
              == Verbe ==
              aller
            """.trimIndent(),
            "en",
            "bonjour",
        )

        assertEquals("" to emptyList<String>(), parsed)
    }

    @Test
    fun parseExtractStopsCollectingAtSiblingsOrLanguageBoundary() {
        val parsed = DictionaryRepository().parseExtract(
            """
              = English =
              == Verb ==
              first
              second
              == Etymology ==
              this is not included
              == Noun ==
              noun entry
            """.trimIndent(),
            "en",
            "test",
        )

        assertEquals("Verb", parsed.first)
        assertEquals(listOf("first", "second"), parsed.second)
    }

    @Test
    fun parseExtractIgnoresShortOrRepeatedLinesWhenCollectingDefinitions() {
        val parsed = DictionaryRepository().parseExtract(
            """
              = English =
              == Noun ==
              a
              run
              run
              quick
            """.trimIndent(),
            "en",
            "run",
        )

        assertEquals("Noun", parsed.first)
        assertEquals(listOf("quick"), parsed.second)
    }

    @Test
    fun languageForFallsBackToEnglishForUnknownSignals() {
        val repository = DictionaryRepository()

        assertEquals("en", repository.languageFor("This text has an unfamiliar mix without portuguese keywords."))
        assertEquals("en", repository.languageFor("Un texto corto y corto."))
    }

    @Test
    fun hasInstalledPackForUsesLanguagePrefixWhenSourceIncludesScriptTag() {
        val repository = DictionaryRepository()
        val packsDir = File(System.getProperty("java.io.tmpdir") ?: ".", "wikdict")
        val target = File(packsDir, "en-fr.sqlite3")
        val original = if (target.exists()) target.readBytes() else null
        try {
            packsDir.mkdirs()
            target.writeBytes("unit".toByteArray())

            assertEquals(true, repository.hasInstalledPackFor("en-US"))
            assertEquals(false, repository.hasInstalledPackFor("de-DE"))
        } finally {
            if (original != null) target.writeBytes(original) else target.delete()
        }
    }

    @Test
    fun packsReflectInstalledStateAndSizeForKnownPack() {
        val repository = DictionaryRepository()
        val packsDir = File(System.getProperty("java.io.tmpdir") ?: ".", "wikdict")
        val target = File(packsDir, "pt-en.sqlite3")
        val original = if (target.exists()) target.readBytes() else null
        try {
            packsDir.mkdirs()
            target.writeText("content")

            val pack = repository.packs().first { it.id == "pt-en" }
            assertTrue(pack.installed)
            assertEquals("pt-en", pack.id)
            assertEquals(7L, pack.bytes)
        } finally {
            if (original != null) target.writeBytes(original) else target.delete()
        }
    }

    @Test
    fun removePackDeletesExistingFileAndReturnsFalseOtherwise() {
        val repository = DictionaryRepository()
        val packsDir = File(System.getProperty("java.io.tmpdir") ?: ".", "wikdict")
        val target = File(packsDir, "es-de.sqlite3")
        packsDir.mkdirs()
        val original = if (target.exists()) target.readBytes() else null
        try {
            target.writeText("cached")
            assertTrue(repository.removePack("es-de"))
            assertFalse(target.exists())
            assertFalse(repository.removePack("es-de"))
        } finally {
            if (original != null) target.writeBytes(original)
        }
    }

    @Test
    fun installPackRejectsUnknownPackIdWithoutNetworkAccess() = runBlocking {
        val repository = DictionaryRepository()
        val error = assertFailsWith<IllegalStateException> {
            repository.installPack("not-a-real-pack")
        }
        assertNotNull(error.message)
    }
}
