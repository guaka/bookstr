package app.bookstr.data

import app.bookstr.download.DownloadJob
import org.junit.Assert.*
import org.junit.Test

class BookListFiltersTest {
    @Test fun normalizesLanguageNamesCodesAndRegions() {
        assertEquals(listOf("en", "pt", "zz"), BookListFilters.languages(listOf(null, "", " English ", "eng", "en-US", "pt_BR", "Portuguese", "zz")))
        assertEquals(listOf("cbz", "epub", "pdf"), BookListFilters.formats(listOf(null, "", " .EPUB ", ".CBZ", "PDF", "pdf")))
    }
    @Test fun combinesFacetsAndKeepsUnknownMetadataOnlyForAll() {
        assertTrue(BookListFilters().matches(null, null))
        assertTrue(BookListFilters("en").matches("English", null))
        assertFalse(BookListFilters("en").matches(null, "epub"))
        assertTrue(BookListFilters(format = "pdf").matches(null, ".PDF"))
        assertFalse(BookListFilters(format = "pdf").matches("en", null))
        val both = BookListFilters("pt", "cbz")
        assertTrue(both.matches("pt-BR", ".CBZ"))
        assertFalse(both.matches("en", "cbz"))
        assertFalse(both.matches("pt", "epub"))
        assertEquals(both, both.sanitize(listOf("pt"), listOf("cbz")))
        assertEquals(BookListFilters(), both.sanitize(emptyList(), emptyList()))
    }
    @Test fun authorPlaceholdersAreHiddenWithoutHidingRealNames() {
        for (value in listOf(null, "", "  ", "Unknown", " UNKNOWN AUTHOR ", "Author unknown")) assertNull(displayBookAuthor(value))
        assertEquals("Unknown Author Collective", displayBookAuthor(" Unknown Author Collective "))
        assertEquals("Jane Austen", displayBookAuthor("Jane Austen"))
    }
    @Test fun languageSurvivesSearchConversionAndDownloadJournal() {
        val id = "a".repeat(32)
        val result = BookSearchResult(id, "libcat", "Book", "Author", language = "pt-BR", format = BookFormat.Pdf, libvaultMd5 = id)
        val book = result.asCatalogBook()!!
        assertEquals("pt-BR", book.language)
        val job = DownloadJob(book, TorrentEdition(id, 42, "fiction", 100))
        assertEquals("pt-BR", DownloadJob.parse(job.json()).book.language)
        val legacy = job.json().apply { getJSONObject("book").remove("language") }
        assertNull(DownloadJob.parse(legacy).book.language)
    }
}
