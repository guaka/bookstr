package app.bookstr.data

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NostrFavoritesRepositoryExtraCoverageTest {
    @Test
    fun parseSharedFavoriteTagsMergesBlossomShaIntoLibvaultRefWithoutOverwritingExistingValues() {
        val md5 = "d".repeat(32)
        val firstBlossomSha = "a".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book","libvault","$md5","1700000020","https://example.test/fallback.epub"],
                ["blossom","$md5","$firstBlossomSha","https://blossom.example.com/$firstBlossomSha", "epub"],
                ["blossom","$md5","","",""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.test/fallback.epub", refs[0].url)
        assertEquals(firstBlossomSha, refs[0].blossomSha256)
        assertEquals("https://blossom.example.com/$firstBlossomSha", refs[0].blossomUrl)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsFirstLocatorWhenLaterDuplicateLibvaultRefDropsTimestamp() {
        val md5 = "e".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book","libvault","$md5","","https://example.test/original.epub"],
                ["book","libvault","$md5","1700000010","https://example.test/secondary.epub"],
                ["libvault-added","$md5","0"],
                ["libvault-added","$md5","1700000007"],
                ["libvault-added","$md5","1700000015"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://example.test/original.epub", refs[0].url)
        assertEquals(1_700_000_007L, refs[0].addedAt)
    }

    @Test
    fun serializeSharedFavoriteTagsWithBookstrRefDoesNotEmitISBNTag() {
        val refs = listOf(
            SharedFavoriteRef(
                bookstrId = "book-id",
                isbn = "978-0-12-345-678-9",
                url = "https://example.test/read.epub",
            ),
        )
        val tags = JSONArray(NostrFavoritesRepository.serializeSharedFavoriteTags(refs))
        var hasBookTag = false
        var hasMetadataTag = false
        var hasIsbnTag = false

        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            when (tag.optString(0)) {
                "r" -> {}
                "book" -> hasBookTag = true
                "bookstr" -> hasMetadataTag = true
                "i" -> hasIsbnTag = true
            }
        }

        assertEquals(3, tags.length())
        assertEquals(true, hasBookTag)
        assertEquals(true, hasMetadataTag)
        assertFalse(hasIsbnTag)
    }
}
