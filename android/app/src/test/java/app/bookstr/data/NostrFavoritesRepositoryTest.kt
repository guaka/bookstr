package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NostrFavoritesRepositoryTest {
    private val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

    @Test
    fun upgradesLegacyFavoriteWithContainingEventTime() {
        val plaintext = """[["libvault","$md5"],["libvault-book","$md5","A Book"]]"""

        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_690_000_000)
        val ref = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded).single()

        assertEquals(1_690_000_000L, ref.addedAt)
        assertTrue(upgraded.contains("[\"libvault-added\",\"$md5\",\"1690000000\"]"))
    }

    @Test
    fun parsesEncryptedLibVaultTagShape() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["r","https://lib.b.bfr.ee/#book?md5=$md5"],
                ["libvault","$md5"],
                ["libvault-added","$md5","1700000000"],
                ["libvault-book","$md5","A Book","An Author","epub","1234","2024"],
                ["blossom","$md5","${"b".repeat(64)}","https://blossom.bfr.ee/${"b".repeat(64)}","epub"],
                ["i","isbn:978-0-123456-78-9","https://lib.b.bfr.ee/#book?md5=$md5"],
                ["k","isbn"]
            ]""".trimIndent(),
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("A Book", refs.single().title)
        assertEquals("An Author", refs.single().author)
        assertEquals("2024", refs.single().year)
        assertEquals(1700000000L, refs.single().addedAt)
        assertEquals("b".repeat(64), refs.single().blossomSha256)
        assertEquals("9780123456789", refs.single().isbn)
    }

    @Test
    fun matchesIsbnAndKeepsUnmatchedLibVaultFavorite() {
        val otherMd5 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["libvault","$md5"],
                ["i","isbn:9780123456789"],
                ["r","https://lib.b.bfr.ee/#book?md5=$otherMd5"],
                ["libvault","$otherMd5"],
                ["libvault-book","$otherMd5","Outside Book","Outside Author","epub"]
            ]""".trimIndent(),
        )
        val books = listOf(
            CatalogBook(
                id = "book-1",
                title = "One",
                author = "Author",
                epubUrl = "one.epub",
                coverUrl = null,
                isbn = "978-0-123456-78-9",
            ),
        )

        val result = NostrFavoritesRepository.matchSharedFavorites(refs, books)

        assertEquals(setOf("book-1"), result.bookIds)
        assertEquals(1, result.external.size)
        assertEquals(otherMd5, result.external.single().libvaultMd5)
        assertEquals("Outside Book", result.external.single().title)
        assertEquals("Outside Author", result.external.single().author)
        assertTrue(result.external.single().url!!.startsWith("https://lib.b.bfr.ee/"))
    }

    @Test
    fun favoriteMetadataSurvivesCanonicalSerialization() {
        val original = listOf(
            SharedFavoriteRef(
                libvaultMd5 = md5,
                title = "A Book",
                author = "An Author",
                year = "2024",
                format = "epub",
                isbn = "9780123456789",
                url = "https://example.org/book",
                blossomSha256 = "b".repeat(64),
                blossomUrl = "https://blossom.example/${"b".repeat(64)}",
                addedAt = 1700000000L,
            ),
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(original),
        )

        assertEquals(original, parsed)
    }
}
