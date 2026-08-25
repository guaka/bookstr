package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogRepositoryExtraCoverageAdditionalTest {
    @Test
    fun parseSearchResponseSkipsNonObjectBookEntriesWhenBooksShapeIsPreferred() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[
              null,
              "not-an-object",
              {"id":"book-from-books","source":"archive","title":"From books","format":"epub","url":"https://example.org/books/book.epub"},
              {"source":"openlibrary","source_native_id":"  OL1M  ","title":"From source-native-id","url":"https://example.org/books/with-native-id.epub"}
            ],"results":[{"id":"ignored","title":"Ignored"}]}"""
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:book-from-books", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/books/book.epub", results[0].downloadUrl)
        assertEquals("openlibrary:OL1M", results[1].id)
        assertEquals("https://example.org/books/with-native-id.epub", results[1].downloadUrl)
        assertTrue(results[0].isReadable)
        assertTrue(results[1].isReadable)
    }

    @Test
    fun parseSearchResponseIgnoresResultsWhenBooksArrayHasNoObjectRows() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[
              1,
              "not-an-object",
              null
            ],"results":[
              {"id":"fallback","title":"Ignored result","url":"https://example.org/fallback.epub"}
            ]}"""
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseSearchResponseAcceptsNumericIdAsSourceIdentity() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"GUTENBERG","id":1234,"title":"Numeric id","format":"pdf","url":"https://example.org/book.pdf"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("gutenberg:1234", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/book.pdf", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseFallsBackToResultsWhenBooksPayloadIsNotAnArray() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":{"id":"ignored","title":"ignored"}, "results":[
              {"source":"archive","id":"fallback","title":"Used results","url":"https://example.org/read.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("archive:fallback", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/read.epub", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseSkipsEmptyObjectRowsWithoutUsingThemAsIdentity() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {},
              {"id":"valid","source":"openlibrary","title":"Valid","format":"pdf","url":"https://example.org/valid.pdf"},
              {"source":"openlibrary","title":"Another missing id","url":"https://example.org/missing.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("openlibrary:valid", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/valid.pdf", results[0].downloadUrl)
    }

    @Test
    fun parseSearchResponseDefaultsToReadableMetadataFormatWhenAllLinksAreInvalid() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"formatless","source":"archive","title":"Formatless linkless","readUrl":"undefined","url":"null","link":"NULL"}
            ]}"""
        ).single()

        assertEquals(BookFormat.Epub, result.format)
        assertEquals(null, result.downloadUrl)
        assertFalse(result.isReadable)
    }

    @Test
    fun parseSearchResponseUsesRatingFallbackWhenAvgRatingIsMissing() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"rating","source":"archive","title":"Rating fallback","url":"https://example.org/book.epub","rating":4.2}
            ]}"""
        ).single()

        assertEquals(4.2, result.rating, 0.0)
    }

    @Test
    fun parseSearchResponsePrioritizesIdOverSourceNativeId() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"preferred","source_native_id":"fallback","source":"archive","title":"Preferred id","url":"https://example.org/book.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("archive:preferred", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://example.org/book.epub", results[0].downloadUrl)
    }

    @Test
    fun fromBlossomFavoriteFallsBackToEpubAndUnknownAuthorWhenFormatIsInvalid() {
        val sha = "b".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Unknown format",
                author = null,
                year = "2026",
                url = "https://example.org/legacy.bin",
                isbn = "978-0-00-000000-0",
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Epub, book?.format)
        assertEquals("Unknown", book?.author)
    }

    @Test
    fun fromBlossomFavoriteFallsBackToPdfWhenExplicitFormatIsUnknownButUrlIsPdf() {
        val sha = "d".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Fallback via URL",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha/read.PDF?download=1",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Pdf, book?.format)
        assertEquals("Author", book?.author)
    }

    @Test
    fun fromBlossomFavoriteAcceptsUppercaseIdentityAndHost() {
        val sha = "A".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Uppercase identity",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "HTTPS://BLOSSOM.BFR.EE/${sha.lowercase()}",
            ),
        )

        assertEquals("a".repeat(64), book?.id)
        assertEquals("https://blossom.bfr.ee/${sha.lowercase()}", book?.epubUrl)
        assertEquals("https://blossom.bfr.ee/${sha.lowercase()}", book?.sourceUrl)
        assertEquals(BookFormat.Epub, book?.format)
    }

    @Test
    fun fromBlossomFavoriteRejectsEmptyBlossomUrl() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Missing URL",
                author = "Author",
                year = "2024",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = "c".repeat(64),
                blossomUrl = null,
            ),
        )

        assertEquals(null, book)
    }

    @Test
    fun fromBlossomFavoriteRejectsInvalidBlossomUrlWhenDirectUrlIsUsable() {
        val sha = "f".repeat(64)
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                ExternalFavorite(
                    key = "legacy-key",
                    title = "Invalid blossom",
                    author = "Author",
                    year = null,
                    url = "https://example.org/legacy.epub",
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
    fun fromBlossomFavoriteRejectsMalformedBlossomUrlDespiteUsableIdentity() {
        val sha = "a".repeat(64)
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                ExternalFavorite(
                    key = "legacy-key",
                    title = "Malformed blossom",
                    author = "Author",
                    year = "2026",
                    url = "https://example.org/legacy.epub",
                    isbn = null,
                    libvaultMd5 = null,
                    format = "pdf",
                    blossomSha256 = sha,
                    blossomUrl = "  https://blossom.bfr.ee/$sha",
                ),
            ),
        )
    }

    @Test
    fun parseSearchResponseCountsUnreadableItemsTowardLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"unread","source":"archive","title":"No url","format":"mobi"},
              {"id":"read","source":"archive","title":"Readable","url":"https://example.org/read.epub"},
              {"id":"later","source":"archive","title":"Later","url":"https://example.org/later.epub"}
            ]}""",
            2,
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:read", results[0].id)
        assertEquals("all.books.party:unread", results[1].id)
        assertTrue(results[0].isReadable)
        assertFalse(results[1].isReadable)
    }

    @Test
    fun parseSearchResponseFallsBackToRatingFieldWhenAvgRatingIsMalformed() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {
                "id":"rating",
                "source":"archive",
                "title":"Malformed avg rating",
                "avg_rating":"n/a",
                "rating":4.9,
                "edition_count":"not-a-number",
                "url":"https://example.org/read.epub"
              }
            ]}"""
        ).single()

        assertEquals(4.9, result.rating, 0.0)
        assertEquals(0, result.editionCount)
    }

    @Test
    fun parseSearchResponseDefaultsEditionCountAndRatingWhenTheyAreMalformedStrings() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {
                "id":"malformed-metadata",
                "source":"archive",
                "title":"No numeric metadata",
                "avg_rating":"bad",
                "rating":"also-bad",
                "edition_count":"bad-number",
                "url":"https://example.org/read.epub"
              }
            ]}"""
        ).single()

        assertEquals(0.0, result.rating, 0.0)
        assertEquals(0, result.editionCount)
    }

    @Test
    fun parseSearchResponseUsesIssuedDateForYearField() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {
                "id":"issued-date",
                "source":"archive",
                "title":"Issued date metadata",
                "issued":"2029-12-24T11:00:00Z",
                "url":"https://example.org/read.epub"
              }
            ]}"""
        ).single()

        assertEquals("2029", result.year)
    }

    @Test
    fun parseSearchResponseFallsBackToLinkWhenUrlIsMissing() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[
              {
                "id":"link-only",
                "source":"archive",
                "title":"Fallback from link",
                "format":"mobi",
                "url":"undefined",
                "link":"https://example.org/story.pdf"
              }
            ]}"""
        ).single()

        assertEquals(BookFormat.Pdf, result.format)
        assertEquals("https://example.org/story.pdf", result.downloadUrl)
        assertTrue(result.isReadable)
    }

    @Test
    fun parseSearchResponseIgnoresMalformedRowsWhenApplyingLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              "ignored",
              {"id":"first","source":"archive","title":"First","url":"https://example.org/first.epub"},
              12,
              {"id":"second","source":"archive","title":"Second","url":"https://example.org/second.epub"}
            ]}""",
            2,
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:first", results[0].id)
        assertEquals("all.books.party:second", results[1].id)
    }

    @Test
    fun parseSearchResponseIgnoresMalformedRowsWhenApplyingLimitOnBooksPayload() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[
              "ignored",
              {"id":"first","source":"archive","title":"First","url":"https://example.org/first.epub"},
              {"id":"second","source":"archive","title":"Second","url":"https://example.org/second.epub"}
            ]}""",
            2,
        )

        assertEquals(2, results.size)
        assertEquals("all.books.party:first", results[0].id)
        assertEquals("all.books.party:second", results[1].id)
    }

    @Test
    fun parseSearchResponseUsesExtensionFieldBeforeFormat() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"format-mismatch","format":"mobi","extension":"PDF","url":"https://example.org/book.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:format-mismatch", results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/book.epub", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseReturnsEmptyWhenBooksArrayExistsButIsEmpty() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[],"results":[
              {"id":"ignored","title":"Ignored","source":"archive","url":"https://example.org/ignored.epub"}
            ]}"""
        )

        assertTrue(results.isEmpty())
    }
}
