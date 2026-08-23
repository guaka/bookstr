package app.bookstr.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import org.json.JSONArray
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

@Entity(tableName = "vocabulary_words")
data class VocabularyWord(
    @PrimaryKey val key: String,
    val word: String,
    val language: String,
    val syncId: String,
    val bookId: String,
    val bookTitle: String,
    val cfi: String,
    val contextSentence: String,
    val partOfSpeech: String,
    val definitionsJson: String,
    val sourceUrl: String,
    val lookupCount: Int,
    val firstSeenAt: Long,
    val lastSeenAt: Long,
    val deleted: Boolean,
) {
    val definitions: List<String>
        get() = runCatching {
            val array = JSONArray(definitionsJson)
            List(array.length()) { index -> array.optString(index) }.filter(String::isNotBlank)
        }.getOrDefault(emptyList())
}

@Dao
interface VocabularyWordDao {
    @Query("SELECT * FROM vocabulary_words WHERE deleted = 0 ORDER BY lastSeenAt DESC")
    suspend fun getAll(): List<VocabularyWord>

    @Query("SELECT * FROM vocabulary_words ORDER BY lastSeenAt DESC")
    suspend fun getAllIncludingDeleted(): List<VocabularyWord>

    @Query("SELECT * FROM vocabulary_words WHERE `key` = :key LIMIT 1")
    suspend fun get(key: String): VocabularyWord?

    @Query("SELECT * FROM vocabulary_words WHERE language = :language AND word = :word LIMIT 1")
    suspend fun getByWord(language: String, word: String): VocabularyWord?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(word: VocabularyWord)
}

class VocabularyRepository(private val dao: VocabularyWordDao) {
    private val writeMutex = Mutex()

    suspend fun all(): List<VocabularyWord> = writeMutex.withLock {
        dao.getAll().map { entry ->
            if (entry.syncId.isNotBlank()) entry
            else entry.copy(syncId = UUID.randomUUID().toString()).also { dao.upsert(it) }
        }
    }

    suspend fun allForSync(): List<VocabularyWord> = writeMutex.withLock {
        dao.getAllIncludingDeleted().map { entry ->
            if (entry.syncId.isNotBlank()) entry
            else entry.copy(syncId = UUID.randomUUID().toString()).also { dao.upsert(it) }
        }
    }

    suspend fun saveSelection(
        word: String,
        language: String,
        bookId: String,
        bookTitle: String,
        cfi: String,
        contextSentence: String,
    ) = writeMutex.withLock {
        val key = key(language, word)
        val existing = dao.getByWord(language.lowercase(), word.lowercase())
        val now = System.currentTimeMillis()
        val saved = VocabularyWord(
                key = existing?.key ?: key,
                word = word,
                language = language.lowercase(),
                syncId = existing?.syncId?.takeIf(String::isNotBlank) ?: UUID.randomUUID().toString(),
                bookId = bookId,
                bookTitle = bookTitle,
                cfi = cfi,
                contextSentence = contextSentence,
                partOfSpeech = existing?.partOfSpeech.orEmpty(),
                definitionsJson = existing?.definitionsJson ?: "[]",
                sourceUrl = existing?.sourceUrl.orEmpty(),
                lookupCount = (existing?.lookupCount ?: 0) + 1,
                firstSeenAt = existing?.firstSeenAt ?: now,
                lastSeenAt = now,
                deleted = false,
            )
        dao.upsert(saved)
        saved
    }

    suspend fun saveDefinition(
        word: String,
        language: String,
        partOfSpeech: String,
        definitions: List<String>,
        sourceUrl: String,
    ) = writeMutex.withLock {
        val existing = dao.getByWord(language.lowercase(), word.lowercase()) ?: return@withLock null
        val saved = existing.copy(
                partOfSpeech = partOfSpeech,
                definitionsJson = JSONArray(definitions).toString(),
                sourceUrl = sourceUrl,
                lastSeenAt = System.currentTimeMillis(),
            )
        dao.upsert(saved)
        saved
    }

    suspend fun mergeRemote(word: VocabularyWord): Boolean = writeMutex.withLock {
        val existing = dao.getByWord(word.language.lowercase(), word.word.lowercase())
        if (existing != null && existing.lastSeenAt >= word.lastSeenAt) return@withLock false
        dao.upsert(word.copy(key = existing?.key ?: word.key))
        true
    }

    suspend fun remove(key: String): VocabularyWord? = writeMutex.withLock {
        val existing = dao.get(key) ?: return@withLock null
        existing.copy(deleted = true, lastSeenAt = System.currentTimeMillis()).also { dao.upsert(it) }
    }

    private fun key(language: String, word: String): String =
        "${language.lowercase()}:${word.lowercase()}"
}
