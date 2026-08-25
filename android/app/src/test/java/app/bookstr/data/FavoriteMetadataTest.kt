package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        assertNull(CatalogRepository.fromBlossomFavorite(favorite.copy(blossomUrl = "   ")))
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(blossomUrl = "https://lib.b.bfr.ee/api/files/book.epub"),
            ),
        )
    }

    @Test
    fun rejectsInvalidHashAndInsecureBlossomUrl() {
        assertNull(CatalogRepository.fromBlossomFavorite(favorite.copy(blossomSha256 = "short")))
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(blossomUrl = "http://blossom.bfr.ee/$sha256"),
            ),
        )
    }

    @Test
    fun preservesPdfFormatFromFavoriteDescriptor() {
        val book = CatalogRepository.fromBlossomFavorite(favorite.copy(format = "pdf"))!!

        assertEquals(BookFormat.Pdf, book.format)
        assertTrue(book.epubUrl.endsWith(sha256))
    }

    @Test
    fun acceptsCaseInsensitiveTrustedHostButRejectsSubdomains() {
        assertEquals(
            sha256,
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(blossomUrl = "https://BLOSSOM.BFR.EE/$sha256"),
            )?.id,
        )
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(blossomUrl = "https://evil.blossom.bfr.ee/$sha256"),
            ),
        )
    }

    @Test
    fun normalizesUppercaseBlossomHashForCatalogIdentity() {
        val book = CatalogRepository.fromBlossomFavorite(favorite.copy(blossomSha256 = sha256.uppercase()))!!

        assertEquals(sha256, book.id)
        assertEquals(sha256, book.blossomSha256)
    }

    @Test
    fun rejectsInvalidSha256WhenMd5KeyIsPresentEvenWithValidDownloadUrl() {
        assertNull(
            CatalogRepository.fromBlossomFavorite(
                favorite.copy(
                    blossomSha256 = "invalid",
                    blossomUrl = "https://blossom.bfr.ee/invalid",
                    url = "https://example.test/book.epub",
                    libvaultMd5 = null,
                ),
            ),
        )
    }

    @Test
    fun fallsBackToCanonicalBlossomUrlForInvalidExplicitBlossomDownloadPath() {
        val book = CatalogRepository.fromBlossomFavorite(
            favorite.copy(
                blossomUrl = "http://blossom.bfr.ee/$sha256",
                url = ":invalid://", // should not be used while sha256 remains valid
            ),
        )

        assertNull(book)
    }
}
