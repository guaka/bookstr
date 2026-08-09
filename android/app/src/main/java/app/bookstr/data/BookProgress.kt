package app.bookstr.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query

@Entity(tableName = "book_progress")
data class BookProgress(
    @PrimaryKey val bookId: String,
    val progression: Double,
    val cfi: String,
    val updatedAt: Long,
)

@Dao
interface BookProgressDao {
    @Query("SELECT * FROM book_progress WHERE bookId = :bookId LIMIT 1")
    suspend fun get(bookId: String): BookProgress?

    @Query("SELECT * FROM book_progress ORDER BY updatedAt DESC")
    suspend fun getAll(): List<BookProgress>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(progress: BookProgress)
}
