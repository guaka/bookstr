package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogRepositoryBlossomFavoriteFromURLCoverageTest {
    @Test
    fun fromBlossomFavoriteRejectsWhenBlossomSha256IsMissing() {
        val md5 = "f".repeat(32)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = md5,
                title = "Fallback md5 key",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "pdf",
                blossomSha256 = null,
                blossomUrl = null,
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteRejectsWhenBlossomSha256IsInvalid() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "f".repeat(32),
                title = "Invalid URL",
                author = "Author",
                year = null,
                url = "not-a-url",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = null,
                blossomUrl = null,
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteRejectsWhenNoBlossomUrlExists() {
        val libvaultMd5 = "a".repeat(32)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Library md5 identity",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = libvaultMd5,
                format = "epub",
                blossomSha256 = null,
                blossomUrl = null,
            ),
        )

        assertNull(book)
        assertEquals(libvaultMd5, libvaultMd5)
    }

    @Test
    fun fromBlossomFavoriteRejectsWhenNoUsableIdentityExists() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "No identity",
                author = "Author",
                year = null,
                url = null,
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = null,
                blossomUrl = null,
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteAcceptsValidBlossomFavoriteWithCanonicalHost() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "F".repeat(32),
                title = "Uppercase MD5",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "pdf",
                blossomSha256 = "A".repeat(64),
                blossomUrl = "https://blossom.bfr.ee/${"a".repeat(64)}",
            ),
        )

        assertEquals("a".repeat(64), book?.id)
        assertEquals("https://blossom.bfr.ee/${"a".repeat(64)}", book?.epubUrl)
    }

    @Test
    fun fromBlossomFavoriteUsesBlossomUrlOverInvalidDirectUrlWhenBlossomSha256IsPresent() {
        val sha = "a".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Fallback blossom URL",
                author = "Author",
                year = "2026",
                url = "://bad-url",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = sha,
                blossomUrl = "https://BLOSSOM.BFR.EE/$sha",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals("https://BLOSSOM.BFR.EE/$sha", book?.epubUrl)
        assertNull(book?.sourceUrl)
    }

    @Test
    fun fromBlossomFavoriteRejectsInvalidUrlWhenNoUsableBlossomFallbackExists() {
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Bad direct URL",
                author = "Author",
                year = null,
                url = "://bad-url",
                isbn = null,
                libvaultMd5 = null,
                format = "epub",
                blossomSha256 = null,
                blossomUrl = "http://blossom.bfr.ee/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteRejectsWhenBlossomUrlIsHttp() {
        val sha = "f".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Insecure blossom URL",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.epub",
                isbn = null,
                libvaultMd5 = null,
                format = "pdf",
                blossomSha256 = sha,
                blossomUrl = "http://blossom.bfr.ee/$sha",
            ),
        )

        assertNull(book)
    }

    @Test
    fun fromBlossomFavoriteAcceptsUppercaseBlossomShaAndInfersFormatFromUrl() {
        val sha = "a".repeat(64).uppercase()
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Uppercase blossom hash",
                author = "Author",
                year = null,
                url = "https://example.org/legacy.book",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha",
            ),
        )

        assertEquals("a".repeat(64), book?.id)
        assertEquals(BookFormat.Epub, book?.format)
    }

    @Test
    fun fromBlossomFavoriteInfersPdfFromBlossomUrlWithQueryAndFragmentWhenFormatIsUnknown() {
        val sha = "b".repeat(64)
        val blossomUrl = "https://blossom.bfr.ee/$sha.pdf?download=1#page=1"
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Query fragment hint",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.book",
                isbn = null,
                libvaultMd5 = null,
                format = "mobi",
                blossomSha256 = sha,
                blossomUrl = blossomUrl,
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Pdf, book?.format)
        assertEquals(blossomUrl, book?.epubUrl)
    }

    @Test
    fun fromBlossomFavoriteDefaultsToEpubWhenExplicitFormatIsWhitespaceAndUrlHasNoHint() {
        val sha = "c".repeat(64)
        val book = CatalogRepository.fromBlossomFavorite(
            ExternalFavorite(
                key = "legacy-key",
                title = "Whitespace format fallback",
                author = "Author",
                year = "2026",
                url = "https://example.org/legacy.bin",
                isbn = null,
                libvaultMd5 = null,
                format = " ",
                blossomSha256 = sha,
                blossomUrl = "https://blossom.bfr.ee/$sha",
            ),
        )

        assertEquals(sha, book?.id)
        assertEquals(BookFormat.Epub, book?.format)
        assertEquals("https://blossom.bfr.ee/$sha", book?.epubUrl)
    }
}
