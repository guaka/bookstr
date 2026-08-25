package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositorySearchEdgeCoverageTest {
    @Test
    fun parseSearchResponsePrefersExtensionOverDeclaredFormat() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"extension-priority","source":"archive","title":"Extension takes precedence","format":"mobi","extension":"pdf","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/story.epub", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseExtractsIssuedYearWhenDateIncludesFullTimestamp() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"year-case","source":"all.books.party","title":"Date extraction","issued":"2030-07-21","url":"https://example.org/date.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("2030", results[0].year)
    }

    @Test
    fun parseSearchResponseSkipsNullishDownloadValuesAndUsesLinkFallback() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"nullish","source":"archive","title":"Fallback to link","format":null,"readUrl":"null","url":"undefined","link":"https://example.org/fallback.PDF"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("https://example.org/fallback.PDF", results[0].downloadUrl)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test
    fun parseSearchResponseKeepsExplicitFormatWhenDownloadHintConflictsWithURL() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"format-conflict","source":"archive","title":"Conflict","format":"pdf","url":"https://example.org/read.txt"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/read.txt", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseLimitsByReadableCandidatesAndSkipsMalformedItems() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              "skip-this",
              {"id":"ok","source":"archive","title":"Readable","format":"epub","url":"https://example.org/read.epub"},
              {"id":"also","source":"archive","title":"Another","format":"epub","url":"https://example.org/another.epub"}
            ]}""",
            1,
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:ok", results[0].id)
    }

    @Test
    fun parseSearchResponseReturnsNoResultsForZeroLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"single","source":"archive","title":"Single","format":"epub","url":"https://example.org/read.epub"}
            ]}""",
            0,
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseSearchResponseReturnsNoResultsForNegativeLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"single","source":"archive","title":"Single","format":"epub","url":"https://example.org/read.epub"}
            ]}""",
            -3,
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseSearchResponseSortsReadableResultsBeforeUnreadable() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"unread","source":"archive","title":"Unread","format":"mobi","url":"https://example.org/doc.txt"},
              {"id":"readable","source":"archive","title":"Readable","format":"epub","url":"https://example.org/book.epub"}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals("archive:readable", results[0].id)
        assertEquals("archive:unread", results[1].id)
        assertTrue(results[0].isReadable)
        assertFalse(results[1].isReadable)
    }

    @Test
    fun parseSearchResponsePrefersReadUrlWhenUrlIsNullish() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"read-url","source":"archive","title":"Read URL","readUrl":"https://example.org/file.PDF?download=1#page=1","format":null,"url":"null","link":"https://ignored.example/skip"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("https://example.org/file.PDF?download=1#page=1", results[0].downloadUrl)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseUsesSourceNativeIdWhenIdIsBlank() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"  ","source":"archive","source_native_id":"native-fallback","title":"Source native fallback","format":"epub","url":"https://example.org/file.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("archive:native-fallback", results[0].id)
        assertEquals("archive", results[0].source)
    }

    @Test
    fun parseSearchResponseFallsBackToDefaultSourceWhenSourceIsMissingOrBlank() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"   ","id":"defaulted","title":"Default source","format":"pdf","url":"https://example.org/file.pdf"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:defaulted", results[0].id)
        assertEquals("all.books.party", results[0].source)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test
    fun parseSearchResponseReadsNumericIdentifiersAndInfersFormatFromUrl() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":12345,"source":"archive","title":"Numeric id","url":"https://example.org/download.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("archive:12345", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseSearchResponseFallsBackToAuthorsWhenAuthorIsUnavailable() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"authors-fallback","source":"archive","title":"Fallback author","author":"undefined","authors":"Main Author","format":"epub","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("Main Author", results[0].author)
    }

    @Test
    fun parseSearchResponseUsesDefaultSourceWhenSourceIsInvalidKeyword() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"default-source","source":"null","title":"Defaulted","url":"https://example.org/story.pdf"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:default-source", results[0].id)
        assertEquals("all.books.party", results[0].source)
    }

    @Test
    fun parseSearchResponseBuildsGutenbergDownloadUrlWhenNoReadableSourceUrlIsProvided() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"classic","source":"gutenberg","title":"Classic download","format":"", "url": "null"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("gutenberg:classic", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("https://books-api.guaka.org/api/books/classic/download", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseFallsBackToUrlInferredFormatWhenExplicitFormatIsUnsupported() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"unsupported-format","source":"archive","title":"Explicit unsupported","format":"txt","url":"https://example.org/story.PDF?download=1#page=1"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("https://example.org/story.PDF?download=1#page=1", results[0].downloadUrl)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseSkipsItemsWithoutIdentifierOrSourceNativeId() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"archive","title":"Missing id","format":"epub","url":"https://example.org/missing.epub"},
              {"source":"archive","source_native_id":"native-only","title":"Uses native id","format":"epub","url":"https://example.org/legacy.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("archive:native-only", results[0].id)
        assertEquals("Uses native id", results[0].title)
    }

    @Test
    fun parseSearchResponseLowercasesMixedCaseSourceValue() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"source-case","source":"Archive","title":"Source case","format":"epub","url":"https://example.org/source.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("archive:source-case", results[0].id)
        assertEquals("archive", results[0].source)
        assertEquals(BookFormat.Epub, results[0].format)
    }
}
