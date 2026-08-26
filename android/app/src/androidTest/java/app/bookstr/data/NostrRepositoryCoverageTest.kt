package app.bookstr.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.nostr.NostrAuthMode
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class NostrRepositoryCoverageTest {
    private lateinit var context: Context
    private lateinit var settings: SettingsRepository
    private lateinit var repository: NostrRepository
    private lateinit var vocabularyRepository: VocabularyRepository
    private lateinit var progressDao: InMemoryProgressDao
    private lateinit var vocabularyDao: InMemoryVocabularyWordDao

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearStoredSettings(context)
        progressDao = InMemoryProgressDao()
        vocabularyDao = InMemoryVocabularyWordDao()
        vocabularyRepository = VocabularyRepository(vocabularyDao)
        settings = SettingsRepository(context).apply {
            authMode = NostrAuthMode.None
            relays = emptyList()
        }
        repository = NostrRepository(context, settings, progressDao, vocabularyRepository)
    }

    @After
    fun tearDown() {
        clearStoredSettings(context)
        progressDao.clear()
        vocabularyDao.clear()
    }

    @Test
    fun publishProgressReturnsFalseForMissingSigner() = runBlocking {
        assertFalse(repository.publishProgress("book-id", 0.5, "cfi"))
    }

    @Test
    fun publishProgressReturnsFalseWhenRelaysAreEmpty() = runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(32)
        assertFalse(repository.publishProgress("book-id", 0.5, "cfi"))
    }

    @Test
    fun publishProgressReturnsFalseForAmberModeWithoutSignerPackage() = runBlocking {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aa"
        settings.signerPackage = null
        settings.relays = listOf("wss://relay.example")

        assertFalse(repository.publishProgress("book-id", 0.5, "cfi"))
    }

    @Test
    fun publishVocabularyWordReturnsFalseForNonAmberMode() = runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(32)
        val word = sampleWord()

        val published = repository.publishVocabularyWord(word)
        assertFalse(published)
    }

    @Test
    fun publishVocabularyWordReturnsFalseForAmberModeWithoutSignerPackage() = runBlocking {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = "0011223344556677889900112233445566778899001122334455667788990011aa"
        settings.signerPackage = null
        settings.relays = listOf("wss://relay.example")

        assertFalse(repository.publishVocabularyWord(sampleWord()))
    }

    @Test
    fun pullVocabularyReturnsZeroForMissingSignerOrNonAmberMode() = runBlocking {
        settings.authMode = NostrAuthMode.None
        settings.relays = listOf("wss://relay.example")
        assertEquals(0, repository.pullVocabulary())
    }

    @Test
    fun pullVocabularyReturnsZeroForAmberModeWithNoRelays() = runBlocking {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = "0011223344556677889900112233445566778899001122334455667788990011aa"
        settings.signerPackage = "com.example.amber"
        settings.relays = emptyList()

        assertEquals(0, repository.pullVocabulary())
    }

    @Test
    fun pullProgressReturnsNullForMissingSignerOrRelays() = runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(32)
        settings.relays = emptyList()

        assertNull(repository.pullProgress("book-id"))
    }

    @Test
    fun parseVocabularyDefaultsMissingOptionalFieldsToSafeValues() {
        val raw = JSONObject(
            """
            {
              "word": "Alpha",
              "language": "EN",
              "syncId": "sync-id",
              "bookId": "book-id",
              "bookTitle": "Book Title"
            }
            """.trimIndent(),
        )

        val parsed = invokeParseVocabulary(raw)

        assertEquals("alpha", parsed.word)
        assertEquals("en", parsed.language)
        assertEquals("en:alpha", parsed.key)
        assertEquals("sync-id", parsed.syncId)
        assertEquals("[]", parsed.definitionsJson)
        assertEquals(1, parsed.lookupCount)
        assertEquals(0L, parsed.firstSeenAt)
        assertEquals(0L, parsed.lastSeenAt)
        assertEquals(false, parsed.deleted)
    }

    @Test
    fun vocabularyJsonRoundTripsWithRoundtripNormalization() {
        val word = sampleWord()
        val serialized = invokeVocabularyJson(word)
        val reparsed = invokeParseVocabulary(serialized)

        assertEquals("alpha", reparsed.word)
        assertEquals("en", reparsed.language)
        assertEquals("en:alpha", reparsed.key)
        assertEquals(word.lookupCount, reparsed.lookupCount)
        assertEquals(word.deleted, reparsed.deleted)
        assertEquals(word.firstSeenAt, reparsed.firstSeenAt)
        assertEquals(word.lastSeenAt, reparsed.lastSeenAt)
    }

    @Test
    fun syncAllFromRelaysHandlesNoSignerWithoutProgressChanges() = runBlocking {
        val existing = BookProgress(
            bookId = "book-id",
            progression = 0.1,
            cfi = "cfi",
            updatedAt = 1_700_000_000L,
        )
        progressDao.upsert(existing)

        repository.syncAllFromRelays()

        val loaded = progressDao.get(existing.bookId)
        assertEquals(existing.bookId, loaded?.bookId)
        assertEquals(existing.progression, loaded?.progression, 0.0)
    }

    private fun invokeParseVocabulary(json: JSONObject): VocabularyWord {
        val method = NostrRepository::class.java.getDeclaredMethod("parseVocabulary", JSONObject::class.java)
        method.isAccessible = true
        return method.invoke(repository, json) as VocabularyWord
    }

    private fun invokeVocabularyJson(word: VocabularyWord): JSONObject {
        val method = NostrRepository::class.java.getDeclaredMethod("vocabularyJson", VocabularyWord::class.java)
        method.isAccessible = true
        return method.invoke(repository, word) as JSONObject
    }

    private fun sampleWord() = VocabularyWord(
        key = "en:alpha",
        word = "alpha",
        language = "en",
        syncId = "sync-alpha",
        bookId = "book-id",
        bookTitle = "Book",
        cfi = "",
        contextSentence = "A sentence",
        partOfSpeech = "",
        definitionsJson = "[]",
        sourceUrl = "",
        lookupCount = 1,
        firstSeenAt = 1_700_000_000_000L,
        lastSeenAt = 1_700_000_000_001L,
        deleted = false,
    )

    private class InMemoryProgressDao : BookProgressDao {
        private val rows = linkedMapOf<String, BookProgress>()

        fun clear() = rows.clear()

        override suspend fun get(bookId: String): BookProgress? = rows[bookId]

        override suspend fun getAll(): List<BookProgress> = rows.values.toList()

        override suspend fun upsert(progress: BookProgress) {
            rows[progress.bookId] = progress
        }
    }

    private class InMemoryVocabularyWordDao : VocabularyWordDao {
        private val rows = linkedMapOf<String, VocabularyWord>()

        fun clear() = rows.clear()

        override suspend fun getAll(): List<VocabularyWord> = rows.values.filterNot { it.deleted }

        override suspend fun getAllIncludingDeleted(): List<VocabularyWord> = rows.values.toList()

        override suspend fun get(key: String): VocabularyWord? = rows[key]

        override suspend fun getByWord(language: String, word: String): VocabularyWord? =
            rows["${language.lowercase()}:${word.lowercase()}"]

        override suspend fun upsert(word: VocabularyWord) {
            rows[word.key] = word
        }
    }
}

private fun clearStoredSettings(context: Context) {
    context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).edit().clear().apply()
    context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE).edit().clear().apply()
}
