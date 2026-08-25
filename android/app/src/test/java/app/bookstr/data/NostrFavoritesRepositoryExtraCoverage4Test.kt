package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NostrFavoritesRepositoryExtraCoverage4Test {
    @Test
    fun parseSharedFavoriteTagsKeepsStandaloneInvalidIstagButNoCurrentRefAsIgnoredItem() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["i", "isbn:not-a-real-isbn"]
                ]""",
        )

        assertEquals(0, refs.size)
    }

    @Test
    fun parseSharedFavoriteTagsSupportsStandaloneValidIstagWithEmptyLocator() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["i", "isbn:978-0-12-345-6789-7", ""]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertNull(refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsIgnoresInvalidBookUrlTagAndKeepsPendingRForNextIstag() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["r", "https://example.org/fallback.epub"],
                  ["book", "url", "not-a-url", "1700000010"],
                  ["i", "isbn:978-0-12-345-6789-7", ""],
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsUsesPendingUrlForStandaloneIsbnWhenUnsupportedBookNamespaceAppears() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["r", "https://example.org/fallback.epub"],
                  ["book", "unsupported", "bad-id", "1700000010", ""],
                  ["i", "isbn:978-0-12-345-6789-7", ""],
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsDeduplicatesURLRefsAndKeepsEarliestAddedAt() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "url", "https://example.org/book.epub", "1700000010"],
                  ["book", "url", "https://example.org/book.epub", "1700000005"],
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsPositiveAddedAtWhenLibvaultAddedZeroOrNegative() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                  ["libvault-added", "$md5", "0"],
                  ["libvault-added", "$md5", "-5"]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_010L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsCreatesStandaloneLibvaultRefForLibvaultAddedWhenNoBookInfo() {
        val md5 = "b".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["libvault-added", "$md5", "1700000015"]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(1_700_000_015L, refs[0].addedAt)
        assertNull(refs[0].url)
    }

    @Test
    fun matchSharedFavoritesDoesNotMatchByEpubUrlOnly() {
        val md5 = "c".repeat(32)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    libvaultMd5 = md5,
                    isbn = "9780123456789",
                    url = "https://example.org/shared.epub",
                ),
            ),
            listOf(
                CatalogBook(
                    id = "catalog-id",
                    title = "Catalog",
                    author = "Author",
                    epubUrl = "https://example.org/shared.epub",
                    coverUrl = null,
                    sourceUrl = "https://other-source.example/shared.epub",
                    libvaultMd5 = md5,
                    isbn = "9789999999999",
                ),
            ),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.single().key)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsUrlRefWhenAddedAtIsInvalid() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "url", "https://example.org/book.epub", "bad-date"]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertNull(refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsCurrentUrlWhenIstagUsesLegacyLocatorFallback() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "url", "https://example.org/base.epub", "1700000010"],
                  ["i", "isbn:978-0-12-345-6789-7", ""]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/base.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsPrefersFirstBookstrUrlWhenMetadataLocatorIsBlank() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "bookstr", "catalog-id", "1700000010", "https://example.org/book.epub"],
                  ["bookstr", "catalog-id", "", "", ""],
                  ["bookstr", "catalog-id", "Catalog title", "Catalog author", ""]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("catalog-id", refs[0].bookstrId)
        assertEquals("Catalog title", refs[0].title)
        assertEquals("Catalog author", refs[0].author)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_010L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsNormalizesLibvaultAddedTimestampForUppercaseIdCase() {
        val md5 = "A".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
                [
                  ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                  ["libvault-added", "${md5.lowercase()}", "1700000007"],
                  ["libvault-added", "${md5.uppercase()}", "1700000005"]
                ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5.lowercase(), refs[0].libvaultMd5)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }
}
