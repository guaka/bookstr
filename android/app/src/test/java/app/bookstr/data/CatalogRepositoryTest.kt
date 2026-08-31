package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class CatalogRepositoryTest {

    @Test
    fun validatesNativeFb2AndRejectsDtdOrMissingSections() {
        val valid = temporaryFile("""
            <?xml version="1.0" encoding="UTF-8"?>
            <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
              <description><title-info><book-title>Тест</book-title><author><first-name>Ada</first-name><last-name>Writer</last-name></author><date>2024-01-01</date></title-info></description>
              <body><section><title><p>Глава</p></title><p>Текст</p></section></body>
            </FictionBook>
        """.trimIndent())
        val noSections = temporaryFile("<FictionBook><body/></FictionBook>")
        val dtd = temporaryFile("<!DOCTYPE FictionBook [<!ENTITY x SYSTEM \"https://example.test/x\">]><FictionBook><body><section><p>&x;</p></section></body></FictionBook>")
        try {
            assertTrue(CatalogRepository.isStructurallyValidFb2(valid))
            assertFalse(CatalogRepository.isStructurallyValidFb2(noSections))
            assertFalse(CatalogRepository.isStructurallyValidFb2(dtd))
        } finally {
            valid.delete(); noSections.delete(); dtd.delete()
        }
    }

    @Test
    fun validatesExactlyOneSafeFb2ZipAndRejectsMultipleOrTraversalEntries() {
        fun zip(vararg names: String): File {
            val file = File.createTempFile("bookstr-fb2-", ".fb2.zip")
            ZipOutputStream(file.outputStream()).use { output ->
                names.forEach { name ->
                    output.putNextEntry(ZipEntry(name))
                    output.write("<FictionBook><body><section><p>Text</p></section></body></FictionBook>".toByteArray())
                    output.closeEntry()
                }
            }
            return file
        }
        val valid = zip("book.fb2")
        val multiple = zip("one.fb2", "two.fb2")
        val traversal = zip("../book.fb2")
        try {
            assertTrue(CatalogRepository.isStructurallyValidFb2(valid))
            assertFalse(CatalogRepository.isStructurallyValidFb2(multiple))
            assertFalse(CatalogRepository.isStructurallyValidFb2(traversal))
        } finally {
            valid.delete(); multiple.delete(); traversal.delete()
        }
    }

    private fun temporaryFile(contents: String): File = File.createTempFile("bookstr-fb2-", ".fb2").also { it.writeText(contents) }
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
        assertEquals(BookFormat.Cbr, BookFormat.from("CBR"))
        assertEquals(BookFormat.Cbz, BookFormat.from(null, "https://example.org/file.cbz?download=1"))
    }

    @Test
    fun infersPdfFromUnknownFormatWhenUrlIsPdfWithQueryAndFragment() {
        assertEquals(BookFormat.Pdf, BookFormat.from("mobi", "https://example.org/file.PDF?download=1#a"))
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

    @Test
    fun trimsSearchMetadataAndKeepsRatingFields() {
        val result = CatalogRepository.parseSearchResponse(
            """{"books":[{
              "id":" 42 ","source":" GUTENBERG ","title":"  A title  ","authors":"  An author  ",
              "publisher":"  A publisher  ","language":" pt ","avg_rating":4.5,"edition_count":7
            }]}""",
        ).single()

        assertEquals("gutenberg:42", result.id)
        assertEquals("A title", result.title)
        assertEquals("An author", result.author)
        assertEquals("A publisher", result.publisher)
        assertEquals("pt", result.language)
        assertEquals(4.5, result.rating, 0.0)
        assertEquals(7, result.editionCount)
    }

    @Test
    fun readUrlTakesPriorityOverOtherDownloadLinks() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{
              "id":"1","format":"epub","readUrl":"https://example.org/read.epub",
              "url":"https://example.org/url.epub","link":"https://example.org/link.epub"
            }]}""",
        ).single()

        assertEquals("https://example.org/read.epub", result.downloadUrl)
    }

    @Test
    fun booksArrayTakesPriorityWhenBothResponseShapesExist() {
        val results = CatalogRepository.parseSearchResponse(
            """{"books":[{"id":"book-shape"}],"results":[{"id":"result-shape"}]}""",
        )

        assertEquals(listOf("all.books.party:book-shape"), results.map { it.id })
    }

    @Test
    fun infersSupportedFormatFromDownloadUrlWhenFormatIsMissing() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":"epub","url":"https://example.org/book.EPUB?download=1"},
              {"id":"pdf","link":"https://example.org/book.pdf#page=1"}
            ]}""",
        )

        assertEquals(BookFormat.Epub, results.first { it.id.endsWith(":epub") }.format)
        assertEquals(BookFormat.Pdf, results.first { it.id.endsWith(":pdf") }.format)
        assertTrue(results.all { it.isReadable })
    }

    @Test
    fun unsupportedFormatRemainsMetadataOnly() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{"id":"mobi","format":"mobi","url":"https://example.org/book.mobi"}]}""",
        ).single()

        assertEquals(null, result.format)
        assertFalse(result.isReadable)
        assertEquals(null, result.asCatalogBook())
    }

    @Test
    fun numericSourceIdentityAndCoverAreAccepted() {
        val result = CatalogRepository.parseSearchResponse(
            """{"results":[{"source_native_id":123,"cover_id":456}]}""",
        ).single()

        assertEquals("all.books.party:123", result.id)
        assertTrue(result.coverUrl.orEmpty().endsWith("/456-M.jpg"))
    }
}
