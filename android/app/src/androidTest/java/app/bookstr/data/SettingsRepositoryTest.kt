package app.bookstr.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsRepositoryTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearStoredSettings()
    }

    @After
    fun tearDown() {
        clearStoredSettings()
    }

    @Test
    fun cacheNostrFavoritesLowercasesAndOnlyMatchesEquivalentPubkeys() {
        val repository = SettingsRepository(context)

        repository.cacheNostrFavorites("AbC123", "[\"e\",\"1\"]")
        assertEquals("[\"e\",\"1\"]", repository.cachedNostrFavorites("abc123"))
        assertNull(repository.cachedNostrFavorites("abcd"))
    }

    @Test
    fun cachedNostrFavoritesReturnsNullForBlankData() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("AbC123", "   ")

        assertEquals(null, repository.cachedNostrFavorites("abc123"))
    }

    @Test
    fun pubkeyHexAndSignerPackageTrimAndClearValues() {
        val repository = SettingsRepository(context)

        repository.pubkeyHex = "  AaB  "
        repository.signerPackage = "  com.example.amber  "
        assertEquals("aab", repository.pubkeyHex)
        assertEquals("com.example.amber", repository.signerPackage)

        repository.pubkeyHex = "  "
        repository.signerPackage = ""
        assertEquals(null, repository.pubkeyHex)
        assertEquals(null, repository.signerPackage)

        repository.nsec = "   nsec  "
        assertEquals("nsec", repository.nsec)
        repository.nsec = "  "
        assertEquals(null, repository.nsec)
    }

    @Test
    fun connectNsecClearsCachesAndNormalizesIdentityValues() {
        val repository = SettingsRepository(context)

        repository.cacheNostrFavorites("old", "cached-old")
        repository.signerPackage = "com.example.amber"
        repository.nsec = "legacy"
        repository.connectNsec("secret", "AaB")

        assertEquals(NostrAuthMode.Nsec, repository.authMode)
        assertEquals("aab", repository.pubkeyHex)
        assertNull(repository.signerPackage)
        assertEquals("secret", repository.nsec)
        assertNull(repository.cachedNostrFavorites("old"))
        assertNull(repository.cachedNostrFavorites("aab"))
    }

    @Test
    fun connectNsecKeepsCacheWhenPubkeyMatchesExistingIdentity() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("AbCd", "[\"keep\"]")
        repository.connectNsec("new", "AbCd")

        assertEquals("abcd", repository.pubkeyHex)
        assertEquals("[\"keep\"]", repository.cachedNostrFavorites("abcd"))
    }

    @Test
    fun hasNostrIdentityReturnsFalseWhenNsecModeIsConfiguredWithBlankSecret() {
        val repository = SettingsRepository(context)
        repository.authMode = NostrAuthMode.Nsec
        repository.nsec = "   "

        assertEquals(false, repository.hasNostrIdentity())
    }

    @Test
    fun connectNsecClearsFavoritesWhenPubkeyChanges() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("OldOne", "[\"old\"]")

        repository.connectNsec("secret", "NewOne")
        assertEquals(null, repository.cachedNostrFavorites("oldone"))
        assertEquals("newone", repository.pubkeyHex)
        assertEquals("secret", repository.nsec)
    }

    @Test
    fun connectAmberClearsLegacyNsecAndLowercasesPubkey() {
        val repository = SettingsRepository(context)

        repository.nsec = "nsec-legacy"
        repository.connectAmber("BBcc", "app.bookstr.amber")

        assertEquals(NostrAuthMode.Amber, repository.authMode)
        assertEquals("bbcc", repository.pubkeyHex)
        assertEquals("app.bookstr.amber", repository.signerPackage)
        assertNull(repository.nsec)
    }

    @Test
    fun connectAmberTrimsSignerPackageAndLowercasesPubkey() {
        val repository = SettingsRepository(context)

        repository.connectAmber("AaB", "  app.bookstr.amber  ")
        assertEquals(NostrAuthMode.Amber, repository.authMode)
        assertEquals("aab", repository.pubkeyHex)
        assertEquals("app.bookstr.amber", repository.signerPackage)
    }

    @Test
    fun connectAmberPreservesFavoriteCacheWhenPubkeyMatches() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("AbCd", "[\"keep\"]")

        repository.connectAmber("AbCd", "app.bookstr.amber")
        assertEquals(NostrAuthMode.Amber, repository.authMode)
        assertEquals("abcd", repository.pubkeyHex)
        assertEquals("app.bookstr.amber", repository.signerPackage)
        assertEquals("[\"keep\"]", repository.cachedNostrFavorites("abcd"))
    }

    @Test
    fun connectAmberClearsFavoriteCacheWhenPubkeyChanges() {
        val repository = SettingsRepository(context)
        repository.connectNsec("legacy", "oldkey")
        repository.cacheNostrFavorites("oldkey", "[\"old\"]")

        repository.connectAmber("newkey", "app.bookstr.amber")
        assertEquals(NostrAuthMode.Amber, repository.authMode)
        assertEquals("newkey", repository.pubkeyHex)
        assertEquals("app.bookstr.amber", repository.signerPackage)
        assertEquals(null, repository.cachedNostrFavorites("oldkey"))
        assertEquals(null, repository.cachedNostrFavorites("newkey"))
    }

    @Test
    fun hasNostrIdentityUsesLegacyNsecWhenModeMissing() {
        val repository = SettingsRepository(context)
        repository.nsec = "nsec-value"

        assertEquals(NostrAuthMode.Nsec, repository.authMode)
        assertTrue(repository.hasNostrIdentity())
    }

    @Test
    fun hasNostrIdentityRequiresAllAmberPieces() {
        val repository = SettingsRepository(context)
        assertEquals(false, repository.hasNostrIdentity())

        repository.authMode = NostrAuthMode.Amber
        repository.pubkeyHex = "pubkey"
        assertEquals(false, repository.hasNostrIdentity())

        repository.signerPackage = "com.example.amber"
        assertEquals(true, repository.hasNostrIdentity())
    }

    @Test
    fun hasNostrIdentityDependsOnAuthModeEvenWhenDataExists() {
        val repository = SettingsRepository(context)
        repository.nsec = "nsec"
        repository.pubkeyHex = "ABC"
        repository.signerPackage = "com.example.amber"
        repository.authMode = NostrAuthMode.None
        assertEquals(false, repository.hasNostrIdentity())
    }

    @Test
    fun hasNostrIdentityRequiresNostrSecretWhenInNsecMode() {
        val repository = SettingsRepository(context)

        repository.authMode = NostrAuthMode.Nsec
        assertEquals(false, repository.hasNostrIdentity())

        repository.nsec = "nsec"
        assertEquals(true, repository.hasNostrIdentity())
    }

    @Test
    fun authModeFallsBackToNsecWhenLegacyNsecIsPresent() {
        val repository = SettingsRepository(context)
        repository.nsec = "legacy-secret"
        assertEquals(NostrAuthMode.Nsec, repository.authMode)
        repository.nsec = null
        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsInvalid() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "nonsense").apply()
        val repository = SettingsRepository(context)

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsUppercase() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "NSEC").apply()

        val repository = SettingsRepository(context)
        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsWhitespace() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "   ").apply()
        val repository = SettingsRepository(context)

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsMissing() {
        val repository = SettingsRepository(context)
        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneForEmptyStoredValue() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "").apply()
        val repository = SettingsRepository(context)

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNsecWhenKeyIsMissingAndLegacyNsecIsConfigured() {
        val repository = SettingsRepository(context)
        repository.nsec = "legacy-secret"

        assertEquals(NostrAuthMode.Nsec, repository.authMode)
    }

    @Test
    fun authModePersistsAcrossInstances() {
        val first = SettingsRepository(context)
        first.authMode = NostrAuthMode.Nsec
        val second = SettingsRepository(context)

        assertEquals(NostrAuthMode.Nsec, second.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsWhitespaceEvenIfNsecIsConfigured() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "   ").apply()

        val repository = SettingsRepository(context)
        repository.nsec = "legacy"

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsInvalidEvenAfterExplicitClear() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "unknown-mode").apply()
        val repository = SettingsRepository(context)
        repository.authMode = NostrAuthMode.None

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun authModeDefaultsToNoneWhenStoredValueIsInvalidEvenIfNsecIsConfigured() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("auth_mode", "bad-mode").apply()

        val repository = SettingsRepository(context)
        repository.nsec = "legacy"

        assertEquals(NostrAuthMode.None, repository.authMode)
    }

    @Test
    fun connectNsecNormalizesPubkeyAndClearsLegacyNostrState() {
        val repository = SettingsRepository(context)
        repository.nsec = "legacy"
        repository.signerPackage = "legacy-signer"
        repository.pubkeyHex = "OLDKEY"

        repository.connectNsec("  aAbBcc  ", "  nEwKeY  ")

        assertEquals(NostrAuthMode.Nsec, repository.authMode)
        assertEquals("aabbcc", repository.pubkeyHex)
        assertEquals("newkey", repository.nsec)
        assertEquals(null, repository.signerPackage)
    }

    @Test
    fun themeDefaultsToPaperWhenStoredValueIsInvalid() {
        val repository = SettingsRepository(context)
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit()
            .putString("theme", "neon")
            .apply()

        assertEquals(ReaderTheme.Paper, repository.theme)
    }

    @Test
    fun relaysSetterFiltersBlankEntriesOnRead() {
        val repository = SettingsRepository(context)
        repository.relays = listOf("wss://first", "", "   ", "wss://second")

        assertEquals(listOf("wss://first", "wss://second"), repository.relays)
    }

    @Test
    fun relaysSetterPersistsEmptyListAsBlankString() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        val repository = SettingsRepository(context)
        repository.relays = emptyList()

        assertEquals(listOf<String>(), repository.relays)
        assertEquals("", preferences.getString("relays", null))
    }

    @Test
    fun themeDefaultsToPaperWhenStoredValueIsUppercase() {
        val repository = SettingsRepository(context)
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit()
            .putString("theme", "WHITE")
            .apply()

        assertEquals(ReaderTheme.Paper, repository.theme)
    }

    @Test
    fun themeDefaultsToPaperWhenStoredValueIsMissing() {
        val repository = SettingsRepository(context)
        assertEquals(ReaderTheme.Paper, repository.theme)
    }

    @Test
    fun themeDefaultsToPaperWhenStoredValueIsEmptyOrWhitespace() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("theme", "").apply()

        assertEquals(ReaderTheme.Paper, SettingsRepository(context).theme)

        preferences.edit().putString("theme", "   ").apply()
        assertEquals(ReaderTheme.Paper, SettingsRepository(context).theme)
    }

    @Test
    fun themeDefaultsToPaperAndPersistsCustomValue() {
        val repository = SettingsRepository(context)
        assertEquals(ReaderTheme.Paper, repository.theme)

        repository.theme = ReaderTheme.White
        assertEquals(ReaderTheme.White, repository.theme)
        assertEquals(ReaderTheme.White, SettingsRepository(context).theme)
    }

    @Test
    fun themeDefaultsToPaperAndPersistsCustomValueAcrossInstances() {
        val repository = SettingsRepository(context)
        repository.theme = ReaderTheme.Night
        assertEquals(ReaderTheme.Night, repository.theme)

        val reload = SettingsRepository(context)
        assertEquals(ReaderTheme.Night, reload.theme)
    }

    @Test
    fun readerSessionIsUnaffectedWhenFormatIsInvalidAndDefaultsBackToEpub() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-format",
                bookTitle = "Title",
                format = BookFormat.Pdf,
                locator = "",
                pageIndex = -1,
            ),
        )
        context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
            .edit()
            .putString("reader_format", "weird")
            .apply()

        val loaded = repository.readerSession()
        assertEquals(BookFormat.Epub, loaded!!.format)
    }

    @Test
    fun disconnectNostrClearsIdentityAndFavoriteCache() {
        val repository = SettingsRepository(context)
        repository.nsec = "nsec"
        repository.pubkeyHex = "aabbcc"
        repository.signerPackage = "com.example.amber"
        repository.connectAmber("aabbcc", "com.example.amber")
        repository.cacheNostrFavorites("aabbcc", "[\"e\",\"1\"]")
        repository.disconnectNostr()

        assertEquals(NostrAuthMode.None, repository.authMode)
        assertEquals(null, repository.nsec)
        assertEquals(null, repository.pubkeyHex)
        assertEquals(null, repository.signerPackage)
        assertEquals(null, repository.cachedNostrFavorites("aabbcc"))
    }

    @Test
    fun readerSessionClampsAndRestoresFields() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-1",
                bookTitle = "Reader title",
                format = BookFormat.Pdf,
                author = "A",
                year = "2020",
                locator = null,
                pageIndex = -10,
                pageOffset = -99,
            ),
        )
        val loaded = repository.readerSession()

        assertNotNull(loaded)
        assertEquals(0, loaded!!.pageIndex)
        assertEquals(0, loaded.pageOffset)
        assertEquals("book-1", loaded.bookId)
        assertEquals("Reader title", loaded.bookTitle)
        assertEquals(BookFormat.Pdf, loaded.format)
    }

    @Test
    fun clearReaderSessionRemovesStoredState() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-2",
                bookTitle = "Still here",
                format = BookFormat.Epub,
            ),
        )
        assertNotNull(repository.readerSession())
        repository.clearReaderSession()
        assertNull(repository.readerSession())
    }

    @Test
    fun readerSessionDefaultsToEpubWhenFormatIsMissing() {
        val repository = SettingsRepository(context)
        val securePreferences = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        securePreferences.edit()
            .putString("reader_book_id", "book-4")
            .putString("reader_book_title", "Recovered")
            .putInt("reader_page", 3)
            .putInt("reader_offset", 4)
            .apply()

        val loaded = repository.readerSession()

        assertEquals("book-4", loaded?.bookId)
        assertEquals("Recovered", loaded?.bookTitle)
        assertEquals(BookFormat.Epub, loaded?.format)
        assertEquals(3, loaded?.pageIndex)
        assertEquals(4, loaded?.pageOffset)
    }

    @Test
    fun readerSessionDefaultsToEpubWhenFormatIsEmptyString() {
        val repository = SettingsRepository(context)
        val securePreferences = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        securePreferences.edit()
            .putString("reader_book_id", "book-5")
            .putString("reader_book_title", "Recovered")
            .putString("reader_format", "")
            .putInt("reader_page", 9)
            .apply()

        val loaded = repository.readerSession()

        assertEquals(BookFormat.Epub, loaded?.format)
        assertEquals(9, loaded?.pageIndex)
    }

    @Test
    fun clearReaderSessionDoesNotClearNostrFavoritesCache() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("aBc123", "[\"e\",\"1\"]")
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-cache",
                bookTitle = "Keep me",
                format = BookFormat.Epub,
            ),
        )

        repository.clearReaderSession()

        assertEquals("[\"e\",\"1\"]", repository.cachedNostrFavorites("ABC123"))
    }

    @Test
    fun clearReaderSessionClearsAllStoredKeys() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-3",
                bookTitle = "Stored title",
                format = BookFormat.Pdf,
                author = "Author",
                year = "2024",
                locator = "loc",
                pageIndex = 7,
                pageOffset = 9,
            ),
        )
        val securePreferences = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        assertNotNull(securePreferences.getString("reader_book_id", null))

        repository.clearReaderSession()
        assertEquals(null, securePreferences.getString("reader_book_id", null))
        assertEquals(null, securePreferences.getString("reader_book_title", null))
        assertEquals(null, securePreferences.getString("reader_author", null))
        assertEquals(null, securePreferences.getString("reader_year", null))
        assertEquals(null, securePreferences.getString("reader_format", null))
        assertEquals(null, securePreferences.getString("reader_locator", null))
        assertEquals(0, securePreferences.getInt("reader_page", 0))
        assertEquals(0, securePreferences.getInt("reader_offset", 0))
    }

    @Test
    fun clearReaderSessionSafeToCallWhenSessionIsAlreadyMissing() {
        val repository = SettingsRepository(context)
        repository.clearReaderSession()
        assertEquals(null, repository.readerSession())
    }

    @Test
    fun readerSessionFallsBackToDefaultTitleWhenMissing() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-3",
                bookTitle = "Stored title",
                format = BookFormat.Epub,
            ),
        )
        val prefs = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        prefs.edit().remove("reader_book_title").apply()

        val loaded = repository.readerSession()
        assertNotNull(loaded)
        assertEquals("Book", loaded!!.bookTitle)
    }

    @Test
    fun readerSessionFallsBackToDefaultFieldsWhenOptionalValuesAreEmpty() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-empty-meta",
                bookTitle = "",
                author = "",
                year = "",
                format = BookFormat.Pdf,
            ),
        )

        val loaded = repository.readerSession()
        assertEquals("Book", loaded!!.bookTitle)
        assertEquals(null, loaded.author)
        assertEquals(null, loaded.year)
    }

    @Test
    fun readerSessionFallsBackToDefaultFieldsWhenOptionalValuesAreWhitespace() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-whitespace-meta",
                bookTitle = "   ",
                format = BookFormat.Epub,
                author = "   ",
                year = "\t",
                locator = "\n",
                pageIndex = 5,
                pageOffset = 6,
            ),
        )

        val loaded = repository.readerSession()
        assertNotNull(loaded)
        assertEquals("Book", loaded!!.bookTitle)
        assertEquals(null, loaded.author)
        assertEquals(null, loaded.year)
        assertEquals(null, loaded.locator)
        assertEquals(5, loaded.pageIndex)
        assertEquals(6, loaded.pageOffset)
    }

    @Test
    fun relaysDefaultsToNomadWikiWhenMissing() {
        val repository = SettingsRepository(context)
        assertEquals(listOf("wss://relay.nomadwiki.org"), repository.relays)
    }

    @Test
    fun pdfZoomClampsBeforePersisting() {
        val repository = SettingsRepository(context)

        repository.savePdfZoom("book-id", 8f)
        assertEquals(5f, repository.pdfZoom("book-id"))
        repository.savePdfZoom("book-id", 0.2f)
        assertEquals(1f, repository.pdfZoom("book-id"))
    }

    @Test
    fun pdfZoomDefaultsTo1WhenMissing() {
        val repository = SettingsRepository(context)
        assertEquals(1f, repository.pdfZoom("missing-book"))
    }

    @Test
    fun readerSessionFallsBackToDefaultsForInvalidFormatAndNegativeOffsets() {
        val repository = SettingsRepository(context)
        val prefs = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("reader_book_id", "book-1")
            .putString("reader_book_title", "Cached title")
            .putString("reader_format", "mobi")
            .putString("reader_locator", "")
            .putInt("reader_page", -10)
            .putInt("reader_offset", -11)
            .apply()

        val loaded = repository.readerSession()
        assertNotNull(loaded)
        assertEquals(BookFormat.Epub, loaded!!.format)
        assertEquals(0, loaded.pageIndex)
        assertEquals(0, loaded.pageOffset)
    }

    @Test
    fun readerSessionReturnsNullWhenBookIdIsEmpty() {
        val repository = SettingsRepository(context)
        val prefs = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("reader_book_id", "   ")
            .putString("reader_book_title", "Blank")
            .putString("reader_format", "epub")
            .apply()

        assertEquals(null, repository.readerSession())
    }

    @Test
    fun readerSessionReturnsBlankOptionalMetadataAsNull() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "book-empty-meta",
                bookTitle = "   ",
                format = BookFormat.Epub,
                author = "   ",
                year = "   ",
                locator = "   ",
                pageIndex = 5,
                pageOffset = 6,
            ),
        )

        val loaded = repository.readerSession()
        assertEquals("Book", loaded!!.bookTitle)
        assertEquals(null, loaded.author)
        assertEquals(null, loaded.year)
        assertEquals(null, loaded.locator)
        assertEquals(5, loaded.pageIndex)
        assertEquals(6, loaded.pageOffset)
    }

    @Test
    fun readerSessionReturnsNullWhenBookIdIsMissingFromStorage() {
        val repository = SettingsRepository(context)
        context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
            .edit()
            .putString("reader_book_title", "Recovered")
            .putInt("reader_page", 1)
            .putInt("reader_offset", 2)
            .apply()

        assertEquals(null, repository.readerSession())
    }

    @Test
    fun bookFormatFromDefaultsToEpubWhenValueUnknownAndUrlNotPdf() {
        assertEquals(BookFormat.Epub, BookFormat.from("weird", "https://example.test/book.epub"))
    }

    @Test
    fun bookFormatFromFallsBackToPdfFromUrlPathExtension() {
        assertEquals(BookFormat.Pdf, BookFormat.from("unknown", "https://example.test/book.pdf?download=1"))
    }

    @Test
    fun bookFormatFromFallsBackToPdfFromUrlPathExtensionWithUppercase() {
        assertEquals(BookFormat.Pdf, BookFormat.from("unknown", "https://example.test/book.PDF#chapter"))
    }

    @Test
    fun bookFormatFromFallsBackToEpubWhenPdfIsPartOfFilenameButNotSuffix() {
        assertEquals(BookFormat.Epub, BookFormat.from("unknown", "https://example.test/my.pdf.story"))
    }

    @Test
    fun bookFormatFromDefaultsToEpubWhenValueIsNull() {
        assertEquals(BookFormat.Epub, BookFormat.from(null, "https://example.test/book.mobi"))
    }

    @Test
    fun bookFormatFromFallsBackToEpubWhenPdfHintIsOnlyInQuery() {
        assertEquals(BookFormat.Epub, BookFormat.from("mobi", "https://example.test/download?file=book.PDF"))
    }

    @Test
    fun bookFormatFromFallsBackToEpubWhenValueIsBlankAndUrlIsNotPdf() {
        assertEquals(BookFormat.Epub, BookFormat.from("   ", "https://example.test/book.mobi"))
    }

    @Test
    fun bookFormatFromExplicitEpubOverridesPdfURLHint() {
        assertEquals(BookFormat.Epub, BookFormat.from(" EPUB ", "https://example.test/download?file=book.PDF"))
    }

    @Test
    fun bookFormatFromExplicitPdfOverridesEpubURLSuffix() {
        assertEquals(BookFormat.Pdf, BookFormat.from(" PDF ", "https://example.test/guide.epub?download=1"))
    }

    @Test
    fun bookFormatFromExplicitPdfOverridesEmptyUrl() {
        assertEquals(BookFormat.Pdf, BookFormat.from(" PDF ", ""))
    }

    @Test
    fun keepReadingOnLockScreenDefaultsToTrueAndPersists() {
        val repository = SettingsRepository(context)
        assertEquals(true, repository.keepReadingOnLockScreen)

        repository.keepReadingOnLockScreen = false
        assertEquals(false, repository.keepReadingOnLockScreen)
    }

    @Test
    fun keepReadingOnLockScreenPersistsAcrossInstances() {
        val repository = SettingsRepository(context)
        repository.keepReadingOnLockScreen = false
        assertEquals(false, repository.keepReadingOnLockScreen)

        val reload = SettingsRepository(context)
        assertEquals(false, reload.keepReadingOnLockScreen)

        reload.keepReadingOnLockScreen = true
        assertEquals(true, SettingsRepository(context).keepReadingOnLockScreen)
    }

    @Test
    fun wordSortDefaultsToRecentAndPersistsCustomValue() {
        val repository = SettingsRepository(context)
        assertEquals("recent", repository.wordSort)

        repository.wordSort = "alpha"
        assertEquals("alpha", repository.wordSort)
    }

    @Test
    fun wordSortPersistsAcrossInstances() {
        val repository = SettingsRepository(context)
        repository.wordSort = "frequency"

        assertEquals("frequency", SettingsRepository(context).wordSort)
    }

    @Test
    fun relaysParsesStoredStringWithWhitespaceAndCommas() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit()
            .putString("relays", "\n  wss://a.io \n, wss://b.io,\n\nwss://c.io,   ")
            .apply()
        val repository = SettingsRepository(context)

        assertEquals(listOf("wss://a.io", "wss://b.io", "wss://c.io"), repository.relays)
        repository.relays = listOf("wss://one", "wss://two")
        assertEquals("wss://one\nwss://two", preferences.getString("relays", null))
    }

    @Test
    fun relaysDefaultsToEmptyListWhenStoredValueIsBlank() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("relays", "").apply()
        val repository = SettingsRepository(context)

        assertEquals(emptyList<String>(), repository.relays)
    }

    @Test
    fun relaysDefaultsToEmptyListWhenStoredValueIsWhitespace() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("relays", "   ,   ").apply()
        val repository = SettingsRepository(context)

        assertEquals(emptyList<String>(), repository.relays)
    }

    @Test
    fun relaysDefaultsToEmptyListWhenStoredValueHasOnlyCommasAndWhitespace() {
        val preferences = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
        preferences.edit().putString("relays", ",,,  , ").apply()
        val repository = SettingsRepository(context)

        assertEquals(emptyList<String>(), repository.relays)
    }

    @Test
    fun cacheNostrFavoritesStoresPubkeyInLowercase() {
        val repository = SettingsRepository(context)
        val securePreferences = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)

        repository.cacheNostrFavorites("AbC123", "[\"e\",\"1\"]")

        assertEquals("abc123", securePreferences.getString("nostr_favorites_cache_pubkey", null))
        assertEquals("[\"e\",\"1\"]", securePreferences.getString("nostr_favorites_cache_content", null))
        assertEquals("[\"e\",\"1\"]", repository.cachedNostrFavorites("ABC123"))
    }

    @Test
    fun dictionaryDefaultsAndCustomValuesPersistAcrossInstances() {
        val repository = SettingsRepository(context)

        assertEquals("en", repository.dictionarySource)
        assertEquals("pt", repository.dictionaryTarget)

        repository.dictionarySource = "es"
        repository.dictionaryTarget = "fr"

        val reload = SettingsRepository(context)
        assertEquals("es", reload.dictionarySource)
        assertEquals("fr", reload.dictionaryTarget)
    }

    @Test
    fun cachedFavoritesIgnoresBlankPayloadContent() {
        val repository = SettingsRepository(context)
        repository.cacheNostrFavorites("abc", "   ")
        assertEquals(null, repository.cachedNostrFavorites("ABC"))
    }

    @Test
    fun cacheNostrFavoritesRewritesExistingCachedContent() {
        val repository = SettingsRepository(context)

        repository.cacheNostrFavorites("AbC", "[\"old\"]")
        repository.cacheNostrFavorites("abc", "[\"new\"]")

        assertEquals("[\"new\"]", repository.cachedNostrFavorites("ABC"))
    }

    @Test
    fun readerSessionDefaultsMissingOptionalMetadataFieldsToNull() {
        val repository = SettingsRepository(context)
        val securePreferences = context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
        securePreferences.edit()
            .putString("reader_book_id", "book-optional-missing")
            .putString("reader_book_title", "Recovered")
            .putString("reader_format", "epub")
            .putInt("reader_page", 4)
            .putInt("reader_offset", 5)
            .apply()

        val loaded = repository.readerSession()
        assertNotNull(loaded)
        assertEquals("book-optional-missing", loaded!!.bookId)
        assertEquals("Recovered", loaded.bookTitle)
        assertEquals(null, loaded.author)
        assertEquals(null, loaded.year)
        assertEquals(null, loaded.locator)
        assertEquals(4, loaded.pageIndex)
        assertEquals(5, loaded.pageOffset)
    }

    @Test
    fun readerSessionReturnsNullWhenBookIdIsWhitespace() {
        val repository = SettingsRepository(context)
        repository.saveReaderSession(
            ReaderSession(
                bookId = "   ",
                bookTitle = "Blank",
                format = BookFormat.Epub,
            ),
        )

        assertEquals(null, repository.readerSession())
    }

    @Test
    fun dictionaryDefaultsAndPersist() {
        val repository = SettingsRepository(context)
        assertEquals("en", repository.dictionarySource)
        assertEquals("pt", repository.dictionaryTarget)

        repository.dictionarySource = "pt"
        repository.dictionaryTarget = "en"

        assertEquals("pt", repository.dictionarySource)
        assertEquals("en", repository.dictionaryTarget)
    }

    @Test
    fun pdfZoomPersistsAndClampsValuesPerBook() {
        val repository = SettingsRepository(context)
        repository.savePdfZoom("book-A", 8f)
        assertEquals(5f, repository.pdfZoom("book-A"))
        repository.savePdfZoom("book-B", 0.5f)
        assertEquals(1f, repository.pdfZoom("book-B"))
        repository.savePdfZoom("book-C", 2.5f)
        assertEquals(2.5f, repository.pdfZoom("book-C"))
    }

    private fun clearStoredSettings() {
        context.deleteSharedPreferences("bookstr_settings")
        context.deleteSharedPreferences("bookstr_secure")
    }
}
