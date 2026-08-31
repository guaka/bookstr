package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.lang.reflect.InvocationTargetException

class CatalogRepositoryDownloadMetadataCoverageAdditionalTest {
    private fun parseDownloadedBookMetadata(json: String): List<CatalogBook> {
        val companion = CatalogRepository::class.java.getDeclaredField("Companion").get(null)
        val method = companion.javaClass.getDeclaredMethod("parseDownloadedBookMetadata", String::class.java)
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        return try {
            method.invoke(companion, json) as List<CatalogBook>
        } catch (error: InvocationTargetException) {
            throw error.targetException
        }
    }

    @Test
    fun parseDownloadedBookMetadataPreservesDownloadMetadataFieldsFromItemsPayload() {
        val id = "h".repeat(64)
        val md5 = "a".repeat(32)
        val results = parseDownloadedBookMetadata(
            """{"items":[
              {"id":"$id","epubUrl":"https://example.org/library/download.PDF","title":"Detailed item","author":"Archive Author","coverUrl":"https://covers.example.org/$id.png","sourceUrl":"https://library.example.org/meta/$id","isbn":"978-1234567890","libvaultMd5":"$md5","format":"pdf","year":"2025"}
            ]}"""
        )

        assertEquals(1, results.size)
        val book = results.first()
        assertEquals(id, book.id)
        assertEquals("Detailed item", book.title)
        assertEquals("Archive Author", book.author)
        assertEquals("https://example.org/library/download.PDF", book.epubUrl)
        assertEquals("https://covers.example.org/$id.png", book.coverUrl)
        assertEquals("https://library.example.org/meta/$id", book.sourceUrl)
        assertEquals("978-1234567890", book.isbn)
        assertEquals(md5, book.libvaultMd5)
        assertEquals(BookFormat.Pdf, book.format)
        assertEquals("2025", book.year)
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsWhenItemIsNotJSONObject() {
        parseDownloadedBookMetadata(
            """{"books":[
              "bad-row",
              {"id":"${"i".repeat(64)}","epubUrl":"https://example.org/valid.epub"}
            ]}"""
        )
    }

    @Test
    fun parseDownloadedBookMetadataSkipsRowsWithoutAnyUsableIdentifier() {
        val validId = "j".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"items":[
              {"id":"","epubUrl":"https://example.org/skip-me.epub","title":"Skip me"},
              {"sha256":"$validId","epubUrl":"https://example.org/valid.pdf","format":"pdf","year":"  "},
              {"epubUrl":"https://example.org/no-identity.epub","title":"No identity"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(validId, results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertNull(results[0].year)
    }

    @Test
    fun parseDownloadedBookMetadataLowercasesIdentifiers() {
        val uppercaseId = "F".repeat(64)
        val uppercaseSha = "A".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"items":[
              {
                "id":"$uppercaseId",
                "sha256":"$uppercaseSha",
                "epubUrl":"https://example.org/book.epub",
                "blossomSha256":"$uppercaseSha",
                "format":"epub"
              }
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(uppercaseId.lowercase(), results[0].id)
        assertEquals(uppercaseSha.lowercase(), results[0].blossomSha256)
    }

    @Test
    fun parseDownloadedBookMetadataSkipsWhitespaceOnlyDownloadUrl() {
        val validId = "k".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"skip-me","epubUrl":"   "},
              {"id":"$validId","epubUrl":"https://example.org/actual.epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(validId, results[0].id)
        assertEquals("https://example.org/actual.epub", results[0].epubUrl)
    }

    @Test
    fun parseDownloadedBookMetadataDefaultsMissingTitleAndAuthor() {
        val id = "m".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$id","epubUrl":"https://example.org/titleless.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("Untitled", results[0].title)
        assertEquals("Unknown", results[0].author)
    }

    @Test
    fun parseDownloadedBookMetadataRespectsWhitespaceInDeclaredFormat() {
        val id = "w".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{
              "id":"$id",
              "epubUrl":"https://example.org/file.bin",
              "format":" PDF "
            }]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataIgnoresNonStringIdFallbacksToShaWhenIdBlank() {
        val id = "v".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":null,"sha256":"$id","epubUrl":"https://example.org/fallback.epub"},
              {"id":null,"sha256":"","epubUrl":"https://example.org/skip.me"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(id, results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataNormalizesWhitespaceMetadataFieldsToNull() {
        val id = "y".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{
              "id":"$id",
              "epubUrl":"https://example.org/book.epub",
              "sourceUrl":"   ",
              "year":"   "
            }]}"""
        )

        assertEquals(1, results.size)
        assertEquals(null, results[0].sourceUrl)
        assertEquals(null, results[0].year)
    }
    @Test
    fun parseDownloadedBookMetadataKeepsExplicitCbzFormatOverPdfUrlWithQuery() {
        val id = "z".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$id","format":"cbz","epubUrl":"https://example.org/book.PDF?download=true","title":"Query path"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Cbz, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToShaWhenIdIsComplexObject() {
        val sha = "w".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":{"value":"bad-id"},"sha256":"$sha","epubUrl":"https://example.org/complex-id.epub"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(sha, results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataAcceptsNumericIdFromNonStringInput() {
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":42,"epubUrl":"https://example.org/numeric-id.epub","format":"epub","title":"Number id"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals("42", results[0].id)
        assertEquals("Number id", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataIgnoresItemsWhenBooksArrayIsEmpty() {
        val id = "q".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[],"items":[{"id":"$id","epubUrl":"https://example.org/fallback.epub"}]}"""
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseDownloadedBookMetadataSkipsTopLevelFallbackWhenNoUsableIdentifier() {
        val results = parseDownloadedBookMetadata(
            """{"title":"Orphaned metadata","author":"Unknown","year":"2026"}"""
        )

        assertEquals(0, results.size)
    }

    @Test
    fun parseDownloadedBookMetadataUsesBooksArrayWhenBothBooksAndItemsExist() {
        val expectedId = "r".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$expectedId","epubUrl":"https://example.org/from-books.epub","title":"From books","format":"epub"}
            ],"items":[
              {"id":"${"x".repeat(64)}","epubUrl":"https://example.org/from-items.epub","title":"From items","format":"epub"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(expectedId, results[0].id)
        assertEquals("From books", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataRejectsInvalidBlossomSha256Value() {
        val id = "t".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$id","epubUrl":"https://example.org/book.epub","blossomSha256":"not-a-valid-hash"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertNull(results[0].blossomSha256)
    }

    @Test
    fun parseDownloadedBookMetadataUsesExtensionWhenFormatIsBlank() {
        val id = "u".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$id","epubUrl":"https://example.org/collection.bin","extension":"pdf","format":"   "}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsForTopLevelArray() {
        parseDownloadedBookMetadata("[{\"id\":\"a\",\"epubUrl\":\"https://example.org/one.epub\"}]")
    }

    @Test(expected = org.json.JSONException::class)
    fun parseDownloadedBookMetadataThrowsForInvalidTopLevelPayload() {
        parseDownloadedBookMetadata("invalid-json")
    }

    @Test
    fun parseDownloadedBookMetadataRespectsExplicitFormatWhenUrlConflicts() {
        val id = "q".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{
              "id":"$id","epubUrl":"https://example.org/book.pdf","format":"epub","extension":"pdf","title":"Explicit vs URL"
            }]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("Explicit vs URL", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataKeepsExplicitLibvaultMd5ValueFromPayload() {
        val id = "r".repeat(64)
        val md5 = "a".repeat(32)
        val results = parseDownloadedBookMetadata(
            """{"books":[{
              "id":"$id","epubUrl":"https://example.org/book.epub","format":"epub","libvaultMd5":"$md5","year":"2026"
            }]}"""
        )

        assertEquals(1, results.size)
        assertEquals(md5, results[0].libvaultMd5)
        assertEquals("2026", results[0].year)
        assertNotNull(results[0].libvaultMd5)
    }
}
