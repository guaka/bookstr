package app.bookstr.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.nostr.NostrAuthMode
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NostrRepositoryCoverageTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val settings = runBlocking {
        clearStoredSettings(context)
        SettingsRepository(context).also {
            it.authMode = NostrAuthMode.None
            it.relays = emptyList()
        }
    }
    private val vocabularyRepository = VocabularyRepository(InMemoryVocabularyWordDao())
    private val progressDao = InMemoryProgressDao()
    private val repository = NostrRepository(context, settings, progressDao, vocabularyRepository)

    @Test
    fun publishProgressReturnsFalseForMissingSigner() = runBlocking {
        assertTrue(!repository.publishProgress("book-id", 0.5, "cfi"))
    }

    @Test
    fun publishProgressReturnsFalseWhenRelaysAreEmpty() = runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(32)
        settings.relays = emptyList()

        assertEquals(false, repository.publishProgress("book-id", 0.5, "cfi"))
    }

    @Test
    fun publishVocabularyWordReturnsFalseForNonAmberMode() = runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(32)

        val word = VocabularyWord(
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

        val published = repository.publishVocabularyWord(word)
        assertEquals(false, published)
    }

    @Test
    fun pullVocabularyReturnsZeroForMissingSignerOrNonAmberMode() = runBlocking {
        settings.authMode = NostrAuthMode.None
        settings.relays = listOf("wss://relay.example")
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
    fun syncAllFromRelaysHandlesNoSignerWithoutProgressChanges() = runBlocking {
        settings.authMode = NostrAuthMode.None
        settings.relays = emptyList()
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

    private class InMemoryProgressDao : BookProgressDao {
        private val rows = mutableMapOf<String, BookProgress>()

        override suspend fun get(bookId: String): BookProgress? = rows[bookId]

        override suspend fun getAll(): List<BookProgress> = rows.values.toList()

        override suspend fun upsert(progress: BookProgress) {
            rows[progress.bookId] = progress
        }
    }

    private class InMemoryVocabularyWordDao : VocabularyWordDao {
        private val rows = mutableMapOf<String, VocabularyWord>()

        override suspend fun getAll(): List<VocabularyWord> = rows.values.filterNot { it.deleted }

        override suspend fun getAllIncludingDeleted(): List<VocabularyWord> = rows.values.toList()

        override suspend fun get(key: String): VocabularyWord? = rows[key]

        override suspend fun getByWord(language: String, word: String): VocabularyWord? =
            rows[("${language.lowercase()}:${word.lowercase()}")]

        override suspend fun upsert(word: VocabularyWord) {
            rows[word.key] = word
        }
    }
}

private fun clearStoredSettings(context: android.content.Context) {
    context.getSharedPreferences("bookstr_settings", android.content.Context.MODE_PRIVATE).edit().clear().apply()
    context.getSharedPreferences("bookstr_secure", android.content.Context.MODE_PRIVATE).edit().clear().apply()
}
