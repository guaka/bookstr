package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositoryExtraCoverageTest {
    @Test
    fun fromBlossomFavoriteInfersPdfFormatWhenDeclaredFormatUnknown() {
        val sha = "c".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Unknown format favorite",
                author = "Author",
                year = "2025",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "mystery",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha?download=1#page=1",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals("https://blossom.bfr.ee/$sha?download=1#page=1", book?.epubUrl)
        assertEquals(BookFormat.Pdf, book?.format)
        assertEquals("Author", book?.author)
    }

    @Test
    fun parseSearchResultInfersFormatFromUrlEvenWithUnsupportedDeclaredType() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"x","source":"archive","title":"A book","format":"mobi","url":"https://example.org/book.EPUB"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Epub, results.first().format)
        assertEquals("https://example.org/book.EPUB", results.first().downloadUrl)
    }

    @Test
    fun fromBlossomFavoriteRejectsWrongHostEvenWithValidHash() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Wrong host",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = "d".repeat(64),
                blossomUrl = "https://evil.example/${"d".repeat(64)}",
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteAcceptsUppercaseFormatToken() {
        val sha = "9".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Uppercase format",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "PDF",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha",
            ),
        )

        assertEquals(BookFormat.Pdf, book?.format)
    }

    @Test
    fun fromBlossomFavoriteRejectsHttpBlossomUrlEvenWithValidHash() {
        val sha = "f".repeat(64)
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                ExternalFavorite(
                    key = "legacy-key",
                    title = "Blocked scheme",
                    author = "Author",
                    year = null,
                    url = "https://books-api.guaka.org/api/books/1/download",
                    isbn = null,
                    libvaultMd5 = null,
                    format = "epub",
                    blossomSha256 = sha,
                    blossomUrl = "http://blossom.bfr.ee/$sha",
                ),
            ),
        )
    }

    @Test
    fun fromBlossomFavoriteInfersFormatFromBlossomUrlExtensionWhenFormatMissing() {
        val sha = "e".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Extension-aware",
                author = "Author",
                year = "2026",
                url = null,
                isbn = null,
                libvaultMd5 = null,
                format = null,
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha.pdf?download=1",
            ),
        )

        assertEquals(BookFormat.Pdf, book?.format)
        assertEquals("https://blossom.bfr.ee/$sha.pdf?download=1", book?.epubUrl)
    }

    @Test
    fun fromBlossomFavoriteRejectsInvalidSha256Hash() {
        val invalidSha = "z".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Invalid sha",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = invalidSha,
                blossomUrl = "https://blossom.bfr.ee/$invalidSha",
            ),
        )

        assertNull(book)
    }

    @Test
    fun parseSearchResponseAcceptsMalformedTitleButSkipsInvalidIdentity() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":null,"title":"Should skip"},
              {"source_native_id":"M1","source":"openlibrary","title":"  good  ","author":"Writer","url":"https://example.org/good.epub","format":"epub"},
              {"id":"","title":"", "format":"epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("openlibrary:M1", results[0].id)
        assertEquals("good", results[0].title)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/good.epub", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseSkipsMalformedRowsAndDefaultsSource() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              "bad-item",
              null,
              {"id":null,"title":"No identity"},
              {"source":"  OPENBOOK  ","source_native_id":"  X1  ","title":"Readable","url":"https://example.org/story.EPUB"},
              {"source_native_id":"  ","id":"ignored","format":"pdf","url":"https://example.org/doc.pdf"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("openbook:X1", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/story.EPUB", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun fromBlossomFavoriteRejectsMalformedBlossomUrl() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Malformed blossom",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = "a".repeat(64),
                blossomUrl = "https://[::1",
            ),
        )

        assertNull(book)
    }

    @Test
    fun parseSearchResponseHonorsSourceNativeIdAndNumericIdForSeparateRows() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"GUTENBERG","id":1234,"title":"Has numeric source id"},
              {"source":"GUTENBERG","source_native_id":"4567","title":"Has native id"}
            ]}""",
        )

        assertEquals("gutenberg:1234", results[0].id)
        assertEquals("gutenberg:4567", results[1].id)
        assertEquals(2, results.size)
    }

    @Test
    fun parseSearchResponseBuildsGutenbergDownloadUrlWhenFormatMissing() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"GUTENBERG","id":"9876","title":"No explicit format"},
              {"source":"archive","id":"skip"}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals("gutenberg:9876", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://books-api.guaka.org/api/books/9876/download", results[0].downloadUrl)
        assertEquals("gutenberg", results[0].source)
    }

    @Test
    fun parseSearchResponseHonorsNegativeLimitAsEmpty() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[{"source":"openlibrary","id":"1","title":"One","url":"https://example.org/one.epub"}]}""",
            -1,
        )

        assertTrue(results.isEmpty())
    }

    @Test
    fun parseSearchResponseReadsKnownExtensions() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"one","source":"archive","title":"From extension","extension":"pdf","readUrl":"https://example.org/file.bin"},
              {"id":"two","source":"archive","title":"From fallback","extension":"txt","url":"https://example.org/file.txt"},
              {"id":"three","source":"archive","title":"Missing extension","url":"https://example.org/file"}
            ]}""",
        )

        assertEquals(3, results.size)
        assertEquals("all.books.party:one", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertTrue(results[0].isReadable)
        assertEquals("all.books.party:two", results[1].id)
        assertEquals(null, results[1].format)
        assertFalse(results[1].isReadable)
        assertEquals("all.books.party:three", results[2].id)
        assertEquals(null, results[2].format)
        assertFalse(results[2].isReadable)
    }

    @Test
    fun parseSearchResponseTrimsExtensionWhitespace() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"whitespace","source":"archive","title":"Whitespace extension","extension":"  PDF  ","url":"https://example.org/file.txt"},
              {"id":"blank-extension","source":"archive","title":"Blank extension","extension":"  ","url":"https://example.org/file.epub"}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:whitespace", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertTrue(results[0].isReadable)
        assertEquals("all.books.party:blank-extension", results[1].id)
        assertEquals(BookFormat.Epub, results[1].format)
        assertTrue(results[1].isReadable)
    }

    @Test
    fun parseSearchResponseUsesUnknownExtensionEvenWhenUrlLooksPdf() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"legacy","source":"archive","title":"Unknown extension","extension":"txt","url":"https://example.org/story.PDF"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(null, results[0].format)
        assertEquals("https://example.org/story.PDF", results[0].downloadUrl)
        assertFalse(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsUndefinedToken() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"undefined","id":"default","title":"Defaulted source","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:default", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsNullToken() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"NULL","id":"null-source","title":"Nulled source","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:null-source", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseUsesUntitledForBlankTitle() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"archive","id":"untitled","title":"", "url":"https://example.org/book.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("Untitled", results[0].title)
    }

    @Test(expected = org.json.JSONException::class)
    fun parseSearchResponseRejectsArrayPayload() {
        CatalogRepository.parseSearchResponse("[]")
    }

    @Test(expected = org.json.JSONException::class)
    fun parseSearchResponseRejectsPrimitivePayloads() {
        CatalogRepository.parseSearchResponse("false")
    }

    @Test
    fun parseSearchResponseUsesLinkWhenReadUrlAndUrlAreMissing() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"unavailable","source":"archive","title":"Missing links"},
              {"id":"readable","source":"archive","title":"Link only","link":"https://example.org/book.EPUB"},
              {"source_native_id":"MISSING-NATIVE","source":"all.books.party","title":"No identifier"}
            ]}"""
        )

        assertEquals(2, results.size)
        assertEquals("archive:readable", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/book.EPUB", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseTrimsAndNormalizesSourceNativeIdWithoutIdField() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":" GUTENBERG ","source_native_id":"  3121  ","title":"Native ID spacing"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("gutenberg:3121", results[0].id)
        assertEquals("https://books-api.guaka.org/api/books/3121/download", results[0].downloadUrl)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseSearchResponseBuildsGutenbergDownloadUrlFromSourceIdWhenNoFormatPresent() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"1234","source":"gutenberg","title":"Gutenberg canonical source"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("gutenberg:1234", results[0].id)
        assertEquals("https://books-api.guaka.org/api/books/1234/download", results[0].downloadUrl)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseSkipsNullishDownloadFieldsAndUsesReadableAlternate() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"nullish","source":"archive","title":"Null-ish links","format":"epub","readUrl":"null","url":"UNDEFINED","link":"  "},
              {"id":"readable","source":"archive","title":"Readable","format":"txt","url":"https://example.org/story.PDF"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("readable", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/story.PDF", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseHonorsZeroLimitAsEmpty() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"one","source":"archive","title":"One","url":"https://example.org/one.epub"}]}""",
            0,
        )

        assertTrue(results.isEmpty())
    }

    @Test
    fun parseSearchResponseFallsBackToLinkWhenDeclaredFormatIsUnsupportedAndUrlIsNullish() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"fallback","source":"archive","title":"Fallback link","format":"mobi","url":"undefined","link":"https://example.org/read.PDF?download=1"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/read.PDF?download=1", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseSkipsNonObjectRowsWithoutConsumingConfiguredLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              "garbage",
              {"id":"one","title":"First","url":"https://example.org/one.epub"},
              {"id":"two","title":"Second","url":"https://example.org/two.epub"}
            ]}""",
            2,
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:one", results[0].id)
        assertEquals("all.books.party:two", results[1].id)
    }

    @Test
    fun parseSearchResponsePrioritizesBooksArrayEvenWhenItContainsNonObjectRows() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":["not-an-object"], "results":[{"id":"fallback","title":"Fallback","url":"https://example.org/fallback.epub"}]}"""
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseSearchResponseUsesSourceNativeIdWhenIdIsBlank() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"   ","source":"OPENLIBRARY","source_native_id":"OL777M","title":"Trimmed id","url":"https://example.org/trim.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("openlibrary:OL777M", results[0].id)
        assertEquals("https://example.org/trim.epub", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseRejectsUnsupportedExplicitFormatWhenDownloadIsNotPdfOrEpub() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"other","source":"archive","title":"No extension","format":"mobi","url":"https://example.org/book.txt"},
              {"id":"readable","title":"Fallback","url":"https://example.org/read.epub"}
            ]}"""
        )

        assertEquals(2, results.size)
        assertEquals("archive:other", results[0].id)
        assertEquals(null, results[0].format)
        assertFalse(results[0].isReadable)
        assertEquals("archive:readable", results[1].id)
        assertEquals(BookFormat.Epub, results[1].format)
        assertTrue(results[1].isReadable)
    }

    @Test
    fun fromBlossomFavoriteAcceptsUppercaseHostAndUppercaseHash() {
        val sha = "A".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Casey blossom",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "https://Blossom.BFR.ee/$sha?download=1#reader",
            ),
        )

        assertEquals(sha.lowercase(), book?.id)
        assertEquals("https://blossom.bfr.ee/$sha?download=1#reader", book?.epubUrl)
        assertEquals(BookFormat.Pdf, book?.format)
    }

    @Test
    fun fromBlossomFavoriteRejectsMissingBlossomUrl() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Missing blossom URL",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = "a".repeat(64),
                blossomUrl = null,
            ),
        )

        assertNull(book)
    }

    @Test
    fun parseSearchResponseUsesExplicitFormatBeforeURLInference() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"1","source":"archive","title":"Format-mismatch","url":"https://example.org/readme.epub","format":"pdf"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results.first().format)
    }

    @Test
    fun parseSearchResponsePrefersUppercaseExtensionOverExplicitFormat() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"ext-upper","source":"archive","title":"Uppercase extension","format":"mobi","extension":"PDF","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/story.epub", results[0].downloadUrl)
    }

    @Test
    fun fromBlossomFavoriteAcceptsUppercaseHttpsScheme() {
        val sha = "d".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Uppercase https",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "pdf",
                blossomSha256 = sha,
                blossomUrl = "HTTPS://BLOSSOM.BFR.EE/$sha",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Pdf, book?.format)
        assertEquals(true, book?.epubUrl?.startsWith("https://blossom.bfr.ee/$sha"))
    }

    @Test
    fun bookFormatDefaultsToEpubWhenNoHintsAreAvailable() {
        assertEquals(BookFormat.Epub, BookFormat.from(null, "https://example.org/book.bin"))
        assertEquals(BookFormat.Epub, BookFormat.from("   ", "https://example.org/book.bin"))
    }

    @Test
    fun parseSearchResponsePrefersReadUrlBeforeUrlWhenBothExist() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"readurl","source":"archive","title":"ReadUrl precedence","format":"mobi","readUrl":"https://example.org/reader.PDF","url":"https://example.org/reader.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("https://example.org/reader.PDF", results[0].downloadUrl)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseInfersPdfFromUrlWithQueryAndFragment() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"query-frag","source":"archive","title":"Fragment URL", "url":"https://example.org/story.PDF?download=1#page=2"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:query-frag", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/story.PDF?download=1#page=2", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseSkipsUndefinedAndBlankIdentifiersAfterSourceCleanup() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"archive","id":"UNDEFINED","source_native_id":"", "title":"No id","url":"https://example.org/no-id.epub"},
              {"source":"archive","id":"", "source_native_id":"  ", "title":"No id either","readUrl":"https://example.org/no-id-2.epub"},
              {"source":"archive","id":"keep-me","title":"Kept","url":"https://example.org/kept.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:keep-me", results[0].id)
        assertEquals("Kept", results[0].title)
    }

    @Test
    fun parseSearchResponseInfersUrlFormatBeforeApplyingSourceFallback() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"archive","id":"fallback","title":"Fallback source","source_native_id":"999","readUrl":"null","url":"https://example.org/story.PDF","format":"mobi"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:fallback", results[0].id)
        assertEquals("https://example.org/story.PDF", results[0].downloadUrl)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseSortsReadableResultsBeforeUnreadable() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"unread","source":"archive","title":"Unread","format":"mobi","url":"https://example.org/unread.txt"},
              {"id":"read","source":"archive","title":"Read","url":"https://example.org/read.epub"}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:read", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
        assertEquals("all.books.party:unread", results[1].id)
        assertEquals(null, results[1].format)
        assertFalse(results[1].isReadable)
    }

    @Test
    fun parseSearchResponsePrefersEmptyBooksArrayOverResults() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[], "results":[
              {"id":"from-results","title":"Should be ignored","url":"https://example.org/ignore.epub"}
            ]}""",
        )

        assertTrue(results.isEmpty())
    }

    @Test
    fun parseSearchResponseStopsAfterValidBookItemsDespiteMalformedBooksRows() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[
              null,
              {"id":"one","title":"Books valid","url":"https://example.org/one.epub"},
              {"id":"two","title":"Books ignored","url":"https://example.org/two.epub"}
            ],
            "results":[{"id":"from-results","title":"Should be ignored","url":"https://example.org/ignore.epub"}]
            }""",
            1,
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:one", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }
}
