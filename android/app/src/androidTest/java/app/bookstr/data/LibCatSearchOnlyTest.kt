package app.bookstr.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibCatSearchOnlyTest {
    @Test fun searchWithoutSignerDoesNotFallBackToPublicCatalog() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val settings = SettingsRepository(context)
        val previousAuthMode = settings.authMode
        settings.authMode = NostrAuthMode.None
        try {
            val progress = object : BookProgressDao {
                override suspend fun get(bookId: String): BookProgress? = null
                override suspend fun getAll(): List<BookProgress> = emptyList()
                override suspend fun upsert(progress: BookProgress) = Unit
            }
            val catalog = CatalogRepository(context, progress, settings)
            val failure = assertThrows(IllegalArgumentException::class.java) {
                runBlocking { catalog.searchPage("Alice") }
            }
            assertEquals("Connect a Nostr signer to search LibCat", failure.message)
        } finally {
            settings.authMode = previousAuthMode
        }
    }
}
