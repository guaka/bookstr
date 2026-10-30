package app.bookstr

import app.bookstr.data.BookFormat
import app.bookstr.data.CatalogBook
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BookstrMediaCatalogTest {
    private fun book(id: String, title: String, format: BookFormat) = CatalogBook(
        id = id,
        title = title,
        author = "Author",
        epubUrl = "",
        coverUrl = null,
        format = format,
    )

    @Test
    fun catalogIncludesAllDownloadedMetadataInTitleOrderButOnlyMarksEpubPlayable() {
        val epubId = "a".repeat(64)
        val pdfId = "b".repeat(32)
        val fb2Id = "c".repeat(64)
        val entries = BookstrMediaCatalog.entries(
            listOf(
                book(fb2Id, "Zebra", BookFormat.Fb2),
                book(epubId, "alpha", BookFormat.Epub),
                book(pdfId, "Middle", BookFormat.Pdf),
            ),
        ) { true }

        assertEquals(listOf("alpha", "Middle", "Zebra"), entries.map { it.book.title })
        assertEquals(listOf(true, false, false), entries.map { it.playable })
        assertEquals("bookstr-downloaded-books", BookstrMediaCatalog.ROOT_ID)
        assertEquals("app.bookstr.extra.OPEN_READER", BookstrMediaCatalog.EXTRA_OPEN_READER)
        assertEquals("app.bookstr.extra.PLAYABLE", BookstrMediaCatalog.EXTRA_PLAYABLE)
    }

    @Test
    fun catalogSkipsMissingDownloadsUnsafeIdsAndDuplicateIds() {
        val id = "d".repeat(64)
        var availabilityChecks = 0
        val entries = BookstrMediaCatalog.entries(
            listOf(
                book("../escape", "Unsafe", BookFormat.Epub),
                book(id, "Missing", BookFormat.Epub),
                book(id, "Duplicate", BookFormat.Pdf),
                book("e".repeat(32), "Present", BookFormat.Epub),
            ),
        ) { candidate ->
            availabilityChecks++
            candidate.title == "Present"
        }

        assertEquals(listOf("Present"), entries.map { it.book.title })
        assertEquals(3, availabilityChecks)
        assertTrue(entries.single().playable)
        assertTrue(BookstrMediaCatalog.isValidMediaId("f".repeat(32)))
        assertFalse(BookstrMediaCatalog.isValidMediaId("../../book"))
    }

    @Test
    fun onlyVerifiedRadioAndAndroidAutoPackagesCanBrowse() {
        assertTrue(BookstrMediaCatalog.isAllowedClient("org.guaka.radio", setOf("org.guaka.radio")))
        assertTrue(BookstrMediaCatalog.isAllowedClient(
            "com.google.android.projection.gearhead",
            setOf("com.google.android.projection.gearhead"),
        ))
        assertTrue(BookstrMediaCatalog.isAllowedClient("app.bookstr", setOf("app.bookstr")))
        assertFalse(BookstrMediaCatalog.isAllowedClient("org.guaka.radio", setOf("other.shared.uid.app")))
        assertFalse(BookstrMediaCatalog.isAllowedClient("other.app", setOf("other.app")))
    }
}
