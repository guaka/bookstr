package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogRepositoryDownloadMetadataCoverageHardeningTest {
    private fun parseDownloadedBookMetadata(json: String): List<CatalogBook> {
        val companion = CatalogRepository::class.java.getDeclaredField("Companion").get(null)
        val method = companion.javaClass.getDeclaredMethod("parseDownloadedBookMetadata", String::class.java)
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        return method.invoke(companion, json) as List<CatalogBook>
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenBooksPayloadIsNotAnArray() {
        parseDownloadedBookMetadata("""{"books":"not-an-array","items":[{"id":"ignored","epubUrl":"https://example.org/ignored.epub"}]}""")
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenItemsPayloadContainsNoJSONArray() {
        parseDownloadedBookMetadata("""{"items":{"id":"not-an-array","epubUrl":"https://example.org/broken.epub"}}""")
    }

    @Test
    fun parseDownloadedBookMetadataPreservesMalformedShaAsIdButFiltersInvalidBlossomShaOnly() {
        val malformed = "z".repeat(64)
        val valid = "a".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$malformed","blossomSha256":"not-a-valid-sha","epubUrl":"https://example.org/malformed.epub","title":"Malformed id"},
              {"id":"$valid","blossomSha256":"$valid","epubUrl":"https://example.org/valid.epub","title":"Valid id"}
            ]}"""
        )

        assertEquals(2, results.size)
        assertEquals(malformed, results[0].id)
        assertEquals(null, results[0].blossomSha256)
        assertEquals(valid, results[1].blossomSha256)
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenPayloadIsTopLevelJSONArray() {
        parseDownloadedBookMetadata("""[{"id":"x","epubUrl":"https://example.org/top-level-array.epub"}]""")
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenBooksPayloadIsNotJSONArray() {
        parseDownloadedBookMetadata("""{"books":"not-an-array","items":"not-an-array"}""")
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToNumericSha256WhenIdMissing() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":null,"sha256":98765,"epubUrl":"https://example.org/numeric-sha.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("98765", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToNumericShaWhenIdIsWhitespaceAndShaIsNumeric() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"   ","sha256":24680,"epubUrl":"https://example.org/blank-id-numeric-sha.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("24680", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataNormalizesUppercaseIdentifierAndShaToLowercase() {
        val uppercaseId = "A".repeat(64)
        val uppercaseBlossom = "B".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$uppercaseId","sha256":"$uppercaseId","blossomSha256":"$uppercaseBlossom","epubUrl":"https://example.org/book.epub","title":"Cased identifiers"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(uppercaseId.lowercase(), results[0].id)
        assertEquals(uppercaseBlossom.lowercase(), results[0].blossomSha256)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToUntitledAndUnknownWhenMetadataMissing() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"${"b".repeat(64)}","epubUrl":"https://example.org/book.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("Untitled", results[0].title)
        assertEquals("Unknown", results[0].author)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataInfersFormatFromUrlWhenExplicitFormatIsUnsupported() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"${"c".repeat(64)}","format":"mobi","epubUrl":"https://example.org/book.PDF"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToTopLevelObjectWhenBooksAndItemsAreMissing() {
        val results = parseDownloadedBookMetadata(
            """{"id":"${"d".repeat(64)}","title":"Top-level","author":"Author","epubUrl":"https://example.org/top.epub"}"""
        )

        assertEquals(1, results.size)
        assertEquals("d".repeat(64), results[0].id)
        assertEquals("Top-level", results[0].title)
        assertEquals("Author", results[0].author)
        assertEquals("https://example.org/top.epub", results[0].epubUrl)
    }

    @Test
    fun parseDownloadedBookMetadataSkipsRowsWithMissingDownloadUrl() {
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"${"e".repeat(64)}","title":"Missing","author":"Author"},
              {"id":"${"f".repeat(64)}","title":"Has URL","author":"Author","epubUrl":"https://example.org/has.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals("Has URL", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataPrefersBooksArrayWhenItemsAreAlsoProvided() {
        val bookId = "m".repeat(64)
        val itemId = "n".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$bookId","title":"From Books","epubUrl":"https://example.org/books.epub"}],"items":[{"id":"$itemId","title":"From Items","epubUrl":"https://example.org/items.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("From Books", results[0].title)
        assertEquals(bookId, results[0].id)
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenBooksPayloadIsNull() {
        parseDownloadedBookMetadata(
            """{"books":null,"items":[{"id":"${"o".repeat(64)}","epubUrl":"https://example.org/fallback.epub"}]}"""
        )
    }

    @Test
    fun parseDownloadedBookMetadataDefaultsNonStringTitleAndAuthorFromObjectPayload() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{
              "id":"${"p".repeat(64)}",
              "epubUrl":"https://example.org/nonstring-metadata.epub",
              "title":123,
              "author":["unexpected","shape"]
            }]}"""
        )

        assertEquals(1, results.size)
        assertEquals("Untitled", results[0].title)
        assertEquals("Unknown", results[0].author)
    }

    @Test
    fun parseDownloadedBookMetadataNormalizesNonStringCatalogMetadataFromTopLevelPayload() {
        val results = parseDownloadedBookMetadata(
            """{"id":"${"q".repeat(64)}",
                "title":[],
                "author":false,
                "epubUrl":"https://example.org/root-nonstring.epub"
            }"""
        )

        assertEquals(1, results.size)
        assertEquals("Untitled", results[0].title)
        assertEquals("Unknown", results[0].author)
        assertEquals(BookFormat.Epub, results[0].format)
    }
}
