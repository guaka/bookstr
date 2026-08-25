package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BookSearchResultBehaviorTest {
    @Test
    fun bookFormatFromNullFormatFallsBackToPdfWhenUrlEndsInPdf() {
        assertEquals(
            BookFormat.Pdf,
            BookFormat.from(null, "https://example.org/library/notes.PDF?download=1"),
        )
    }

    @Test
    fun bookFormatFromNullFormatFallsBackToEpubWhenUrlEndsInEpub() {
        assertEquals(
            BookFormat.Epub,
            BookFormat.from(null, "https://example.org/library/notes.epub"),
        )
    }

    @Test
    fun bookFormatFromUnknownValueDefaultsToEpubWithoutPdfHint() {
        assertEquals(BookFormat.Epub, BookFormat.from("mobi", "https://example.org/library/notes.txt"))
    }

    @Test
    fun bookFormatFromUnknownValueAndEmptyUrlDefaultsToEpub() {
        assertEquals(BookFormat.Epub, BookFormat.from("mobi", ""))
    }

    @Test
    fun asCatalogBookReturnsNilWhenDownloadUrlIsMissing() {
        val result = BookSearchResult(
            id = "all.books.party:1",
            source = "all.books.party",
            title = "No URL",
            author = "Test",
            downloadUrl = null,
            format = BookFormat.Epub,
        )

        assertNull(result.asCatalogBook())
    }

    @Test
    fun bookFormatFromUnknownValueFallsBackToPdfWhenUrlHasUppercaseDotPdf() {
        assertEquals(
            BookFormat.Pdf,
            BookFormat.from("mobi", "https://example.org/library/notes.PDF?download=1"),
        )
    }

    @Test
    fun bookFormatFromUnknownValueFallsBackToEpubWhenUrlHasPdfInQueryButNotPath() {
        assertEquals(
            BookFormat.Epub,
            BookFormat.from("mobi", "https://example.org/library/notes?fmt=epub&type=book"),
        )
    }

    @Test
    fun asCatalogBookAllowsWhitespaceDownloadUrlButIsNotReadable() {
        val result = BookSearchResult(
            id = "all.books.party:whitespace",
            source = "all.books.party",
            title = "Whitespace URL",
            author = "Test",
            downloadUrl = "   ",
            format = BookFormat.Pdf,
        )
        val catalogBook = result.asCatalogBook()

        assertEquals("   ", catalogBook?.epubUrl)
        assertEquals(false, result.isReadable)
    }

    @Test
    fun bookFormatFromEmptyExplicitValueFallsBackToUrlHint() {
        assertEquals(BookFormat.Pdf, BookFormat.from("   ", "https://example.org/file.PDF?download=1"))
    }

    @Test
    fun asCatalogBookAllowsBlankDownloadUrlButIsNotReadable() {
        val result = BookSearchResult(
            id = "all.books.party:blank",
            source = "all.books.party",
            title = "Blank URL",
            author = "Test",
            downloadUrl = "",
            format = BookFormat.Epub,
        )
        val catalogBook = result.asCatalogBook()

        assertEquals("", catalogBook?.epubUrl)
        assertEquals(false, result.isReadable)
    }

    @Test
    fun asCatalogBookBuildsCatalogModelWhenDownloadUrlAndFormatExist() {
        val result = BookSearchResult(
            id = "all.books.party:2",
            source = "all.books.party",
            title = "Readable",
            author = "Test",
            downloadUrl = "https://example.org/book.epub",
            format = BookFormat.Epub,
            year = "2026",
        )
        val catalogBook = result.asCatalogBook()!!

        assertEquals("Readable", catalogBook.title)
        assertEquals("Test", catalogBook.author)
        assertEquals("https://example.org/book.epub", catalogBook.epubUrl)
        assertEquals("https://example.org/book.epub", catalogBook.sourceUrl)
        assertEquals("2026", catalogBook.year)
    }

    @Test
    fun bookFormatFromMixedCaseValueIsNormalized() {
        assertEquals(BookFormat.Pdf, BookFormat.from("Pdf", "https://example.org/file.txt"))
        assertEquals(BookFormat.Epub, BookFormat.from(" ePuB ", "https://example.org/file.txt"))
    }

    @Test
    fun asCatalogBookReturnsNilWhenFormatMissing() {
        val result = BookSearchResult(
            id = "all.books.party:3",
            source = "all.books.party",
            title = "No Format",
            author = "Test",
            downloadUrl = "https://example.org/book.epub",
            format = null,
        )

        assertNull(result.asCatalogBook())
    }

    @Test
    fun isReadableTrueOnlyWhenUrlAndFormatExist() {
        val readable = BookSearchResult(
            id = "all.books.party:4",
            source = "all.books.party",
            title = "Readable",
            author = "Test",
            downloadUrl = "https://example.org/book.epub",
            format = BookFormat.Epub,
        )
        val unread = BookSearchResult(
            id = "all.books.party:5",
            source = "all.books.party",
            title = "Unread",
            author = "Test",
            downloadUrl = null,
            format = BookFormat.Pdf,
        )

        assertEquals(true, readable.isReadable)
        assertEquals(false, unread.isReadable)
    }
}
