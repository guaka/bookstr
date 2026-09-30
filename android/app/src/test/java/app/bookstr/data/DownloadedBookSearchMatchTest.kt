package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadedBookSearchMatchTest {
    @Test
    fun matchesDifferentLibCatEditionByNormalizedTitleAndAuthor() {
        val downloaded = localBook(id = "downloaded-edition", title = "The Old Man and the Sea", author = "Ernest Hemingway")
        val searchEdition = BookSearchResult(
            id = "another-libcat-edition",
            source = "libcat",
            title = " the old man, and the sea ",
            author = "ERNEST HEMINGWAY",
            format = BookFormat.Epub,
            libvaultMd5 = "a".repeat(32),
        )

        assertEquals(downloaded, matchingDownloadedBook(searchEdition, listOf(downloaded)))
    }

    @Test
    fun requiresBothTitleAndAuthorWhenEditionIdsDiffer() {
        val downloaded = localBook(id = "downloaded-edition", title = "The Old Man and the Sea", author = "Ernest Hemingway")
        val otherAuthor = BookSearchResult(
            id = downloaded.id + "-new",
            source = "libcat",
            title = downloaded.title,
            author = "Another Author",
        )
        val missingAuthor = otherAuthor.copy(author = "")

        assertNull(matchingDownloadedBook(otherAuthor, listOf(downloaded)))
        assertNull(matchingDownloadedBook(missingAuthor, listOf(downloaded)))
    }

    @Test
    fun prefersExactEditionIdBeforeTitleAuthorMatch() {
        val exact = localBook(id = "edition", title = "Reprint", author = "A Writer")
        val sameWork = localBook(id = "older-edition", title = "A Work", author = "A Writer")
        val result = BookSearchResult(id = exact.id, source = "libcat", title = sameWork.title, author = sameWork.author)

        assertEquals(exact, matchingDownloadedBook(result, listOf(sameWork, exact)))
    }

    private fun localBook(id: String, title: String, author: String) = CatalogBook(
        id = id,
        title = title,
        author = author,
        epubUrl = "",
        coverUrl = null,
    )
}
