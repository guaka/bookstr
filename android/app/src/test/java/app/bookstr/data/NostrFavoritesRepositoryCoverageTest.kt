package app.bookstr.data

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NostrFavoritesRepositoryCoverageTest {
    @Test
    fun ensureFavoriteAddedAtTagsIsCaseInsensitiveForMd5AndAvoidDuplicateTimestamp() {
        val md5 = "A".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """[
                ["libvault","$md5"],
                ["libvault-added","${md5.lowercase()}","1700000010"]
            ]""",
            1_700_000_000L,
        )

        val tags = JSONArray(result)
        var libvaultAddedCount = 0
        var loweredMd5 = ""
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            libvaultAddedCount++
            loweredMd5 = tag.optString(1)
        }

        assertEquals(1, libvaultAddedCount)
        assertEquals(md5.lowercase(), loweredMd5)
    }

    @Test
    fun parseSharedFavoriteTagsMergesDuplicateBlossomRefsKeepingEarliestTimestamp() {
        val sha = "b".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book","blossom","$sha","1700000010","https://example.com/one"],
                ["book","blossom","$sha","1700000005","https://example.com/two"],
                ["book","blossom","$sha","","https://example.com/three"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(sha, refs[0].blossomSha256)
        assertEquals(1_700_000_005L, refs[0].addedAt)
        assertEquals("https://example.com/one", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsLowercasesBlossomIdentifier() {
        val sha = "B".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book","blossom","$sha","1700000000","https://example.com/book.blob"],
                ["r","https://example.com/source"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("b".repeat(64), refs[0].blossomSha256)
    }

    @Test
    fun matchSharedFavoritesMatchesCatalogBySourceUrl() {
        val sourceUrl = "https://catalog.example.com/books/42"
        val refs = listOf(SharedFavoriteRef(url = sourceUrl))
        val books = listOf(
            CatalogBook(
                id = "book-id",
                title = "Catalog Book",
                author = "Writer",
                epubUrl = "https://cdn.example.com/books/42.epub",
                coverUrl = null,
                sourceUrl = sourceUrl,
            ),
        )

        val result = NostrFavoritesRepository.matchSharedFavorites(refs, books)
        assertEquals(setOf("book-id"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun ensureFavoriteAddedAtTagsKeepsInvalidLibvaultAddedRowsInInputAndAvoidsDuplicates() {
        val md5 = "a".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$md5","bad"],
              ["libvault-added","$md5","0"],
              ["libvault-added","$md5","1700000010"],
              ["libvault-added","$md5","1700000020"]
            ]""",
            1_700_000_000L,
        )
        val tags = JSONArray(result)
        var libvaultAddedCount = 0
        var addedTimestamp = 0L
        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            if (tag.optString(0) != "libvault-added") continue
            libvaultAddedCount++
            if (tag.optString(1) == md5) {
                addedTimestamp = tag.optString(2).toLongOrNull() ?: addedTimestamp
            }
        }

        assertEquals(2, libvaultAddedCount)
        assertEquals(1700000010L, addedTimestamp)
    }

    @Test
    fun parseSharedFavoriteTagsDeduplicatesCompactUrlRefsWithEarliestAddedAt() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["book","url","https://example.org/book.epub","1700000010"],
                ["book","url","https://example.org/book.epub","1700000005"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun ensureFavoriteAddedAtTagsSkipsFallbackWhenFallbackValueNotPositive() {
        val md5 = "d".repeat(32)
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """[
              ["libvault","$md5"]
            ]""",
            0L,
        )

        assertEquals("""[["libvault","$md5"]]""", result)
    }

    @Test
    fun parseSharedFavoriteTagsIgnoresInvalidIstagButDoesNotCreateRef() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "https://example.org/catalog/track?isbn=978-0-123456-78-9"],
              ["i", "isbn:not-an-isbn"]
            ]""",
        )

        assertEquals(0, refs.size)
    }

    @Test
    fun ensureFavoriteAddedAtTagsSkipsFallbackWhenNoMd5FavoritesExist() {
        val result = NostrFavoritesRepository.ensureFavoriteAddedAtTags(
            """[
              ["book","bookstr","source:42","1700000000","https://example.org/book.epub"],
              ["book","url","https://example.org/book.epub","1700000005"]
            ]""",
            1_700_000_000L,
        )

        assertEquals(-1, result.indexOf("\"libvault-added\""))
    }

    @Test
    fun parseSharedFavoriteTagsIgnoresInvalidBlossomIdentifierAndParsesValidOne() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","blossom","not-a-sha256","1700000000","https://example.org/not"],
              ["book","blossom","${"c".repeat(64)}","1700000005","https://example.org/valid"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("c".repeat(64), refs[0].blossomSha256)
        assertEquals("https://example.org/valid", refs[0].blossomUrl)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun matchSharedFavoritesMatchesByLibvaultMd5EvenWithDifferentSourceUrls() {
        val md5 = "e".repeat(32)
        val book = CatalogBook(
            id = "local-id",
            title = "Remote Book",
            author = "Author",
            epubUrl = "https://cdn.example.com/remote.epub",
            coverUrl = null,
            sourceUrl = "https://example.com/other",
            isbn = null,
            libvaultMd5 = md5,
        )

        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(libvaultMd5 = md5, url = "https://example.test/different.epub")),
            listOf(book),
        )

        assertEquals(setOf("local-id"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun matchSharedFavoritesKeepsUnmatchedStableRefAsExternalWithFallbackTitle() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    libvaultMd5 = "e".repeat(32),
                    title = "LibVault favorite",
                    url = "https://example.test/book.epub",
                ),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("MD5 ${"e".repeat(10)}…", result.external.single().title)
    }

    @Test
    fun matchSharedFavoritesPicksLibvaultMd5AsExternalKeyWhenBookstrIdAlsoExists() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    bookstrId = "legacy-book-id",
                    libvaultMd5 = "a".repeat(32),
                    title = null,
                    isbn = null,
                    url = null,
                ),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("a".repeat(32), result.external.single().key)
        assertEquals("MD5 ${"a".repeat(10)}…", result.external.single().title)
    }

    @Test
    fun matchSharedFavoritesKeepsUnmatchedIsbnAsExternalWithFallbackTitle() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    isbn = "978-0-1234-5678-9",
                ),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("9780123456789", result.external.single().key)
        assertEquals("ISBN 9780123456789", result.external.single().title)
    }

    @Test
    fun chunkManifestFallsBackToDefaultPrefixAndRejectsInvalidCount() {
        val manifest = NostrFavoritesRepository.chunkManifest(
            """[
              ["bookstr-chunks","2"]
            ]"""
        )
        assertEquals(2, manifest?.count)
        assertEquals("libvault-favorites-chunk", manifest?.prefix)

        assertEquals(null, NostrFavoritesRepository.chunkManifest("""[["libvault-chunks","0"]]"""))
    }

    @Test
    fun serializeSharedFavoriteTagsKeepsCanonicalFormAndLowercasesMd5Keys() {
        val refs = NostrFavoritesRepository.serializeSharedFavoriteTags(
            listOf(
                SharedFavoriteRef(
                    libvaultMd5 = "A".repeat(32),
                    title = "The Open Society",
                    author = "Karl Popper",
                    format = "epub",
                    year = "1945",
                    blossomSha256 = "B".repeat(64),
                    blossomUrl = "https://blossom.example/${"b".repeat(64)}",
                    addedAt = 1_700_000_000L,
                    url = "https://example.com/download.epub",
                    isbn = "978-0-123456-78-9",
                )
            )
        )
        val tags = JSONArray(refs)
        var hasResourceTag = false
        var hasLibvaultTag = false
        var hasLibvaultAddedTag = false
        var hasLibvaultBookTag = false
        var hasBlossomTag = false
        var hasIsbnTag = false
        var hasExplicitIsbnTag = false

        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            when (tag.optString(0)) {
                "r" -> hasResourceTag = true
                "libvault" -> {
                    hasLibvaultTag = true
                    assertEquals("a".repeat(32), tag.optString(1))
                }
                "libvault-added" -> {
                    hasLibvaultAddedTag = true
                    assertEquals("a".repeat(32), tag.optString(1))
                }
                "libvault-book" -> hasLibvaultBookTag = true
                "blossom" -> hasBlossomTag = true
                "isbn" -> hasIsbnTag = true
                "i" -> {
                    if (tag.optString(1) == "isbn:9780123456789") hasExplicitIsbnTag = true
                }
            }
        }

        assertEquals(true, hasResourceTag)
        assertEquals(true, hasLibvaultTag)
        assertEquals(true, hasLibvaultAddedTag)
        assertEquals(true, hasLibvaultBookTag)
        assertEquals(true, hasBlossomTag)
        assertEquals(false, hasIsbnTag)
        assertEquals(true, hasExplicitIsbnTag)
    }

    @Test
    fun parseSharedFavoriteTagsUsesPendingUrlForIsbnTag() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "https://example.org/fallback.epub"],
              ["i", "isbn:978-0-1234-5678-9"]
            ]""",
        )
        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://example.org/fallback.epub", refs[0].url)
    }

    @Test
    fun chunkManifestRejectsUnsupportedNamespace() {
        assertEquals(null, NostrFavoritesRepository.chunkManifest("""[["bookstr-chunk","3"]]"""))
        assertEquals(null, NostrFavoritesRepository.chunkManifest("""[["legacy","2"]]"""))
    }

    @Test
    fun serializeSharedFavoriteTagsForBookstrRefAddsOnlyExpectedTags() {
        val refs = NostrFavoritesRepository.serializeSharedFavoriteTags(
            listOf(
                SharedFavoriteRef(
                    bookstrId = "catalog:book:123",
                    title = "Sample Book",
                    author = "Author",
                    url = "https://example.com/read.epub",
                    format = "pdf",
                    isbn = "978-0-123456-78-9",
                    year = "2024",
                    addedAt = 1_700_000_001L,
                ),
            ),
        )
        val tags = JSONArray(refs)
        var hasUrlTag = false
        var hasBookTag = false
        var hasBookstrTag = false
        var hasIsbnTag = false
        var hasExplicitIsbn = false

        for (index in 0 until tags.length()) {
            val tag = tags.optJSONArray(index) ?: continue
            when (tag.optString(0)) {
                "r" -> {
                    hasUrlTag = true
                    assertEquals("https://example.com/read.epub", tag.optString(1))
                }
                "book" -> {
                    hasBookTag = true
                    assertEquals("bookstr", tag.optString(1))
                    assertEquals("catalog:book:123", tag.optString(2))
                }
                "bookstr" -> hasBookstrTag = true
                "isbn" -> hasIsbnTag = true
                "i" -> {
                    if (tag.optString(1) == "isbn:9780123456789") hasExplicitIsbn = true
                }
            }
        }

        assertEquals(true, hasUrlTag)
        assertEquals(true, hasBookTag)
        assertEquals(true, hasBookstrTag)
        assertEquals(false, hasIsbnTag)
        assertEquals(true, hasExplicitIsbn)
    }

    @Test
    fun parseSharedFavoriteTagsMergesDuplicateBookstrRefsAndKeepsEarliestTimestamp() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","bookstr","book-99","1700000010","https://example.com/one"],
              ["bookstr","book-99","Updated title","Updated author"],
              ["book","bookstr","book-99","1699999999","https://example.com/three"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("book-99", refs[0].bookstrId)
        assertEquals("Updated title", refs[0].title)
        assertEquals("Updated author", refs[0].author)
        assertEquals("https://example.com/one", refs[0].url)
        assertEquals(1_699_999_999L, refs[0].addedAt)
    }

    @Test
    fun chunkManifestRejectsOutOfRangeLargeCount() {
        assertEquals(null, NostrFavoritesRepository.chunkManifest("""[["libvault-chunks","10001"]]"""))
    }

    @Test
    fun parseSharedFavoriteTagsConsumesResourceFallbackForLibvaultTag() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "https://example.org/book.epub"],
              ["libvault", "$md5"],
              ["libvault-added", "$md5", "1700000100"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/book.epub", refs[0].url)
        assertEquals(1_700_000_100L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsMergesLibvaultBookMetadataWithEarliestTimestamp() {
        val md5 = "B".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000010","https://example.com/one"],
              ["libvault-book", "$md5", "Book title", "Book author", "epub", "", "", "2024"],
              ["libvault-added", "$md5", "1700000005"],
              ["libvault-book", "$md5", "", "", "pdf", "", "", "2000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("b".repeat(32), refs[0].libvaultMd5)
        assertEquals("Book title", refs[0].title)
        assertEquals("Book author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2024", refs[0].year)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }
    @Test
    fun parseSharedFavoriteTagsMergesDuplicateBlossomRefsAndKeepsEarliestTimestamp() {
        val sha = "c".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book","blossom","$sha","1700000010","https://example.org/one"],
                ["book","blossom","$sha","1700000005","https://example.org/two"],
                ["book","blossom","$sha","1700000011","https://example.org/three"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(sha, refs[0].blossomSha256)
        assertEquals("https://example.org/one", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsRetainsCurrentRefUrlForIstagWithoutLocator() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book","libvault","$md5","1700000010","https://example.org/base"],
                ["i","isbn:978-0-123456-78-9", ""],
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/base", refs[0].url)
        assertEquals("9780123456789", refs[0].isbn)
    }

    @Test
    fun parseSharedFavoriteTagsSkipsInvalidLibvaultAddedRowsAndKeepsEarliestTimestamp() {
        val md5 = "f".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """
              [
                ["book","libvault","$md5","1700000010","https://example.org/base"],
                ["libvault-added","$md5","not-a-number"],
                ["libvault-added","$md5","0"],
                ["libvault-added","$md5","1699999995"]
              ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("https://example.org/base", refs[0].url)
        assertEquals(1_699_999_995L, refs[0].addedAt)
    }

    @Test
    fun matchSharedFavoritesMatchesByBlossomSha256IgnoringCase() {
        val sha = "A".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(blossomSha256 = sha)),
            listOf(
                CatalogBook(
                    id = "catalog-id",
                    title = "Blossom Book",
                    author = "Author",
                    epubUrl = "https://example.com/blossom.epub",
                    coverUrl = null,
                    sourceUrl = "https://example.com/blossom.epub",
                    isbn = "9780123456789",
                    libvaultMd5 = "0".repeat(32),
                    format = BookFormat.Epub,
                    blossomSha256 = sha.lowercase(),
                    year = null,
                ),
            ),
        )

        assertEquals(setOf("catalog-id"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun matchSharedFavoritesFallsBackToDefaultExternalTitleWhenOnlyURLIsAvailable() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    url = "https://example.com/missing.epub",
                    title = null,
                ),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("https://example.com/missing.epub", result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
    }

    @Test
    fun parseSharedFavoriteTagsMergesBookstrMetadataByRef() {
        val bookstrId = "bookstr-collection-1234"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "$bookstrId", "1700000010", "https://example.com/one"],
              ["book", "bookstr", "$bookstrId", "1700000005", "https://example.com/two"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(bookstrId, refs[0].bookstrId)
        assertEquals("https://example.com/one", refs[0].url)
        assertEquals(1_700_000_005L, refs[0].addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsSkipsInvalidLibvaultTags() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault", "not-a-hash", "1700000010", "https://example.com/invalid"],
              ["libvault-book", "not-a-hash", "Bad title", "Bad author", "epub"]
            ]""",
        )

        assertEquals(0, refs.size)
    }

    @Test
    fun parseSharedFavoriteTagsUsesPendingUrlForIsbnWhenNoCurrentRef() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "https://books.example.com/pend.epub"],
              ["i", "isbn:978-0-12-345678-9"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs[0].isbn)
        assertEquals("https://books.example.com/pend.epub", refs[0].url)
    }

    @Test
    fun parseSharedFavoriteTagsMergesBookstrBookMetadata() {
        val md5 = "c".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000010", "https://example.com/base"],
              ["bookstr-book", "$md5", "", "", "pdf", "", "", "2001"],
              ["bookstr-book", "$md5", "New title", "New Author", "epub", "", "", "2002"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("New title", refs[0].title)
        assertEquals("New Author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2002", refs[0].year)
    }

    @Test
    fun ensureFavoriteAddedAtTagsLeavesInputUntouchedForNonPositiveFallback() {
        val input = """[
              ["book","libvault","${"b".repeat(32)}","1700000010","https://example.com/book.epub"]
            ]"""
        val output = NostrFavoritesRepository.ensureFavoriteAddedAtTags(input, 0L)

        assertEquals(input, output)
    }

    @Test
    fun serializeSharedFavoriteTagsUsesBookstrTagFamilyForListEntries() {
        val refs = listOf(
            SharedFavoriteRef(
                bookstrId = "bookstr-collection-99",
                title = "Collection",
                author = "Collector",
                year = "2024",
                format = "epub",
                url = "https://example.com/collection.epub",
                addedAt = 1_700_000_100L,
            ),
        )
        val tags = JSONArray(NostrFavoritesRepository.serializeSharedFavoriteTags(refs))
        assertEquals(3, tags.length())
        assertEquals("r", tags.getJSONArray(0).optString(0))
        assertEquals("book", tags.getJSONArray(1).optString(0))
        assertEquals("bookstr", tags.getJSONArray(2).optString(0))
        assertEquals("bookstr", tags.getJSONArray(1).optString(1))
        assertEquals("bookstr-collection-99", tags.getJSONArray(2).optString(1))
        assertEquals("Collection", tags.getJSONArray(2).optString(2))
    }

    @Test
    fun serializeSharedFavoriteTagsSkipsLegacyIsbnBookTagsForLibvaultRefs() {
        val refs = listOf(
            SharedFavoriteRef(
                libvaultMd5 = "a".repeat(32),
                isbn = "9780123456789",
                title = "Bound book",
                author = "Author",
                format = "epub",
                addedAt = 1_700_000_100L,
            ),
        )
        val tags = JSONArray(NostrFavoritesRepository.serializeSharedFavoriteTags(refs))
        assertEquals(3, tags.length())
        var hasLegacyIsbnBookTag = false
        for (index in 0 until tags.length()) {
            val tag = tags.getJSONArray(index)
            if (tag.optString(0) == "book" && tag.optString(1) == "isbn") {
                hasLegacyIsbnBookTag = true
            }
        }
        assertEquals(false, hasLegacyIsbnBookTag)
        assertEquals("i", tags.getJSONArray(2).optString(0))
    }
}
