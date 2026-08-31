package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method

class CatalogRepositoryDownloadMetadataCoverageTest {
    private fun parseDownloadedBookMetadata(json: String): List<CatalogBook> {
        val companion = CatalogRepository::class.java.getDeclaredField("Companion").get(null)
        val method: Method = companion.javaClass.getDeclaredMethod("parseDownloadedBookMetadata", String::class.java)
        method.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        return try {
            method.invoke(companion, json) as List<CatalogBook>
        } catch (error: InvocationTargetException) {
            throw error.targetException
        }
    }

    @Test
    fun parseDownloadedBookMetadataFallsBackToObjectPayloadWhenNoBooksOrItemsFieldPresent() {
        val id = "a".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"id":"$id","title":"Root payload","author":"Legacy","epubUrl":"https://example.org/book.epub","format":"epub","blossomSha256":"$id"}""",
        )

        assertEquals(1, results.size)
        assertEquals(id, results[0].id)
        assertEquals("Root payload", results[0].title)
        assertEquals("Legacy", results[0].author)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals(id, results[0].blossomSha256)
    }

    @Test
    fun parseDownloadedBookMetadataUsesItemsPayloadAndFallsBackToSha256WhenIdIsBlank() {
        val sha = "b".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"items":[
              {"id":"","sha256":"$sha","epubUrl":"https://example.org/with-sha.epub","format":"pdf","title":"From sha"},
              {"id":"","epubUrl":"https://example.org/empty-sha.epub"},
              {"id":"", "sha256":"", "epubUrl":""}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals(sha, results[0].id)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("From sha", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataSkipsRowsWithoutUsableIdOrDownloadUrl() {
        val sha = "c".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"   ","epubUrl":"https://example.org/missing-id.epub"},
              {"id":"valid-no-url","title":"Missing download"},
              {"id":"valid","epubUrl":"https://example.org/read.MP3","format":"mp3"},
              {"id":"fallback","sha256":"$sha","epubUrl":"https://example.org/book.zip","extension":"pdf"},
              {"id":"", "epubUrl":""}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals("valid", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("fallback", results[1].id)
        assertEquals(BookFormat.Pdf, results[1].format)
    }

    @Test
    fun parseDownloadedBookMetadataAcceptsExtensionWhenFormatIsMissingAndRejectsInvalidShaInMetadata() {
        val sha = "z".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"valid","epubUrl":"https://example.org/book.bin","extension":"pdf","blossomSha256":"$sha"},
              {"id":"invalid-blob","epubUrl":"https://example.org/skip-me.epub","format":"epub","blossomSha256":"zz"}
            ]}""",
        )

        assertEquals(2, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
        assertEquals("valid", results[0].id)
        assertNull(results[1].blossomSha256)
        assertEquals(BookFormat.Epub, results[1].format)
    }

    @Test
    fun parseDownloadedBookMetadataDefaultsToEpubWhenFormatAndExtensionAreMissing() {
        val id = "d".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$id","epubUrl":"https://example.org/download","title":"Defaulted"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Epub, results[0].format)
        assertEquals("Defaulted", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataKeepsExplicitCbzFormatOverPdfUrl() {
        val id = "e".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$id","format":"cbz","epubUrl":"https://example.org/book.PDF","title":"From URL"},
              {"id":"", "epubUrl":""}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Cbz, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataPrefersBooksPayloadOverItemsPayloadWhenBothArePresent() {
        val first = "x".repeat(64)
        val second = "y".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[
              {"id":"$first","epubUrl":"https://example.org/book-first.epub","title":"From books"}
            ],"items":[
              {"id":"$second","epubUrl":"https://example.org/book-second.epub","title":"From items"}
            ]}"""
        )

        assertEquals(1, results.size)
        assertEquals(first, results[0].id)
        assertEquals("From books", results[0].title)
    }

    @Test
    fun parseDownloadedBookMetadataUsesUppercaseExtensionFieldWhenFormatIsMissing() {
        val id = "f".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$id","epubUrl":"https://example.org/download","extension":"PDF","title":"From field"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Pdf, results[0].format)
    }

    @Test
    fun parseDownloadedBookMetadataDefaultsToEpubWhenExtensionFieldIsUnsupportedAndUrlIsUndeclarative() {
        val id = "g".repeat(64)
        val results = parseDownloadedBookMetadata(
            """{"books":[{"id":"$id","epubUrl":"https://example.org/file.bin","extension":"txt","title":"Unknown extension"}]}"""
        )

        assertEquals(1, results.size)
        assertEquals(BookFormat.Epub, results[0].format)
    }
}
