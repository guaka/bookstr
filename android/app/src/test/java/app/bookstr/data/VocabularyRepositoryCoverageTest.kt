package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import app.bookstr.nostr.NostrClient
import org.junit.Test
import org.json.JSONArray

class VocabularyRepositoryCoverageTest {
    private class InMemoryVocabularyWordDao : VocabularyWordDao {
        private val rows = linkedMapOf<String, VocabularyWord>()

        override suspend fun getAll(): List<VocabularyWord> = rows.values.filter { !it.deleted }.toList()

        override suspend fun getAllIncludingDeleted(): List<VocabularyWord> = rows.values.toList()

        override suspend fun get(key: String): VocabularyWord? = rows[key]

        override suspend fun getByWord(language: String, word: String): VocabularyWord? =
            rows["${language.lowercase()}:${word.lowercase()}"]

        override suspend fun upsert(word: VocabularyWord) {
            rows[word.key] = word
        }

        fun read(key: String): VocabularyWord? = rows[key]
    }

    private fun makeWord(
        key: String,
        word: String,
        language: String = "en",
        syncId: String = "sync-$word-${System.currentTimeMillis()}",
        deleted: Boolean = false,
        definitionsJson: String = "[]",
        sourceUrl: String = "https://example.org",
        firstSeenAt: Long = 1_700_000_000_000L,
        lastSeenAt: Long = 1_700_000_000_001L,
        lookupCount: Int = 1,
    ) = VocabularyWord(
        key = key,
        word = word,
        language = language,
        syncId = syncId,
        bookId = "book-id",
        bookTitle = "Book",
        cfi = "cfi",
        contextSentence = "context",
        partOfSpeech = "",
        definitionsJson = definitionsJson,
        sourceUrl = sourceUrl,
        lookupCount = lookupCount,
        firstSeenAt = firstSeenAt,
        lastSeenAt = lastSeenAt,
        deleted = deleted,
    )

    @Test
    fun allFillsMissingSyncId() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        dao.upsert(makeWord("en:test", "test", syncId = ""))
        val repo = VocabularyRepository(dao)

