package app.bookstr.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.nostr.NostrAuthMode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsRepositoryCoverageTest {
    private lateinit var context: Context
    private lateinit var settings: SettingsRepository

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearStoredSettings()
        settings = SettingsRepository(context)
    }

    @After
    fun tearDown() {
        clearStoredSettings()
    }

    @Test
    fun relaysSetterAndGetterTrimAndSplitInput() {
        settings.relays = listOf(" wss://a.io ", "wss://b.io", " ", "")
        assertEquals(listOf("wss://a.io", "wss://b.io"), settings.relays)

        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit()
            .putString("relays", "  \nwss://x.io,,wss://y.io\n,  ")
            .apply()
        val reloaded = SettingsRepository(context)
        assertEquals(listOf("wss://x.io", "wss://y.io"), reloaded.relays)
    }

    @Test
    fun pdfZoomIsPersistedAndClampedBetweenOneAndFive() {
        assertEquals(1f, settings.pdfZoom("book-1"))

        settings.savePdfZoom("book-1", 0.25f)
        assertEquals(1f, settings.pdfZoom("book-1"))

        settings.savePdfZoom("book-1", 5.25f)
        assertEquals(5f, settings.pdfZoom("book-1"))
    }

    @Test
    fun readerSessionClampsNegativeIndicesAndSkipsBlankBookIdOnSave() {
        settings.saveReaderSession(
            ReaderSession(
                bookId = "book-id",
                bookTitle = "Test",
                format = BookFormat.Epub,
                pageIndex = -10,
                pageOffset = -3,
            ),
        )
        val restored = settings.readerSession()
        assertEquals("book-id", restored?.bookId)
        assertEquals(0, restored?.pageIndex)
        assertEquals(0, restored?.pageOffset)

        settings.saveReaderSession(
            ReaderSession(
                bookId = "   ",
                bookTitle = "Ignored",
                format = BookFormat.Pdf,
            ),
        )
        assertNull(settings.readerSession())
    }

    @Test
    fun dictionaryAndSessionSettingsRoundTripAcrossInstances() {
        settings.wordSort = "alpha"
        settings.dictionarySource = "es"
        settings.dictionaryTarget = "it"
        settings.keepReadingOnLockScreen = false
        settings.speechRate = 0.57
        settings.nsec = "  NSECSECRET  "

        val reloaded = SettingsRepository(context)
        assertEquals("alpha", reloaded.wordSort)
        assertEquals("es", reloaded.dictionarySource)
        assertEquals("it", reloaded.dictionaryTarget)
        assertEquals(false, reloaded.keepReadingOnLockScreen)
        assertEquals(0.57, reloaded.speechRate, 0.0)
        assertEquals("nsecsecret", reloaded.nsec)
    }

    @Test
    fun connectAmberAndConnectNsecSwapIdentityAndClearOldFavoritesCache() {
        settings.connectAmber("AABBCCDDEEFF0011223344556677889900112233445566778899AABBCCDDEEFF0011", "com.example.amber")
        settings.cacheNostrFavorites("AABBCCDDEEFF0011223344556677889900112233445566778899AABBCCDDEEFF0011", "old", "event-1")
        assertEquals("event-1", settings.cachedNostrFavorites("aabbccddeeff0011223344556677889900112233445566778899aabbccddeeff0011"))

        settings.connectNsec("00112233445566778899001122334455667788990011223344556677889900112233", "newbook")
        assertEquals(NostrAuthMode.Nsec, settings.authMode)
        assertEquals("00112233445566778899001122334455667788990011223344556677889900112233", settings.pubkeyHex)
        assertNull(settings.cachedNostrFavorites("aabbccddeeff0011223344556677889900112233445566778899aabbccddeeff0011"))
    }

    @Test
    fun disconnectNostrClearsModeAndIdentityCredentials() {
        settings.connectAmber("AABB", "com.example.amber")
        settings.nsec = "nsec"
        settings.cacheNostrFavorites("aabb", "cached", "event")
        assertEquals("cached", settings.cachedNostrFavorites("aabb"))
        assertEquals(NostrAuthMode.Amber, settings.authMode)

        settings.disconnectNostr()
        assertEquals(NostrAuthMode.None, settings.authMode)
        assertNull(settings.nsec)
        assertNull(settings.pubkeyHex)
        assertNull(settings.signerPackage)
        assertNull(settings.cachedNostrFavorites("aabb"))
    }

    @Test
    fun hasNostrIdentityDependsOnModeAndTrimmedCredentials() {
        settings.connectAmber("AABB", "com.example.amber")
        assertEquals(false, settings.hasNostrIdentity())

        settings.pubkeyHex = "  A1B2 "
        settings.signerPackage = "com.example.amber"
        assertEquals(false, settings.hasNostrIdentity())

        settings.pubkeyHex = "aabb"
        assertEquals(true, settings.hasNostrIdentity())

        settings.disconnectNostr()
        settings.nsec = "  00112233445566778899001122334455667788990011223344556677889900112233  "
        settings.authMode = NostrAuthMode.Nsec
        assertEquals(true, settings.hasNostrIdentity())
    }

    private fun clearStoredSettings() {
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
        context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
