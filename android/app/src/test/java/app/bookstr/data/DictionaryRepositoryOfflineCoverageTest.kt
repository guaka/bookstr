package app.bookstr.data

import android.app.Application
import android.content.ContextWrapper
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.nio.file.Files

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class DictionaryRepositoryOfflineCoverageTest {
    private val root = Files.createTempDirectory("bookstr-dictionary-test-").toFile()
    private val repository by lazy {
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getFilesDir(): File = root
        }
        DictionaryRepository(context)
    }

    @After
    fun cleanUp() {
        root.deleteRecursively()
    }

    @Test
    fun packsAndInstalledChecksReflectFilesAndNormalizeRegionalLanguage() {
        val file = packFile("en-pt").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }

        assertTrue(repository.hasInstalledPackFor("EN-us"))
        assertTrue(repository.packs().single { it.id == "en-pt" }.installed)
        assertEquals(file.length(), repository.packs().single { it.id == "en-pt" }.bytes)
        assertFalse(repository.hasInstalledPackFor("de-DE"))
        assertFalse(repository.removePack("missing-pack"))
        assertTrue(repository.removePack("en-pt"))
        assertFalse(repository.hasInstalledPackFor("en"))
        assertFalse(repository.removePack("en-pt"))
    }

    @Test
    fun lookupPreferredUsesOfflineSourcePackAndSkipsMalformedPack() = runBlocking<Unit> {
        packFile("en-es").writeText("not a sqlite database")
        createTranslationPack(
            "en-pt",
            """
            INSERT INTO translation_grouped VALUES ('Book', 'livro | volume', 'written work', 5, 1);
            INSERT INTO translation_grouped VALUES ('Book', 'livro | volume', 'written work', 4, 1);
            INSERT INTO translation_grouped VALUES ('book', 'tomo', 'bound pages', 3, 1);
            """.trimIndent(),
        )

        val result = repository.lookupPreferred("book", "EN-us")

        assertEquals("book", result.word)
        assertEquals("en", result.language)
        assertEquals("English → PT", result.partOfSpeech)
        assertEquals(listOf("PT · livro, volume — written work", "PT · tomo — bound pages"), result.definitions)
        assertEquals("https://www.wikdict.com/", result.sourceUrl)
    }

    @Test
    fun preferredLookupFallsBackAcrossLanguagesWithoutMakingNetworkRequests() = runBlocking<Unit> {
        createTranslationPack(
            "pt-en",
            "INSERT INTO translation_grouped VALUES ('casa', 'house', 'a building to live in', 1, 1);",
        )

        val result = repository.lookupPreferred("casa", "fr-CA")

        assertEquals("pt", result.language)
        assertEquals("Portuguese → EN", result.partOfSpeech)
        assertEquals(listOf("EN · house — a building to live in"), result.definitions)
    }

    @Test
    fun unknownPackInstallFailsBeforeAnyNetworkAccess() {
        assertThrows(IllegalStateException::class.java) {
            runBlocking { repository.installPack("not-a-pack") }
        }
    }

    private fun packFile(id: String): File = File(root, "wikdict/$id.sqlite3").apply {
        parentFile?.mkdirs()
    }

    private fun createTranslationPack(id: String, inserts: String) {
        val file = packFile(id)
        SQLiteDatabase.openOrCreateDatabase(file, null).use { database ->
            database.execSQL(
                "CREATE TABLE translation_grouped (written_rep TEXT, trans_list TEXT, sense_list TEXT, score INTEGER, importance INTEGER)",
            )
            inserts.lineSequence().filter(String::isNotBlank).forEach(database::execSQL)
        }
    }
}
