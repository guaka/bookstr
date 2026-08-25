package app.bookstr.data

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NostrFavoritesRepositoryExtraCoverage3Test {
    @Test
    fun parseSharedFavoriteTagsKeepsMetadataFromLibvaultBookBeforeMembership() {
        val md5 = "b".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["libvault-book", "$md5", "Book title", "Book author", "pdf", "", "", "2001"],
                ["book", "libvault", "$md5", "1700000010", "https://example.test/read.epub"],
              ]
            """,
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Book title", refs[0].title)
        assertEquals("Book author", refs[0].author)
        assertEquals("pdf", refs[0].format)
        assertEquals("2001", refs[0].year)
        assertEquals("https://example.test/read.epub", refs[0].url)
        assertEquals(1_700_000_010L, refs[0].addedAt)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsFallbackTimestampForBlossomOnlyRefs() {
        val md5 = "c".repeat(32)
        val sha = "d".repeat(64)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["blossom", "$md5", "$sha", "https://blossom.example/file.epub"],
              ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var hasAddedRow = false
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            hasAddedRow = true
            assertEquals(md5, tag.optString(1))
            assertEquals("1700000000", tag.optString(2))
        }

        assertTrue(hasAddedRow)
    }

    @Test
    fun parseSharedFavoriteTagsReturnsNullWhenLibvaultIdentifierIsNotAValidMd5() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "zzzz", "1700000000", "https://example.org/book.epub"],
                ["libvault-added", "zzzz", "1700000001"],
              ]
            """,
        )

        assertEquals(0, refs.size)
        assertNull(refs.singleOrNull()?.libvaultMd5)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsPendingUrlAcrossInvalidIstag() {
        val md5 = "e".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["r", "https://example.org/fallback.epub"],
                ["i", "isbn:not-an-isbn"],
                ["i", "isbn:978-0-12-345-6789-7"],
                ["book", "libvault", "$md5", "1700000010", "https://example.org/base.epub"],
              ]""",
        )

        assertEquals(2, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
        assertEquals(md5, refs[1].libvaultMd5)
        assertEquals("https://example.org/base.epub", refs[1].url)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsEarliestAddedAtAcrossOutOfOrderLibvaultAddedRows() {
        val md5 = "f".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["libvault-added", "$md5", "1700000010"],
                ["book", "libvault", "$md5", "1700000020", "https://example.org/book.epub"],
                ["libvault-added", "$md5", "1700000005"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsLowercasesLibvaultMd5FromCompactReference() {
        val md5 = "A".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/base.epub"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5.lowercase(), refs[0].libvaultMd5)
    }

    @Test
    fun parseSharedFavoriteTagsSkipsInvalidBookIdAndKeepsValidCompanion() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["libvault-book", "not-an-md5", "Ignored", "Ignored"],
                ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/book.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsSkipsInvalidBlossomIdentifierThenKeepsValidOne() {
        val md5 = "c".repeat(32)
        val validSha = "d".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                ["blossom", "not-a-sha", "$md5", "https://blossom.example/invalid", "epub"],
                ["blossom", "$md5", "$validSha", "https://blossom.example/$validSha", "epub"],
                ["blossom", "$md5", "", "", ""]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(validSha, refs[0].blossomSha256)
        assertEquals("https://blossom.example/$validSha", refs[0].blossomUrl)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsUrlWhenBookstrMetadataOmitsFields() {
        val md5 = "b".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book", "libvault", "$md5", "1700000010", "https://example.org/first.epub"],
                ["bookstr-book", "$md5", "", "", "", "", "", ""],
                ["bookstr", "legacy-id", "Incoming title", "Incoming author"],
                ["book", "bookstr", "legacy-id", "1700000015", "https://example.org/secondary.epub"],
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals("https://example.org/first.epub", refs[0].url)
        assertEquals("Incoming title", refs[1].title)
        assertEquals("Incoming author", refs[1].author)
    }

    @Test
    fun parseSharedFavoriteTagsIgnoresUnsupportedBlossomFormatUntilValidFormatAppears() {
        val md5 = "c".repeat(32)
        val sha = "d".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book","libvault","$md5","1700000010","https://example.org/base.epub"],
                ["blossom","$md5","$sha","https://blossom.example/$sha","mobi"],
                ["blossom","$md5","$sha","","epub"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://blossom.example/$sha", refs[0].blossomUrl)
        assertEquals("epub", refs[0].format)
    }

    @Test
    fun parseSharedFavoriteTagsUsesFallbackUrlForIsbnWhenIstagHasBlankLocator() {
        val md5 = "e".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000010","https://example.org/base.epub"],
              ["i","isbn:978-0-12-345-6789-7",""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/base.epub", refs[0].url)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsLowercaseFromLibvaultBookReference() {
        val md5 = "B".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """[
                ["libvault-book", "${md5.uppercase()}", "Title", "Author", "epub", "", "2024"]
            ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var fallbackId = ""
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) == "libvault-added") {
                fallbackId = tag.optString(1)
            }
        }

        assertEquals(md5.lowercase(), fallbackId)
    }

    @Test
    fun parseSharedFavoriteTagsUsesPendingRAsFallbackUrlForBookstrTag() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["r", "https://example.org/fallback.epub"],
                ["bookstr", "catalog-id", "Catalog title", "Catalog author", ""]
              ]
            """,
        )

        assertEquals(1, refs.size)
        assertEquals("catalog-id", refs[0].bookstrId)
        assertEquals("Catalog title", refs[0].title)
        assertEquals("Catalog author", refs[0].author)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsMergesUppercaseLibvaultAddedWithMinTimestamp() {
        val md5 = "c".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                ["libvault-added", "${md5.uppercase()}", "1700000005"]
              ]
            """,
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun ensureFavoriteAddedAtTagsLowercasesBlossomMd5BeforeAddingFallbackTimestamp() {
        val md5 = "F".repeat(32)
        val sha = "A".repeat(64)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["blossom", "$md5", "$sha", "https://example.org/book.epub"],
                ["libvault", "abc", "1700000009"],
              ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var fallback = ""
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            fallback = tag.optString(1)
        }

        assertEquals(md5.lowercase(), fallback)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsFallbackForLibvaultBookRefWithUppercaseMd5() {
        val md5 = "B".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["libvault-book", "$md5", "title", "author", "epub", "", "2024"]
              ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var fallback = ""
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) == "libvault-added") {
                fallback = tag.optString(1)
            }
        }

        assertEquals(md5.lowercase(), fallback)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsCurrentUrlWhenIstagHasItsOwnLocator() {
        val md5 = "e".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/base.epub"],
                ["i", "isbn:978-0-12-345-6789-7", "https://example.org/override.epub"],
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/base.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsMergesBlossomMetadataWithoutOverwritingWithBlanks() {
        val md5 = "d".repeat(32)
        val originalSha = "a".repeat(64)
        val updatedSha = "b".repeat(64)
        val blossomUrl = "https://blossom.example/$originalSha"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000010", "https://example.org/base.epub"],
              ["blossom", "$md5", "", "$blossomUrl", "epub"],
              ["blossom", "$md5", "$updatedSha", "", ""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/base.epub", refs[0].url)
        assertEquals(updatedSha, refs[0].blossomSha256)
        assertEquals(blossomUrl, refs[0].blossomUrl)
        assertEquals("epub", refs[0].format)
    }

    @Test
    fun parseSharedFavoriteTagsMergesStandaloneBlossomAndMatchingUrlWithoutExplicitParent() {
        val md5 = "e".repeat(32)
        val sha = "b".repeat(64)
        val url = "https://blossom.example/$sha"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom", "$md5", "$sha", "$url", "epub"],
              ["book", "url", "$url", "1700000005"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(sha, refs[0].blossomSha256)
        assertEquals(url, refs[0].url)
        assertEquals("epub", refs[0].format)
    }

    @Test
    fun parseSharedFavoriteTagsKeepsExistingUrlWhenIstagProvidesNewLocator() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book", "url", "https://example.org/base.epub", "1700000010"],
                ["i", "isbn:978-0-12-345-6789-7", "https://example.org/override.epub"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/base.epub", refs[0].url)
    }

    @Test
    fun ensureFavoriteAddedAtTagsDoesNotDuplicateWhenAddedTimestampAlreadyPresent() {
        val md5 = "d".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["libvault-book", "$md5", "title", "author", "epub", "", "2024"],
                ["libvault-added", "$md5", "1700000010"],
              ]
            """,
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var addedCount = 0
        var addedValue: String? = null
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            addedCount += 1
            addedValue = tag.optString(2)
        }

        assertEquals(1, addedCount)
        assertEquals("1700000010", addedValue)
    }

    @Test
    fun matchSharedFavoritesExternalUsesUrlWhenNoIdentifierAvailable() {
        val url = "https://example.org/ghost.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    url = url,
                    title = "Ghost title",
                ),
            ),
            emptyList(),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(1, result.external.size)
        assertEquals(url, result.external.single().key)
        assertEquals("Ghost title", result.external.single().title)
    }

    @Test
    fun parseSharedFavoriteTagsPreservesUrlWhenLibvaultDuplicateHasNoLocator() {
        val md5 = "f".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/base.epub"],
                ["libvault", "$md5"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/base.epub", refs[0].url)
    }

    @Test
    fun ensureFavoriteAddedAtTagsDoesNotAddFallbackWhenFallbackAddedAtIsZero() {
        val md5 = "e".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["libvault-book", "$md5", "title", "author", "epub", "", "2024"]
              ]""",
            0L,
        )

        val tags = JSONArray(result)
        var addedCount = 0
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) == "libvault-added") {
                addedCount += 1
            }
        }

        assertEquals(0, addedCount)
    }

    @Test
    fun parseSharedFavoriteTagsUsesLowestValidLibvaultAddedTimestamp() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                ["libvault-added", "$md5", "bad"],
                ["libvault-added", "$md5", "1700000004"],
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(1_700_000_004L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsParsesUppercaseLibvaultAddedWithoutMetadata() {
        val md5 = "A".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[["libvault-added", "$md5", "1700000011"]]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5.lowercase(), refs[0].libvaultMd5)
        assertEquals(1_700_000_011L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsParsesLegacyLibvaultTagFromPendingUrlAndLowercasesMd5() {
        val md5 = "B".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["r", "https://example.org/fallback.epub"],
                ["libvault", "$md5"],
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5.lowercase(), refs[0].libvaultMd5)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsFallbackWhenOnlyInvalidAddedTimestampsExist() {
        val md5 = "c".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """
              [
                ["book", "libvault", "$md5", "1700000010", "https://example.org/book.epub"],
                ["libvault-added", "$md5", "0"],
                ["libvault-added", "$md5", "-1"],
              ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var fallbackCount = 0
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            if (tag.optString(1) != md5) continue
            if (tag.optString(2) == "1700000000") {
                fallbackCount += 1
            }
        }

        assertEquals(1, fallbackCount)
    }

    @Test
    fun matchSharedFavoritesOverwritesExternalFavoriteOnDuplicateKeyWithLatestTitle() {
        val md5 = "d".repeat(32)
        val url = "https://example.org/final.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    libvaultMd5 = md5,
                    title = "First favorite",
                ),
                SharedFavoriteRef(
                    libvaultMd5 = md5,
                    title = "Second favorite",
                    url = url,
                ),
            ),
            emptyList(),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.single().key)
        assertEquals("Second favorite", result.external.single().title)
        assertEquals(url, result.external.single().url)
    }

    @Test
    fun matchSharedFavoritesDeduplicatesExternalFavoritesByNormalizedIsbnKey() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    isbn = "978-0-12-345-6789-7",
                    title = "First title",
                ),
                SharedFavoriteRef(
                    isbn = "9780123456789",
                    title = "Second title",
                    url = "https://example.org/updated.epub",
                ),
            ),
            emptyList(),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(1, result.external.size)
        assertEquals("9780123456789", result.external.single().isbn)
        assertEquals("Second title", result.external.single().title)
        assertEquals("https://example.org/updated.epub", result.external.single().url)
    }
}
