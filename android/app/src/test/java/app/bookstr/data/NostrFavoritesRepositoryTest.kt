package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test
    fun parsesCompactVersionTwoFavorites() {
        val sha256 = "b".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
                ["bookstr-collection","2"],
                ["book","libvault","$md5","1700000000"],
                ["book","isbn","978-0-123456-78-9","1700000001","https://example.org/isbn"],
                ["book","blossom","$sha256","1700000002","https://blossom.example/$sha256"]
            ]""".trimIndent(),
        )

        assertEquals(3, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals(1700000000L, refs[0].addedAt)
        assertEquals("9780123456789", refs[1].isbn)
        assertEquals(sha256, refs[2].blossomSha256)
    }

    @Test
    fun recognizesCurrentAndLegacyChunkManifests() {
        assertEquals(
            FavoriteChunkManifest(3, "bookstr-chunk-generation"),
            NostrFavoritesRepository.chunkManifest(
                """[["bookstr-collection","2"],["bookstr-chunks","3","bookstr-chunk-generation"]]""",
            ),
        )
        assertEquals(
            FavoriteChunkManifest(2, "libvault-favorites-chunk"),
            NostrFavoritesRepository.chunkManifest("""[["libvault-chunks","2"]]"""),
        )
    }

    @Test
    fun rejectsMalformedChunkManifests() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","0","generation"]]"""))
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","many","generation"]]"""))
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","10001","generation"]]"""))
        assertNull(NostrFavoritesRepository.chunkManifest("""[["title","No chunks here"]]"""))
    }

    @Test
    fun parsesEveryCompactFavoriteNamespace() {
        val sha256 = "c".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","bookstr","openlibrary:OL1M","11","https://example.org/book"],
              ["book","url","https://example.org/file.epub","12"],
              ["book","isbn","9781234567897","13"],
              ["book","blossom","$sha256","14","https://blossom.bfr.ee/$sha256"]
            ]""",
        )

        assertEquals(4, refs.size)
        assertEquals("openlibrary:OL1M", refs[0].bookstrId)
        assertEquals("https://example.org/file.epub", refs[1].url)
        assertEquals("9781234567897", refs[2].isbn)
        assertEquals(sha256, refs[3].blossomSha256)
        assertEquals(14L, refs[3].addedAt)
    }

    @Test
    fun mergesPublicationDescriptorWithCompactMembership() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book","$md5","Title","Author","epub","123","2026"],
              ["book","libvault","$md5","1700000000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Title", refs.single().title)
        assertEquals("Author", refs.single().author)
        assertEquals("2026", refs.single().year)
        assertEquals(1700000000L, refs.single().addedAt)
    }

    @Test
    fun metadataOnlySearchFavoriteSurvivesSerialization() {
        val original = SharedFavoriteRef(
            bookstrId = "openlibrary:OL1M",
            title = "Metadata Book",
            author = "A Writer",
            addedAt = 1700000000L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals(original.bookstrId, parsed.bookstrId)
        assertEquals(original.title, parsed.title)
        assertEquals(original.author, parsed.author)
    }

    @Test
    fun matchesCompactBlossomFavoriteByHashIgnoringCase() {
        val sha256 = "abcdef".repeat(10) + "abcd"
        val ref = SharedFavoriteRef(blossomSha256 = sha256.uppercase())
        val book = CatalogBook(
            id = "downloaded",
            title = "Book",
            author = "Author",
            epubUrl = "book.epub",
            coverUrl = null,
            blossomSha256 = sha256,
        )

        val matched = NostrFavoritesRepository.matchSharedFavorites(listOf(ref), listOf(book))

        assertEquals(setOf("downloaded"), matched.bookIds)
        assertTrue(matched.external.isEmpty())
    }

    @Test
    fun ignoresInvalidCompactIdentifiers() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","not-an-md5","1"],
              ["book","isbn","123","2"],
              ["book","blossom","bad-hash","3"],
              ["book","bookstr","","4"]
            ]""",
        )

        assertTrue(refs.isEmpty())
    }

    @Test
    fun keepsExistingAddedAtInsteadOfAddingFallbackDuplicate() {
        val plaintext = """[["libvault","$md5"],["libvault-added","$md5","12"]]"""

        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 99)

        assertEquals(1, Regex("libvault-added").findAll(upgraded).count())
        assertEquals(12L, NostrFavoritesRepository.parseSharedFavoriteTags(upgraded).single().addedAt)
    }

    @Test
    fun serializesUrlOnlyFavoriteWithoutLosingMembership() {
        val original = SharedFavoriteRef(
            url = "https://example.org/publication.epub",
            addedAt = 123L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals(original.url, parsed.url)
        assertEquals(original.addedAt, parsed.addedAt)
    }

    @Test
    fun serializesBlossomOnlyFavoriteWithoutLosingHash() {
        val sha256 = "d".repeat(64)
        val original = SharedFavoriteRef(
            blossomSha256 = sha256,
            blossomUrl = "https://blossom.bfr.ee/$sha256",
            addedAt = 321L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals(sha256, parsed.blossomSha256)
        assertEquals(original.blossomUrl, parsed.blossomUrl)
        assertEquals(321L, parsed.addedAt)
    }

    @Test
    fun compactMembershipBeforeDescriptorAlsoMerges() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","50"],
              ["libvault-book","$md5","Later title","Later author","pdf","99","2023"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Later title", refs.single().title)
        assertEquals("pdf", refs.single().format)
        assertEquals(50L, refs.single().addedAt)
    }

    @Test
    fun normalizesValidIsbnsAndRejectsOtherLengths() {
        assertEquals("9780123456789", NostrFavoritesRepository.normalizeIsbn("978-0-123-45678-9"))
        assertEquals("012345678X", NostrFavoritesRepository.normalizeIsbn("0-123-45678-x"))
        assertEquals("", NostrFavoritesRepository.normalizeIsbn("12345"))
        assertEquals("", NostrFavoritesRepository.normalizeIsbn(null))
    }

    @Test
    fun matchesFavoriteBySourceUrl() {
        val url = "https://example.org/book.epub"
        val book = CatalogBook(
            id = "local-id",
            title = "Book",
            author = "Author",
            epubUrl = url,
            coverUrl = null,
            sourceUrl = url,
        )

        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = url)),
            listOf(book),
        )

        assertEquals(setOf("local-id"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun mixedCompactAndLegacyLibvaultMembershipIsDeduplicated() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","15"],
              ["r","https://example.org/book"],
              ["libvault","$md5"],
              ["libvault-book","$md5","Title","Author","epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://example.org/book", refs.single().url)
        assertEquals("Title", refs.single().title)
        assertEquals(15L, refs.single().addedAt)
    }

    @Test
    fun mixedCompactAndLegacyBookstrMembershipIsDeduplicated() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","bookstr","source:42","20","https://example.org/read"],
              ["bookstr","source:42","Title","Author",""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Title", refs.single().title)
        assertEquals("Author", refs.single().author)
        assertEquals("https://example.org/read", refs.single().url)
    }

    @Test
    fun repeatedAddedAtTagsKeepEarliestTime() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$md5","50"],
              ["libvault-added","$md5","30"]
            ]""",
        )

        assertEquals(30L, refs.single().addedAt)
    }

    @Test
    fun unmatchedFavoriteGetsStableExternalFallback() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(bookstrId = "source:7", addedAt = 9L)),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("source:7", result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
        assertEquals(9L, result.external.single().addedAt)
    }

    @Test
    fun invalidAddedAtValuesAreIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[["book","bookstr","source:1","-2"],["book","bookstr","source:2","n/a"]]""",
        )

        assertEquals(2, refs.size)
        assertTrue(refs.all { it.addedAt == null })
    }
}
