package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogRepositoryBlossomFavoriteFormatCoverageTest {
    @Test
    fun fromBlossomFavoriteDefaultsToEpubWhenDeclaredFormatIsUnknownAndUrlHasNoSupportedExtension() {
        val sha = "c".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Unknown format fallback",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.bin",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Epub, book?.format)
        assertEquals("https://blossom.bfr.ee/$sha", book?.epubUrl)
        assertEquals("Author", book?.author)
    }

    @Test
    fun fromBlossomFavoriteRejectsUppercaseShaWithInvalidLength() {
        val invalidSha = "A".repeat(63)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Bad identity length",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "pdf",
                blossomSha256 = invalidSha,
                blossomUrl = "https://blossom.bfr.ee/$invalidSha",
            ),
        )

        assertNull(book)
    }
}