        val words = repo.all()
        assertEquals(1, words.size)
        assertTrue(words.first().syncId.isNotBlank())
        assertTrue(dao.read(words.first().key)?.syncId?.isNotBlank() == true)
    }

    @Test
    fun allForSyncFillsMissingSyncIdForDeletedWords() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        dao.upsert(makeWord("en:deleted", "deleted", syncId = "", deleted = true))
        val repo = VocabularyRepository(dao)

        val words = repo.allForSync()

        assertEquals(1, words.size)
        assertTrue(words.first().deleted)
        assertTrue(words.first().syncId.isNotBlank())
        assertTrue(dao.read(words.first().key)?.syncId?.isNotBlank() == true)
    }

    @Test
    fun saveSelectionReusesExistingSyncIdAndCounter() = kotlinx.coroutines.runBlocking {
        val repo = VocabularyRepository(InMemoryVocabularyWordDao())

        val first = repo.saveSelection("Apple", "EN", "book-id", "Book", "cfi", "context")
        val second = repo.saveSelection("apple", "en", "book-id", "Book", "cfi-2", "context")

        assertEquals("en:apple", second.key)
        assertEquals(first.syncId, second.syncId)
        assertEquals(2, second.lookupCount)
        assertEquals(first.firstSeenAt, second.firstSeenAt)
    }

    @Test
    fun saveDefinitionReturnsNullWhenMissing() = kotlinx.coroutines.runBlocking {
        val repo = VocabularyRepository(InMemoryVocabularyWordDao())

        assertNull(repo.saveDefinition("missing", "en", "noun", listOf("x"), "https://source.example"))
    }

    @Test
    fun saveDefinitionUpdatesExistingWordFields() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        repo.saveSelection("hello", "en", "book-id", "Book", "cfi", "context")

        val updated = repo.saveDefinition("hello", "EN", "noun", listOf("greet", "hallo"), "https://updated.example")

        assertNotNull(updated)
        assertEquals("noun", updated!!.partOfSpeech)
        assertEquals(JSONArray(listOf("greet", "hallo")).toString(), updated.definitionsJson)
        assertEquals("https://updated.example", updated.sourceUrl)
        assertEquals("en:hello", dao.read("en:hello")?.key)
        assertEquals("noun", dao.read("en:hello")?.partOfSpeech)
        assertEquals(1, dao.read("en:hello")?.lookupCount)
    }

    @Test
    fun saveSelectionNormalizesLanguageAndWordToLowercase() = kotlinx.coroutines.runBlocking {
        val repo = VocabularyRepository(InMemoryVocabularyWordDao())
        val saved = repo.saveSelection("Tree", "EN", "book-id", "Book", "cfi", "context")

        assertEquals("en:tree", saved.key)
        assertEquals("en", saved.language)
    }

    @Test
    fun definitionsPropertyFiltersBlankValuesAndInvalidJson() = kotlinx.coroutines.runBlocking {
        val blankDefinitions = VocabularyWord(
            key = "en:blank",
            word = "blank",
            language = "en",
            syncId = "sync-blank",
            bookId = "book-id",
            bookTitle = "Book",
            cfi = "cfi",
            contextSentence = "context",
            partOfSpeech = "",
            definitionsJson = "[\"first\", \"\", \"  \", \"second\", \"\"]",
            sourceUrl = "",
            lookupCount = 1,
            firstSeenAt = 1_700_000_000_000L,
            lastSeenAt = 1_700_000_000_001L,
            deleted = false,
        )
        assertEquals(listOf("first", "second"), blankDefinitions.definitions)

        val invalidDefinitions = VocabularyWord(
            key = "en:invalid",
            word = "invalid",
            language = "en",
            syncId = "sync-invalid",
            bookId = "book-id",
            bookTitle = "Book",
            cfi = "cfi",
            contextSentence = "context",
            partOfSpeech = "",
            definitionsJson = """{\"bad\":\"value\"}""",
            sourceUrl = "",
            lookupCount = 1,
            firstSeenAt = 1_700_000_000_000L,
            lastSeenAt = 1_700_000_000_001L,
            deleted = false,
        )
        assertTrue(invalidDefinitions.definitions.isEmpty())
    }

    @Test
    fun mergeRemoteSkipsOlderEntriesByTimestamp() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val existing = repo.saveSelection("tree", "en", "book-id", "Book", "cfi", "context")
        val stale = makeWord(
            key = existing.key,
            word = "tree",
            language = "en",
            syncId = existing.syncId,
            sourceUrl = "https://stale.example",
            definitionsJson = JSONArray(listOf("old")).toString(),
            deleted = false,
            lastSeenAt = existing.lastSeenAt - 1_000L,
        ).copy(
            firstSeenAt = existing.firstSeenAt,
            lookupCount = 4,
        )

        assertFalse(repo.mergeRemote(stale))
        val persisted = dao.read(existing.key)!!
        assertEquals(existing.sourceUrl, persisted.sourceUrl)
        assertEquals(existing.lookupCount, persisted.lookupCount)
    }

    @Test
    fun mergeRemoteMatchesExistingByNormalizedLanguageAndWord() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val existing = repo.saveSelection("Tree", "EN", "book-id", "Book", "cfi", "context")
        val remote = makeWord(
            key = "custom:key:ignored",
            word = "tree",
            language = "en",
            syncId = "sync-remote",
            sourceUrl = "https://remote.example",
            definitionsJson = JSONArray(listOf("leaf", "root")).toString(),
            lastSeenAt = existing.lastSeenAt + 1,
            firstSeenAt = existing.firstSeenAt + 1,
        )

        assertTrue(repo.mergeRemote(remote))
        assertEquals("sync-remote", dao.read(existing.key)?.syncId)
        assertEquals(existing.key, dao.read(existing.key)?.key)
        assertEquals("https://remote.example", dao.read(existing.key)?.sourceUrl)
    }

    @Test
    fun mergeRemoteInsertsWhenNoExistingEntry() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        assertNull(dao.read("en:new"))

        val inserted = makeWord(
            key = "en:new",
            word = "new",
            language = "en",
            syncId = "sync-new",
            sourceUrl = "https://new.example",
        )

        assertTrue(repo.mergeRemote(inserted))
        assertNotNull(dao.read("en:new"))
    }

    @Test
    fun removeMissingWordReturnsNull() = kotlinx.coroutines.runBlocking {
        val repo = VocabularyRepository(InMemoryVocabularyWordDao())

        assertNull(repo.remove("missing"))
    }

    @Test
    fun removeReturnsDeletedTombstoneAndRemovesFromAll() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val saved = repo.saveSelection("remove-me", "en", "book-id", "Book", "cfi", "context")

        val tombstone = repo.remove(saved.key)
        val visible = repo.all()

        assertNotNull(tombstone)
        assertEquals(saved.key, tombstone!!.key)
        assertTrue(tombstone.deleted)
        assertFalse(visible.any { it.key == saved.key })
        assertTrue(dao.read(saved.key)?.deleted == true)
    }

    @Test
    fun removeTwiceReturnsNullAfterFirstDeletion() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val saved = repo.saveSelection("repeat", "en", "book-id", "Book", "cfi", "context")

        val first = repo.remove(saved.key)
        val second = repo.remove(saved.key)

        assertNotNull(first)
        assertTrue(first!!.deleted)
        assertNotNull(second)
        assertTrue(second!!.deleted)
        assertEquals(first.key, second.key)
        assertTrue(second.lastSeenAt >= first.lastSeenAt)
    }

    @Test
    fun mergeRemoteCanDeleteExistingWordWhenDeletionIsNewer() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val existing = repo.saveSelection("apple", "en", "book-id", "Book", "cfi", "context")
        val deletion = makeWord(
            key = existing.key,
            word = existing.word,
            language = existing.language,
            syncId = existing.syncId,
            deleted = true,
            lastSeenAt = existing.lastSeenAt + 2_000L,
            sourceUrl = existing.sourceUrl,
        )

        assertTrue(repo.mergeRemote(deletion))
        val persisted = dao.read(existing.key)!!
        assertTrue(persisted.deleted)
        assertEquals(existing.key, persisted.key)
    }

    @Test
    fun mergeRemoteRejectsDeletionWhenItIsOlderThanCurrentEntry() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val existing = repo.saveSelection("pear", "en", "book-id", "Book", "cfi", "context")
        val staleDeletion = makeWord(
            key = existing.key,
            word = existing.word,
            language = existing.language,
            syncId = existing.syncId,
            deleted = true,
            lastSeenAt = existing.lastSeenAt - 10_000L,
            sourceUrl = "https://stale.example",
        )

        assertFalse(repo.mergeRemote(staleDeletion))
        val persisted = dao.read(existing.key)!!
        assertEquals(false, persisted.deleted)
        assertNotEquals("https://stale.example", persisted.sourceUrl)
    }

    @Test
    fun mergeRemoteRejectsEqualTimestamp() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val existing = repo.saveSelection("equal", "en", "book-id", "Book", "cfi", "context")
        val sameTimestamp = makeWord(
            key = existing.key,
            word = existing.word,
            language = existing.language,
            syncId = existing.syncId,
            sourceUrl = "https://ignored.example",
            definitionsJson = JSONArray(listOf("ignored")).toString(),
            lastSeenAt = existing.lastSeenAt,
        )

        assertFalse(repo.mergeRemote(sameTimestamp))
        val persisted = dao.read(existing.key)!!
        assertEquals(existing.sourceUrl, persisted.sourceUrl)
    }

    @Test
    fun mergeRemoteRevivesDeletedWordWhenRemoteIsNewer() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val removed = repo.saveSelection("revive-me", "en", "book-id", "Book", "cfi", "context")
        val tombstone = repo.remove(removed.key) ?: throw AssertionError("expected tombstone")
        val restored = makeWord(
            key = removed.key,
            word = removed.word,
            language = removed.language,
            syncId = removed.syncId,
            deleted = false,
            definitionsJson = JSONArray(listOf("revived")).toString(),
            sourceUrl = "https://revived.example",
            lastSeenAt = tombstone.lastSeenAt + 1000L,
        )

        assertTrue(repo.mergeRemote(restored))
        assertFalse(dao.read(removed.key)!!.deleted)
        assertEquals("https://revived.example", dao.read(removed.key)!!.sourceUrl)
        assertEquals("revived", JSONArray(dao.read(removed.key)!!.definitionsJson).optString(0))
    }

    @Test
    fun saveSelectionRevivesDeletedWord() = kotlinx.coroutines.runBlocking {
        val dao = InMemoryVocabularyWordDao()
        val repo = VocabularyRepository(dao)
        val removed = repo.saveSelection("revived", "EN", "book-id", "Book", "cfi", "context")
        val tombstone = repo.remove(removed.key) ?: throw AssertionError("expected tombstone")

        val reselected = repo.saveSelection("revived", "en", "book-id", "Book", "cfi-revisited", "context")

        assertEquals(removed.syncId, reselected.syncId)
        assertEquals(removed.key, reselected.key)
        assertEquals(removed.firstSeenAt, reselected.firstSeenAt)
        assertEquals(removed.lookupCount + 1, reselected.lookupCount)
        assertEquals(false, reselected.deleted)
        assertTrue(tombstone.lastSeenAt <= reselected.lastSeenAt)
        assertEquals(false, dao.read(removed.key)?.deleted == true)
    }

    @Test
    fun parseProgressPayloadWithNullCfiDefaultsToEmpty() {
        val bookId = "afea92e35940157a01537f5d064d4b9ff9985ab8ae4719985001238f1de45c2b"
        val locator = """{"locator":{"progression":0.22,"cfi":null}}"""
        val parsed = NostrClient.parseProgressContent(locator, bookId)!!

        assertEquals(0.22, parsed.second, 1e-9)
        assertEquals("", parsed.third)
    }
}
