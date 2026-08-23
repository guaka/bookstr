package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FavoriteMetadataTest {
    private val sha256 = "b".repeat(64)
    private val favorite = ExternalFavorite(
        key = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        title = "Nostr title",
        author = "Nostr author",
        url = null,
        isbn = null,
        libvaultMd5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        year = "2024",
        format = "epub",
        blossomSha256 = sha256,
        blossomUrl = "https://blossom.bfr.ee/$sha256",
    )

    @Test
    fun buildsDownloadableBookOnlyFromTrustedBlossomDescriptor() {
        val book = CatalogRepository.fromBlossomFavorite(favorite)!!

        assertEquals(sha256, book.id)
        assertEquals("Nostr author", book.author)
        assertEquals("2024", book.year)
        assertEquals(favorite.blossomUrl, book.epubUrl)
    }

    @Test
    fun rejectsMissingOrUntrustedBlossomDescriptor() {
        assertNull(CatalogRepository.fromBlossomFavorite(favorite.copy(blossomUrl = null)))
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(blossomUrl = "https://lib.b.bfr.ee/api/files/book.epub"),
            ),
        )
    }
}
