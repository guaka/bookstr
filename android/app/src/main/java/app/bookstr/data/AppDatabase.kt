package app.bookstr.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(entities = [BookProgress::class, VocabularyWord::class], version = 5, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun bookProgressDao(): BookProgressDao
    abstract fun vocabularyWordDao(): VocabularyWordDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "bookstr.db")
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                .build()

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """CREATE TABLE IF NOT EXISTS `vocabulary_words` (
                        `key` TEXT NOT NULL,
                        `word` TEXT NOT NULL,
                        `language` TEXT NOT NULL,
                        `bookId` TEXT NOT NULL,
                        `bookTitle` TEXT NOT NULL,
                        `cfi` TEXT NOT NULL,
                        `contextSentence` TEXT NOT NULL,
                        `partOfSpeech` TEXT NOT NULL,
                        `definitionsJson` TEXT NOT NULL,
                        `sourceUrl` TEXT NOT NULL,
                        `lookupCount` INTEGER NOT NULL,
                        `firstSeenAt` INTEGER NOT NULL,
                        `lastSeenAt` INTEGER NOT NULL,
                        PRIMARY KEY(`key`)
                    )""".trimIndent(),
                )
            }
        }

        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE `vocabulary_words` ADD COLUMN `syncId` TEXT NOT NULL DEFAULT ''",
                )
            }
        }

        private val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE `vocabulary_words` ADD COLUMN `deleted` INTEGER NOT NULL DEFAULT 0",
                )
            }
        }

        private val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE `book_progress` ADD COLUMN `furthestProgression` REAL NOT NULL DEFAULT 0",
                )
                database.execSQL(
                    "UPDATE `book_progress` SET `furthestProgression` = `progression`",
                )
            }
        }
    }
}
