package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NostrFavoritesRepositoryExtraCoverage2Test {
    @Test
    fun parseSharedFavoriteTagsKeepsBookTagFallbackURLWhenMetadataAddsOnlyUrlLater() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["r", "https://example.org/fallback.epub"],
                ["book", "bookstr", "catalog-id", "1700000010", ""],
                ["i", "isbn:978-0-12-345-6789-7", "https://example.org/override.epub"],
                ["bookstr", "catalog-id", "Title from metadata", "Author from metadata"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("catalog-id", refs[0].bookstrId)
        assertEquals("Title from metadata", refs[0].title)
        assertEquals("Author from metadata", refs[0].author)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
        assertEquals(1_700_000_010L, refs[0].addedAt)
    }

    @Test
    fun matchSharedFavoritesIgnoresUnstableIsbnWhenStableIdConflictExists() {
        val md5 = "a".repeat(32)
        val refs = listOf(
            SharedFavoriteRef(
                bookstrId = "stable-id",
                isbn = "9780123456789",
                url = "https://example.com/first.epub",
            ),
            SharedFavoriteRef(
                libvaultMd5 = md5,
                isbn = "1111222233334",
                url = "https://example.com/second.epub",
            ),
        )
        val result = NostrFavoritesRepository.matchSharedFavorites(
            refs,
            listOf(
                CatalogBook(
                    id = "catalog-id",
                    title = "Catalog",
                    author = "Author",
                    epubUrl = "https://example.com/second.epub",
                    coverUrl = null,
                    sourceUrl = "https://example.com/second.epub",
                    libvaultMd5 = md5,
                    isbn = null,
                ),
            ),
        )

        assertEquals(setOf("catalog-id"), result.bookIds)
        assertEquals(1, result.external.size)
        val external = result.external.single()
        assertEquals("stable-id", external.key)
        assertEquals("stable-id", external.key)
        assertEquals("LibVault favorite", external.title)
        assertNotNull(external.isbn)
        assertEquals("9780123456789", external.isbn)
    }

    @Test
    fun parseSharedFavoriteTagsReturnsNullAddedAtWhenLibvaultTimestampInvalid() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault", "$md5", "1700000100", "https://example.org/invalid.lib"],
              ["libvault-added", "$md5", "bad"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertNull(refs[0].addedAt)
    }

    @Test
    fun matchSharedFavoritesIgnoresUrlMatchWhenStableIdDiffers() {
        val md5 = "a".repeat(32)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    libvaultMd5 = md5,
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
                    sourceUrl = "https://example.org/shared.epub",
                    libvaultMd5 = "b".repeat(32),
                    isbn = "9780123456789",
                ),
            ),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.single().key)
    }

    @Test
    fun matchSharedFavoritesMatchesByNormalizedIsbnBeforeExternalFallback() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    isbn = "978-0-12-345-6789-7",
                    title = "Standalone favorite",
                ),
            ),
            listOf(
                CatalogBook(
                    id = "catalog-id",
                    title = "Catalog book",
                    author = "Author",
                    epubUrl = "https://example.org/book.epub",
                    coverUrl = null,
                    sourceUrl = "https://example.org/book.epub",
                    isbn = "9780123456789",
                ),
            ),
        )

        assertEquals(setOf("catalog-id"), result.bookIds)
        assertEquals(0, result.external.size)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsPendingUrlAfterUnknownTagWhenNextIstagIsValid() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "https://example.org/fallback.epub"],
              ["unknown", "ignored"],
              ["i", "isbn:978-0-12-345-6789-7", ""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
        assertNull(refs[0].libvaultMd5)
    }
}
