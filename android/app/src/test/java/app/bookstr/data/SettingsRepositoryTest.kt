package app.bookstr.data

import android.app.Application
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    application = Application::class,
    sdk = [35],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedSharedPreferences::class],
)
class SettingsRepositoryTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private lateinit var settings: SettingsRepository

    @Before
    fun resetSettings() {
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("robolectric_encrypted_bookstr_secure", Context.MODE_PRIVATE).edit().clear().commit()
        settings = SettingsRepository(context)
        settings.disconnectNostr()
        settings.clearReaderSession()
    }

    @Test
    fun plainPreferencesExposeDefaultsNormalizeListsAndPersistSelections() {
        assertEquals(SettingsRepository.DEFAULT_RELAYS, settings.relays.single())
        assertEquals(ReaderTheme.Paper, settings.theme)
        assertEquals(ReaderFont.Arial, settings.readerFont)
        assertEquals(ReaderAlignment.Justified, settings.readerAlignment)
        assertTrue(settings.keepReadingOnLockScreen)
        assertEquals("recent", settings.wordSort)
        assertEquals("en", settings.dictionarySource)
        assertEquals("pt", settings.dictionaryTarget)

        settings.relays = listOf(" wss://one.example ", "", "wss://two.example")
        settings.theme = ReaderTheme.Night
        settings.readerFont = ReaderFont.NotoSerif
        settings.readerAlignment = ReaderAlignment.Left
        settings.keepReadingOnLockScreen = false
        settings.wordSort = "title"
        settings.dictionarySource = "fr"
        settings.dictionaryTarget = "de"
        val restored = SettingsRepository(context)
        assertEquals(listOf("wss://one.example", "wss://two.example"), restored.relays)
        assertEquals(ReaderTheme.Night, restored.theme)
        assertEquals(ReaderFont.NotoSerif, restored.readerFont)
        assertEquals(ReaderAlignment.Left, restored.readerAlignment)
        assertFalse(restored.keepReadingOnLockScreen)
        assertEquals("title", restored.wordSort)
        assertEquals("fr", restored.dictionarySource)
        assertEquals("de", restored.dictionaryTarget)

        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit().putString("relays", " one, ,two\nthree ").commit()
        assertEquals(listOf("one", "two", "three"), restored.relays)
    }

    @Test
    fun pdfZoomIsClampedAndStoredIndependentlyByBook() {
        assertEquals(1f, settings.pdfZoom("a"), 0f)
        settings.savePdfZoom("a", 2.5f)
        settings.savePdfZoom("b", -2f)
        assertEquals(2.5f, settings.pdfZoom("a"), 0f)
        assertEquals(1f, settings.pdfZoom("b"), 0f)
        settings.savePdfZoom("a", 8f)
        assertEquals(5f, SettingsRepository(context).pdfZoom("a"), 0f)
    }

    @Test
    fun nostrIdentitySupportsLegacyNsecAndValidatesEachIdentityType() {
        assertEquals(NostrAuthMode.None, settings.authMode)
        assertFalse(settings.hasNostrIdentity())
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).edit().remove("auth_mode").commit()
        settings.nsec = "  secret  "
        assertEquals(NostrAuthMode.Nsec, settings.authMode)
        assertTrue(settings.hasNostrIdentity())
        settings.authMode = NostrAuthMode.None
        assertFalse(settings.hasNostrIdentity())

        settings.connectAmber("  ABCD  ", "  app.signer ")
        assertEquals("abcd", settings.pubkeyHex)
        assertEquals("app.signer", settings.signerPackage)
        assertNull(settings.nsec)
        assertTrue(settings.hasNostrIdentity())
        settings.signerPackage = " "
        assertFalse(settings.hasNostrIdentity())

        settings.connectNsec("  nsec-value  ", "  EF01 ")
        assertEquals(NostrAuthMode.Nsec, settings.authMode)
        assertEquals("nsec-value", settings.nsec)
        assertEquals("ef01", settings.pubkeyHex)
        assertNull(settings.signerPackage)
        assertTrue(settings.hasNostrIdentity())
        settings.disconnectNostr()
        assertEquals(NostrAuthMode.None, settings.authMode)
        assertNull(settings.nsec)
        assertNull(settings.pubkeyHex)
        assertNull(settings.signerPackage)
        assertFalse(settings.hasNostrIdentity())

        settings.pubkeyHex = "  "
        settings.signerPackage = " package.name  "
        assertNull(settings.pubkeyHex)
        assertEquals("package.name", settings.signerPackage)
        settings.signerPackage = null
        assertNull(settings.signerPackage)
        settings.authMode = NostrAuthMode.Amber
        assertFalse(settings.hasNostrIdentity())
    }

    @Test
    fun nostrCachesAreScopedToIdentityAndDisconnectClearsThem() {
        settings.cacheNostrFavorites("AABB", "[favorite]")
        assertEquals("[favorite]", settings.cachedNostrFavorites("aabb"))
        assertNull(settings.cachedNostrFavorites("ccdd"))
        settings.cacheNostrFavorites("AABB", "  ")
        assertNull(settings.cachedNostrFavorites("aabb"))

        val snapshot = CollectionSnapshot(tombstones = listOf(CollectionTombstone("removed", 9)))
        settings.cacheNostrCollections("AABB", snapshot)
        assertEquals(snapshot, settings.cachedNostrCollections("aabb"))
        assertEquals(CollectionSnapshot(), settings.cachedNostrCollections("ccdd"))
        settings.disconnectNostr()
        assertNull(settings.cachedNostrFavorites("aabb"))
        assertEquals(CollectionSnapshot(), settings.cachedNostrCollections("aabb"))
    }

    @Test
    fun connectingDifferentIdentityClearsOldCachesButSameIdentityPreservesThem() {
        settings.cacheNostrFavorites("AABB", "saved")
        settings.cacheNostrCollections("AABB", CollectionSnapshot(tombstones = listOf(CollectionTombstone("x", 1))))
        settings.connectNsec("first", "aabb")
        assertEquals("saved", settings.cachedNostrFavorites("AABB"))
        settings.connectAmber("next", "signer")
        assertNull(settings.cachedNostrFavorites("AABB"))
        assertEquals(CollectionSnapshot(), settings.cachedNostrCollections("AABB"))

        settings.cacheNostrFavorites("CCDD", "another")
        settings.connectNsec("secret", "EEFF")
        assertNull(settings.cachedNostrFavorites("CCDD"))
    }

    @Test
    fun readerSessionRoundTripsOptionalFieldsAndClampsNegativeProgress() {
        assertNull(settings.readerSession())
        settings.saveReaderSession(
            ReaderSession(
                bookId = "id-1", bookTitle = "Title", format = BookFormat.Pdf,
                author = "Author", year = "2024", locator = "page-4", pageIndex = -2, pageOffset = -1,
                rightsStatus = "public-domain", license = "CC0", licenseUrl = "https://license.example",
                rightsSource = "catalog",
            ),
        )
        assertEquals(
            ReaderSession(
                bookId = "id-1", bookTitle = "Title", format = BookFormat.Pdf,
                author = "Author", year = "2024", locator = "page-4", pageIndex = 0, pageOffset = 0,
                rightsStatus = "public-domain", license = "CC0", licenseUrl = "https://license.example",
                rightsSource = "catalog",
            ),
            SettingsRepository(context).readerSession(),
        )

        settings.saveReaderSession(ReaderSession("id-2", "", BookFormat.Epub))
        assertEquals(
            ReaderSession("id-2", "Book", BookFormat.Epub),
            settings.readerSession(),
        )
        settings.clearReaderSession()
        assertNull(settings.readerSession())
    }

    @Test
    fun catalogInvitationParsesPersistsAndInvalidOrNullValuesReadAsAbsent() {
        val uri = "bookstr://catalog?v=1&npub=npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6&name=Test&relay=wss%3A%2F%2Frelay.example"
        settings.catalogConnection = CatalogConnection.parse(uri)
        val restored = SettingsRepository(context)
        assertEquals("Test", restored.catalogConnection?.name)
        assertEquals("wss://relay.example", restored.catalogConnection?.relays?.single())

        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit().putString("catalog_invitation", "invalid").commit()
        assertNull(restored.catalogConnection)
        restored.catalogConnection = null
        assertNull(restored.catalogConnection)
    }
}
