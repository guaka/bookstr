package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositoryTest {
    @Test
    fun parsesAndPrioritizesReadableWebSearchResults() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":42,"source":"openlibrary","title":"Metadata","authors":"A Writer"},
              {"id":1342,"source":"gutenberg","title":"Pride and Prejudice","authors":"Jane Austen","issued":"1998-06-01","language":"en","avg_rating":4.21}
            ]}""",
        )

        assertEquals("gutenberg:1342", results.first().id)
        assertEquals("1998", results.first().year)
        assertEquals(BookFormat.Epub, results.first().format)
        assertTrue(results.first().isReadable)
        assertTrue(results.first().downloadUrl!!.endsWith("/books/1342/download"))
        assertFalse(results.last().isReadable)
    }

    @Test
    fun hidesNullMetadataFromSearchResults() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"7","source":"openlibrary","title":null,"author":"NULL","publisher":"null","language":null,"year":"NULL","url":null}]}""",
        ).single()

        assertEquals("Untitled", result.title)
        assertEquals("Unknown author", result.author)
        assertEquals(null, result.publisher)
        assertEquals(null, result.language)
        assertEquals(null, result.year)
        assertEquals(null, result.downloadUrl)
    }

    @Test
    fun skipsInvalidRowsWithoutConsumingResultLimit() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":null,"title":"No identity"},
              {"id":"one","title":"First"},
              {"id":"two","title":"Second"},
              {"id":"three","title":"Third"}
            ]}""",
            limit = 2,
        )

        assertEquals(2, results.size)
        assertEquals(setOf("all.books.party:one", "all.books.party:two"), results.map { it.id }.toSet())
    }

    @Test
    fun usesSourceNativeIdWhenPrimaryIdIsMissing() {
        val result = CatalogRepository.parseSearchResponse(
            """{"books":[{"source":"OPENLIBRARY","source_native_id":"OL1M","title":"Book"}]}""",
        ).single()

        assertEquals("openlibrary:OL1M", result.id)
        assertEquals("Unknown author", result.author)
        assertFalse(result.isReadable)
        assertEquals(null, result.asCatalogBook())
    }

    @Test
    fun convertsReadablePdfResultWithoutLosingMetadata() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{
              "id":"pdf-1","source":"archive","title":"A PDF","author":"Writer",
              "year":"2025","format":"pdf","url":"https://example.org/a.pdf","cover_id":"88"
            }]}""",
        ).single()
        val book = result.asCatalogBook()!!

        assertTrue(result.isReadable)
        assertEquals(BookFormat.Pdf, book.format)
        assertEquals("2025", book.year)
        assertEquals("https://example.org/a.pdf", book.sourceUrl)
        assertEquals("https://covers.openlibrary.org/b/id/88-M.jpg", book.coverUrl)
    }

    @Test
    fun zeroLimitReturnsNoSearchResults() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"one","title":"First"}]}""",
            limit = 0,
        )

        assertTrue(results.isEmpty())
    }

    @Test
    fun infersBookFormatFromExplicitValueOrUrl() {
        assertEquals(BookFormat.Pdf, BookFormat.from(" PDF "))
        assertEquals(BookFormat.Epub, BookFormat.from("EPUB"))
        assertEquals(BookFormat.Pdf, BookFormat.from(null, "https://example.org/file.PDF?download=1"))
        assertEquals(BookFormat.Epub, BookFormat.from(null, "https://example.org/file.epub"))
    }

    @Test
    fun malformedAndEmptySearchPayloadsAreHandledPredictably() {
        assertTrue(CatalogRepository.parseSearchResponse("{}").isEmpty())
        assertTrue(CatalogRepository.parseSearchResponse("""{"results":[]}""").isEmpty())
    }

    @Test(expected = org.json.JSONException::class)
    fun malformedSearchJsonIsRejected() {
        CatalogRepository.parseSearchResponse("not json")
    }

    @Test
    fun readableResultsSortBeforeMetadataOnlyResultsStably() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"meta-1","title":"Metadata one"},
              {"id":"read-1","title":"Readable one","format":"epub","url":"https://example.org/1.epub"},
              {"id":"meta-2","title":"Metadata two"},
              {"id":"read-2","title":"Readable two","format":"pdf","url":"https://example.org/2.pdf"}
            ]}""",
        )

        assertEquals(listOf(true, true, false, false), results.map { it.isReadable })
        assertEquals(listOf("Readable one", "Readable two"), results.take(2).map { it.title })
        assertEquals(listOf("Metadata one", "Metadata two"), results.takeLast(2).map { it.title })
    }

    @Test
    fun undefinedUrlsDoNotCreateReadableResults() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"1","format":"epub","url":"undefined","link":"NULL"}]}""",
        ).single()

        assertEquals(null, result.downloadUrl)
        assertFalse(result.isReadable)
    }

    @Test
    fun negativeLimitReturnsNoSearchResults() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"one"}]}""",
            limit = -1,
        )

        assertTrue(results.isEmpty())
    }
}
