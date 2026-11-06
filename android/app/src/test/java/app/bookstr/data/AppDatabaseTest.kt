package app.bookstr.data

import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class AppDatabaseTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @After fun cleanUp() {
        context.deleteDatabase("bookstr.db")
    }

    @Test fun progressDaoPersistsReplacementsAndOrdersByMostRecentUpdate() = runBlocking {
        val database = AppDatabase.create(context)
        try {
            val dao = database.bookProgressDao()
            assertNull(dao.get("missing"))
            dao.upsert(BookProgress("older", 0.2, "cfi-old", 10, 0.7))
            dao.upsert(BookProgress("newer", 0.4, "cfi-new", 20, 0.8))
            dao.upsert(BookProgress("older", 0.3, "cfi-updated", 30, 0.7))

            assertEquals(BookProgress("older", 0.3, "cfi-updated", 30, 0.7), dao.get("older"))
            assertEquals(listOf("older", "newer"), dao.getAll().map { it.bookId })
            assertEquals(BookProgress("older", 0.3, "cfi-updated", 30, 0.7), dao.getAll().first())
        } finally {
            database.close()
        }

        val reopened = AppDatabase.create(context)
        try {
            assertEquals(2, reopened.bookProgressDao().getAll().size)
            assertEquals(0.7, reopened.bookProgressDao().get("older")!!.furthestProgression, 0.0)
        } finally {
            reopened.close()
        }
    }

    @Test fun migrationFromVersionOnePreservesProgressAndInitializesFurthestProgression() = runBlocking {
        context.deleteDatabase("bookstr.db")
        val legacy = context.openOrCreateDatabase("bookstr.db", Context.MODE_PRIVATE, null)
        legacy.execSQL(
            "CREATE TABLE `book_progress` (`bookId` TEXT NOT NULL, `progression` REAL NOT NULL, `cfi` TEXT NOT NULL, `updatedAt` INTEGER NOT NULL, PRIMARY KEY(`bookId`))",
        )
        legacy.execSQL(
            "INSERT INTO `book_progress` (`bookId`, `progression`, `cfi`, `updatedAt`) VALUES ('legacy', 0.65, 'epubcfi(/6/4)', 1234)",
        )
        legacy.version = 1
        legacy.close()

        val migrated = AppDatabase.create(context)
        try {
            val progress = migrated.bookProgressDao().get("legacy")
            assertEquals(0.65, progress!!.progression, 0.0)
            assertEquals(0.65, progress.furthestProgression, 0.0)
            assertEquals("epubcfi(/6/4)", progress.cfi)
            assertEquals(1234L, progress.updatedAt)
        } finally {
            migrated.close()
        }
    }
}
