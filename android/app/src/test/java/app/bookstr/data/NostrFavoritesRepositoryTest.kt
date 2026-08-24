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
    fun chunkManifestDefaultsEmptyPrefixToCanonicalName() {
        assertEquals(
            FavoriteChunkManifest(4, "libvault-favorites-chunk"),
            NostrFavoritesRepository.chunkManifest("""[["libvault-chunks","4",""]]"""),
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
    fun compactUnsupportedFormatIsIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","bookstr","source:42","1700000000"],
              ["bookstr-book", "source:42", "Unsupported format", "Author Name", "txt", "11", "2024"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Unsupported format", refs.single().title)
        assertEquals("Author Name", refs.single().author)
        assertNull(refs.single().format)
        assertEquals("2024", refs.single().year)
        assertEquals(1_700_000_000L, refs.single().addedAt)
    }

    @Test
    fun mixedTypeCompactTagsIgnoreInvalidValuesAndParseRemaining() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", 123, "$md5", "1700000000"],
              ["book", "libvault", "$md5", "1700000001", "https://example.org/book.epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book.epub", refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
    }

    @Test
    fun pendingUrlIsPreservedWhenInvalidBookstrIdentifierIsSkipped() {
        val url = "https://example.org/books/track?source=openlibrary:OL9M"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["book", "bookstr", "", "1700000000"],
              ["book", "bookstr", "openlibrary:OL9M", "1700000001"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("openlibrary:OL9M", refs.single().bookstrId)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun pendingUrlIsPreservedWhenInvalidIsbnTagIsSkipped() {
        val url = "https://example.org/books/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["i", "isbn:not-an-isbn", "1700000000"],
              ["book", "bookstr", "openlibrary:OL9M", "1700000001"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("openlibrary:OL9M", refs.single().bookstrId)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun invalidIsbnTagAfterMembershipDoesNotOverwriteFavorite() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "source:42", "1700000000", "https://example.org/read"],
              ["i", "isbn:not-an-isbn", ""],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("source:42", refs.single().bookstrId)
        assertEquals("https://example.org/read", refs.single().url)
    }

    @Test
    fun currentIstagDoesNotOverwriteExistingUrl() {
        val existingUrl = "https://example.org/read/original"
        val locator = "https://example.org/read/ignored"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000000", "$existingUrl"],
              ["i", "isbn:978-0-123456-78-9", "$locator"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(existingUrl, refs.single().url)
    }

    @Test
    fun nonIsbnTagIsIgnoredWithoutReplacingCurrentFavorite() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "source:42", "1700000000", "https://example.org/read"],
              ["i", "not-a-supported-tag", "https://example.org/other"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("source:42", refs.single().bookstrId)
        assertEquals("https://example.org/read", refs.single().url)
    }

    @Test
    fun ignoredCompactTagsDoNotBlockSubsequentIsbnTag() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "source:42", "1700000000", "https://example.org/read"],
              ["book", "mystery", "ignored", "1700000001"],
              ["i", "isbn:978-0-123456-78-9", ""],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("source:42", refs.single().bookstrId)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals("https://example.org/read", refs.single().url)
    }

    @Test
    fun compactFavoriteSkipsInvalidAddedAtButKeepsNextTimestamp() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "invalid", "https://example.org/first"],
              ["book", "libvault", "$md5", "1700000001", "https://example.org/book"],
              ["libvault-added", "$md5", "1700000002"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book", refs.single().url)
        assertEquals(1_700_000_002L, refs.single().addedAt)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsOnlyToKnownFavorites() {
        val otherMd5 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        val plaintext = """[
          ["libvault","$md5"],
          ["libvault-book","$md5","A Book","An Author","epub","1234","2024"],
          ["libvault","$otherMd5"],
          ["libvault-book","$otherMd5","Other","Author","epub","1235","2025"],
          ["book","libvault","$md5","1700000001","https://example.org/book"],
          ["book","blossom","not-a-sha","1700000002","https://bad.example/bla"],
          ["libvault-added","$otherMd5","1700000003"]
        ]"""

        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_700_000_010L)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded)

        assertEquals(3, Regex("\"libvault-added\"").findAll(upgraded).count())
        assertEquals(2, refs.size)
        assertEquals(1_700_000_001L, refs.single { it.libvaultMd5 == md5 }.addedAt)
        assertEquals(1_700_000_003L, refs.single { it.libvaultMd5 == otherMd5 }.addedAt)
    }

    @Test
    fun libvaultAddedWithUppercaseIdentifierIsNormalized() {
        val uppercaseMd5 = md5.uppercase()
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$uppercaseMd5","1700000000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(1_700_000_000L, refs.single().addedAt)
    }

    @Test
    fun mixedTypeTopLevelItemsInObjectPayloadAreIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              123,
              {"invalid":"payload"},
              ["i", "isbn:0000", "1700000000"],
              ["book", "libvault", "$md5", "1700000001", "https://example.org/book"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book", refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
    }

    @Test(expected = org.json.JSONException::class)
    fun objectPayloadForFavoritesIsRejected() {
        NostrFavoritesRepository.parseSharedFavoriteTags("""{"tags":[["libvault","$md5"]]}""")
    }

    @Test
    fun parseSharedFavoriteTagsSkipsInvalidTopLevelItems() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              "not-a-tag",
              123,
              {"note":"invalid"},
              ["book", "libvault", "$md5", "1700000001", "https://example.org/book"]
            ]"""
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book", refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
    }

    @Test
    fun serializesAndParsesBookstrFavoriteWithoutIsbn() {
        val original = SharedFavoriteRef(
            bookstrId = "openlibrary:OL9M",
            title = "Open Book",
            author = "Open Author",
            url = "https://example.org/books/9",
            addedAt = 777L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals(original.bookstrId, parsed.bookstrId)
        assertEquals(original.title, parsed.title)
        assertEquals(original.author, parsed.author)
        assertEquals(original.url, parsed.url)
        assertEquals(original.addedAt, parsed.addedAt)
    }

    @Test
    fun compactIsbnSkipsInvalidValueAndKeepsValidOne() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","isbn","abc","1"],
              ["book","isbn","978-0-123456-78-9","2"],
              ["book","isbn","0000","3"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(2L, refs.single().addedAt)
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
    fun bookstrFavoriteWithIsbnSerializesAndParsesBackIntoOneRef() {
        val original = SharedFavoriteRef(
            bookstrId = "openlibrary:OL2M",
            isbn = "978-0-1234-5678-9",
            title = "Metadata Book",
            url = "https://books-api.guaka.org/api/books/12345",
            addedAt = 222L,
        )
        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        )

        assertEquals(1, parsed.size)
        assertEquals(original.bookstrId, parsed.single().bookstrId)
        assertEquals("978123456789", parsed.single().isbn)
        assertEquals(original.addedAt, parsed.single().addedAt)
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
    fun compactFavoriteNamespaceNormalizesUppercaseLibvaultIdentifiers() {
        val uppercaseMd5 = md5.uppercase()
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$uppercaseMd5","1700000000","https://example.org/book"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book", refs.single().url)
    }

    @Test
    fun pendingUrlAppliesToCompactIsbnFavorite() {
        val url = "https://lib.b.bfr.ee/books/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["book","isbn","978-0-123456-78-9","1700000000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(1700000000L, refs.single().addedAt)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun currentCompactRefKeepsUrlWhenAttachingIsbnFromCurrentTag() {
        val url = "https://example.org/book.epub"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000000","$url"],
              ["i","isbn:978-0-123456-78-9",""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(url, refs.single().url)
        assertEquals("9780123456789", refs.single().isbn)
    }

    @Test
    fun compactUppercaseLibvaultMembershipIsLowercasedAndMergedWithMetadata() {
        val md5 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000000","https://example.org/book.epub"],
              ["libvault-book","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Lowercase title","Lowercase author","epub","1","2024"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", refs.single().libvaultMd5)
        assertEquals("Lowercase title", refs.single().title)
        assertEquals("Lowercase author", refs.single().author)
        assertEquals("epub", refs.single().format)
        assertEquals("2024", refs.single().year)
        assertEquals(1700000000L, refs.single().addedAt)
    }

    @Test
    fun compactMetadataWithEmptyFieldsDoesNotOverwriteExistingValues() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-book", "$md5", "Original title", "Original author", "epub", "111", "2001"],
              ["book", "libvault", "$md5", "1700000000", "https://example.org/book"],
              ["libvault-book", "$md5", "", "", "", "", ""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("Original title", refs.single().title)
        assertEquals("Original author", refs.single().author)
        assertEquals("epub", refs.single().format)
        assertEquals("2001", refs.single().year)
        assertEquals("https://example.org/book", refs.single().url)
        assertEquals(1_700_000_000L, refs.single().addedAt)
    }

    @Test
    fun pendingUrlAppliesToLegacyBookstrMembership() {
        val url = "https://example.org/book/track?source=openlibrary:OL1M"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["bookstr", "openlibrary:OL1M", "Legacy title", "Legacy author", ""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("openlibrary:OL1M", refs.single().bookstrId)
        assertEquals("Legacy title", refs.single().title)
        assertEquals("Legacy author", refs.single().author)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun invalidIsbnTagDoesNotConsumePendingUrl() {
        val url = "https://lib.b.bfr.ee/books/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["i", "isbn:abc"],
              ["i", "isbn:978-0-123456-78-9"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun standaloneIstagUsesPendingUrlWhenNoCurrentRefExists() {
        val url = "https://lib.b.bfr.ee/books/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["i", "isbn:978-0-123456-78-9"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(url, refs.single().url)
        assertNull(refs.single().libvaultMd5)
        assertNull(refs.single().bookstrId)
    }

    @Test
    fun standaloneIstagUsesProvidedLocatorWithoutPendingUrl() {
        val locator = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["i", "isbn:978-0-123456-78-9", "$locator"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(locator, refs.single().url)
        assertNull(refs.single().libvaultMd5)
        assertNull(refs.single().bookstrId)
    }

    @Test
    fun compactMetadataWithUnsupportedFormatThenOverwriteByLaterDescriptor() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000", "https://example.org/book.epub"],
              ["libvault-book", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Metadata title", "Metadata author", "txt", "1", "1999"],
              ["libvault-book", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Updated title", "Updated author", "epub", "2", "2000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Updated title", refs.single().title)
        assertEquals("Updated author", refs.single().author)
        assertEquals("epub", refs.single().format)
        assertEquals(1700000000L, refs.single().addedAt)
        assertEquals("2000", refs.single().year)
    }

    @Test
    fun preservesEarliestAddedAtFromDuplicateAddedAtTags() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$md5","90"],
              ["libvault-added","$md5","50"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(50L, refs.single().addedAt)
    }

    @Test
    fun matchesFavoritesByNormalizedIsbn() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(isbn = "978-0-123456-78-9", url = "https://isbn.example")),
            listOf(
                CatalogBook(
                    id = "isbn-book",
                    title = "Normalized ISBN Book",
                    author = "Author",
                    epubUrl = "https://isbn.example/one",
                    coverUrl = null,
                    isbn = "9780123456789",
                ),
            ),
        )

        assertEquals(setOf("isbn-book"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun invalidCompactUrlIsSkipped() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "url", "not-a-url", "1700000000"],
              ["book", "url", "https://books-api.guaka.org/api/books/12345/download", "1700000001"],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("https://books-api.guaka.org/api/books/12345/download", refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
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
    fun matchesFavoriteByBlossomHashCaseInsensitive() {
        val sha = "abcdef".repeat(10) + "abcd"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(blossomSha256 = sha.uppercase())),
            listOf(
                CatalogBook(
                    id = "downloaded",
                    title = "Book",
                    author = "Author",
                    epubUrl = "book.epub",
                    coverUrl = null,
                    blossomSha256 = sha,
                ),
            ),
        )

        assertEquals(setOf("downloaded"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun matchesFavoriteByLibvaultMd5CaseInsensitive() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(libvaultMd5 = md5)),
            listOf(
                CatalogBook(
                    id = "local-id",
                    title = "Uppercase MD5",
                    author = "Author",
                    epubUrl = "local.epub",
                    coverUrl = null,
                    sourceUrl = null,
                    isbn = null,
                    libvaultMd5 = md5.uppercase(),
                ),
            ),
        )

        assertEquals(setOf("local-id"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun invalidLibvaultAddedValuesAreIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$md5","bad"],
              ["libvault-added","$md5","0"],
              ["libvault-added","$md5","1700000005"],
              ["libvault-added","$md5","1700000000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(1700000000L, refs.single().addedAt)
    }

    @Test
    fun addedAtTagsForUnknownFavoritesDoNotPreventParsing() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-added","$md5","1700000000"],
              ["libvault","$md5"],
              ["libvault-added","not-a-key","1700000001"],
              ["book","bookstr","source:2","1700000002"]
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals(1_700_000_000L, refs.single { it.libvaultMd5 == md5 }.addedAt)
        assertEquals(1_700_000_002L, refs.single { it.bookstrId == "source:2" }.addedAt)
    }

    @Test
    fun unmatchedLibvaultAddedTagBecomesSingleTimestampedRef() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-added","$md5","1700000000"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(1_700_000_000L, refs.single().addedAt)
    }

    @Test
    fun compactMembershipWithoutAddedAtFallsBackToAddedAtTag() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault","$md5"],
              ["libvault-added","$md5","1690000000"],
              ["book","bookstr","source:42","0"],
              ["book","bookstr","source:42","-1"]
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals(1_690_000_000L, refs.single { it.libvaultMd5 == md5 }.addedAt)
        assertNull(refs.first { it.bookstrId == "source:42" }.addedAt)
    }

    @Test
    fun serializeAndParseUrlOnlyFavoritePreservesUrlAndAddedAt() {
        val original = SharedFavoriteRef(
            url = "https://example.org/book.epub",
            title = null,
            addedAt = 123456789L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        )

        assertEquals(1, parsed.size)
        assertEquals(original.url, parsed.single().url)
        assertEquals(123_456_789L, parsed.single().addedAt)
    }

    @Test
    fun serializeOmitsInvalidAddedAtForLibVaultFavorite() {
        val original = SharedFavoriteRef(
            libvaultMd5 = md5,
            title = "No timestamp",
            author = "Author",
            addedAt = 0L,
        )

        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertNull(refs.single().addedAt)
    }

    @Test
    fun matchesFavoriteBySourceUrlInCatalogBooksFromSourceField() {
        val source = "https://example.org/source/book.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = source)),
            listOf(
                CatalogBook(
                    id = "remote",
                    title = "Source URL Match",
                    author = "Author",
                    epubUrl = source,
                    coverUrl = null,
                    sourceUrl = "https://unused.example.com",
                ),
            ),
        )

        assertEquals(setOf("remote"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun compactBlossomFavoriteIsNormalizedToLowercaseInCompactNamespace() {
        val sha = "ABCDEF".repeat(10) + "ABCD"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","blossom","$sha","1700000000","https://blossom.bfr.ee/$sha","epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(sha.lowercase(), refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha", refs.single().blossomUrl)
    }

    @Test
    fun parsesLegacyBlossomTagWithoutMembership() {
        val sha = "f".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom", "$md5", "$sha", "https://blossom.bfr.ee/$sha", "epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(sha, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha", refs.single().blossomUrl)
        assertEquals("epub", refs.single().format)
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
    fun duplicateIsbnRefsMatchCatalogBookByNormalizedIsbn() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(isbn = "978-0-123456-78-9", title = "Legacy match"),
                SharedFavoriteRef(isbn = "9780123456789", title = "Current match"),
            ),
            listOf(
                CatalogBook(
                    id = "book-isbn-1",
                    title = "Catalog ISBN",
                    author = "Author",
                    epubUrl = "https://example.org/book.epub",
                    coverUrl = null,
                    isbn = "978-0-123456-78-9",
                ),
            ),
        )

        assertEquals(setOf("book-isbn-1"), result.bookIds)
        assertTrue(result.external.isEmpty())
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
    fun unmatchedFavoritePreservesMetadataInExternalFallback() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    bookstrId = "source:8",
                    title = "Offline favorite",
                    author = "Legacy author",
                    addedAt = 13L,
                ),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("source:8", result.external.single().key)
        assertEquals("Offline favorite", result.external.single().title)
        assertEquals("Legacy author", result.external.single().author)
        assertEquals(13L, result.external.single().addedAt)
    }

    @Test
    fun unmatchedUrlFavoritePreservesFallbackTitleForExternal() {
        val source = "https://example.org/unknown.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = source)),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(source, result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
        assertEquals(source, result.external.single().url)
    }

    @Test
    fun unmatchedLibvaultFavoriteUsesDefaultExternalTitle() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(libvaultMd5 = md5)),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
        assertEquals(md5, result.external.single().libvaultMd5)
    }

    @Test
    fun unmatchedIsbnFavoriteUsesDefaultExternalTitle() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(isbn = "978-0-123456-78-9")),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("9780123456789", result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
    }

    @Test
    fun unmatchedBlossomFavoriteUsesDefaultExternalTitle() {
        val sha = "a".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(blossomSha256 = sha)),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(sha, result.external.single().key)
        assertEquals("LibVault favorite", result.external.single().title)
        assertEquals(sha, result.external.single().blossomSha256)
    }

    @Test
    fun unmatchedIsbnDuplicatePreservesLatestMetadata() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(isbn = "978-0-123456-78-9", title = "First"),
                SharedFavoriteRef(isbn = "9780123456789", title = "Latest"),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("9780123456789", result.external.single().key)
        assertEquals("Latest", result.external.single().title)
    }

    @Test
    fun unmatchedUrlFavoritePrefersLatestTitleWhenDuplicateRefKeysRepeat() {
        val url = "https://example.org/duplicate.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(url = url, title = "First title"),
                SharedFavoriteRef(url = url, title = "Latest title"),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(url, result.external.single().key)
        assertEquals("Latest title", result.external.single().title)
    }

    @Test
    fun unmatchedLibvaultFavoritePrefersLatestMetadataForDuplicateKeys() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(libvaultMd5 = md5, title = "Legacy", year = "1999", author = "Old"),
                SharedFavoriteRef(libvaultMd5 = md5, title = "Current", year = "2020", author = "New"),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.single().key)
        assertEquals("Current", result.external.single().title)
        assertEquals("New", result.external.single().author)
        assertEquals("2020", result.external.single().year)
    }

    @Test
    fun unmatchedBlossomFavoritePrefersLatestMetadataForDuplicateKeys() {
        val sha = "d".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(blossomSha256 = sha, title = "Legacy", author = "Old author"),
                SharedFavoriteRef(blossomSha256 = sha, title = "Current", author = "Current author"),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(sha, result.external.single().key)
        assertEquals("Current", result.external.single().title)
        assertEquals("Current author", result.external.single().author)
    }

    @Test
    fun duplicateBlossomRefsMatchCatalogBookByBlossomHash() {
        val sha = "f".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(blossomSha256 = sha),
                SharedFavoriteRef(blossomSha256 = sha),
            ),
            listOf(
                CatalogBook(
                    id = "book-blossom",
                    title = "Catalog Blossoms",
                    author = "Author",
                    epubUrl = "https://example.org/book.epub",
                    coverUrl = null,
                    blossomSha256 = sha,
                ),
            ),
        )

        assertEquals(setOf("book-blossom"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun duplicateMatchedRefsNeverCreateExternalFallback() {
        val isbn = "9780123456789"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(isbn = isbn, url = "https://example.org/first.epub"),
                SharedFavoriteRef(isbn = isbn, url = "https://example.org/latest.epub", title = "Later"),
            ),
            listOf(
                CatalogBook(
                    id = "book",
                    title = "Downloaded",
                    author = "Author",
                    epubUrl = "https://example.org/latest.epub",
                    coverUrl = null,
                    isbn = isbn,
                ),
            ),
        )

        assertEquals(setOf("book"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun pendingUrlSurvivesUnknownCompactTagUntilKnownTagConsumesIt() {
        val url = "https://example.org/book.epub"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$url"],
              ["book","mystery","ignored","1700000000"],
              ["libvault", "$md5"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun matchesFavoriteBySourceUrlInCatalogBooks() {
        val source = "https://example.org/source/book.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = source)),
            listOf(
                CatalogBook(
                    id = "remote",
                    title = "Source URL Match",
                    author = "Author",
                    epubUrl = "https://unused.example.com",
                    coverUrl = null,
                    sourceUrl = source,
                    isbn = null,
                    libvaultMd5 = null,
                    format = "",
                    blossomSha256 = null,
                    year = null,
                ),
            ),
        )

        assertEquals(setOf("remote"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun invalidAddedAtValuesAreIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[["book","bookstr","source:1","-2"],["book","bookstr","source:2","n/a"]]""",
        )

        assertEquals(2, refs.size)
        assertTrue(refs.all { it.addedAt == null })
    }

    @Test
    fun bookstrFavoritePreservesAddedAtAcrossSerialization() {
        val original = SharedFavoriteRef(
            bookstrId = "openlibrary:OL42M",
            title = "Title",
            author = "Author",
            url = "https://example.org/read",
            addedAt = 777L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals(777L, parsed.addedAt)
        assertEquals("Title", parsed.title)
        assertEquals("Author", parsed.author)
    }

    @Test
    fun isbnOnlyFavoritePreservesAddedAtAcrossSerialization() {
        val original = SharedFavoriteRef(
            isbn = "978-0-123456-78-9",
            url = "https://example.org/isbn",
            addedAt = 888L,
        )

        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags(
            NostrFavoritesRepository.serializeSharedFavoriteTags(listOf(original)),
        ).single()

        assertEquals("9780123456789", parsed.isbn)
        assertEquals(888L, parsed.addedAt)
        assertEquals(original.url, parsed.url)
    }

    @Test
    fun repeatedCompactMembershipKeepsEarliestAddedAt() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","bookstr","source:1","90"],
              ["book","bookstr","source:1","40"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(40L, refs.single().addedAt)
    }

    @Test
    fun nonPositiveFallbackLeavesPlaintextUnchanged() {
        val plaintext = """[["libvault","$md5"]]"""

        assertEquals(plaintext, NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 0))
        assertEquals(plaintext, NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, -1))
    }

    @Test(expected = org.json.JSONException::class)
    fun malformedFavoritePayloadIsRejected() {
        NostrFavoritesRepository.parseSharedFavoriteTags("not json")
    }

    @Test
    fun duplicateLibvaultMembershipKeepsEarliestAddedAt() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000005", "https://example.org/first"],
              ["book", "libvault", "$md5", "1700000001", "https://example.org/second"],
              ["libvault-book", "$md5", "Latest title", "Latest author", "epub", "123", "2024"],
              ["libvault-added", "$md5", "1700000003"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(1_700_000_001L, refs.single().addedAt)
        assertEquals("Latest title", refs.single().title)
        assertEquals("https://example.org/first", refs.single().url)
    }

    @Test
    fun unmatchedBlossomFavoriteBecomesExternalWithTitleAndAuthor() {
        val sha = "f".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(blossomSha256 = sha, title = "Blossom Book", author = "Offline author")),
            emptyList(),
        )

        assertTrue(result.bookIds.isEmpty())
        assertEquals(1, result.external.size)
        assertEquals(sha, result.external[0].key)
        assertEquals("Blossom Book", result.external[0].title)
        assertEquals("Offline author", result.external[0].author)
    }

    @Test
    fun duplicateCompactUrlEntriesAreDeduplicatedByUrlAndKeepEarliestAddedAt() {
        val url = "https://example.org/duplicate.url"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "url", "$url", "1700000010"],
              ["book", "url", "$url", "1700000002", ""],
              ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000015"]
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals(url, refs[0].url)
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", refs[1].libvaultMd5)
        assertEquals(1_700_000_010L, refs[0].addedAt)
    }

    @Test
    fun urlFavoriteMergesWithLaterLibvaultMembership() {
        val url = "https://example.org/shared.epub"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "url", "$url", "1700000042"],
              ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000043", "https://override.example.org/book.epub"],
              ["libvault-book", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Merged title", "Merged author", "epub", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", refs.single().libvaultMd5)
        assertEquals("Merged title", refs.single().title)
        assertEquals("Merged author", refs.single().author)
        assertEquals("epub", refs.single().format)
        assertEquals("2026", refs.single().year)
        assertEquals(url, refs.single().url)
        assertEquals(1_700_000_042L, refs.single().addedAt)
    }

    @Test
    fun fillsMissingUrlFromCurrentIstagLocator() {
        val url = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000000"],
              ["i", "isbn:978-0-123456-78-9", "$url"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(url, refs.single().url)
    }

    @Test
    fun currentIstagDoesNotOverwriteExistingUrlFromCurrentRef() {
        val existingUrl = "https://example.org/read/original"
        val replacementUrl = "https://example.org/read/replaced"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "source:42", "1700000000", "$existingUrl"],
              ["i", "isbn:978-0-123456-78-9", "$replacementUrl"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("source:42", refs.single().bookstrId)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(existingUrl, refs.single().url)
    }

    @Test
    fun standaloneIstagUsesPendingUrlAfterInvalidIstag() {
        val pendingUrl = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$pendingUrl"],
              ["i", "isbn:not-an-isbn", "https://example.org/ignored"],
              ["i", "isbn:978-0-123456-78-9", ""],
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals(pendingUrl, refs.single().url)
    }

    @Test
    fun laterLibvaultMembershipDoesNotOverwriteExistingUrlFromEarlierRecord() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val originalUrl = "https://example.org/original-book.epub"
        val laterUrl = "https://example.org/ignored-override.epub"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000042", "$originalUrl"],
              ["book", "url", "$laterUrl", "1700000043"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(originalUrl, refs.single().url)
        assertEquals(1_700_000_042L, refs.single().addedAt)
    }

    @Test
    fun unmatchedBookstrDuplicateRefsPreferLatestMetadata() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(bookstrId = "source:42", title = "Legacy title", author = "Old author"),
                SharedFavoriteRef(bookstrId = "source:42", title = "Current title", author = "Current author"),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals("source:42", result.external.single().key)
        assertEquals("Current title", result.external.single().title)
        assertEquals("Current author", result.external.single().author)
    }

    @Test
    fun duplicateBookstrRefsMatchCatalogBookBySourceId() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(bookstrId = "source:42", title = "Legacy title", author = "Old author"),
                SharedFavoriteRef(bookstrId = "source:42", title = "Current title", author = "Current author"),
            ),
            listOf(
                CatalogBook(
                    id = "source:42",
                    title = "Catalog title",
                    author = "Catalog author",
                    epubUrl = "https://example.org/book.epub",
                    coverUrl = null,
                ),
            ),
        )

        assertEquals(setOf("source:42"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun emptyFavoriteArrayMatchesNothing() {
        val parsed = NostrFavoritesRepository.parseSharedFavoriteTags("[]")
        val matched = NostrFavoritesRepository.matchSharedFavorites(parsed, emptyList())

        assertTrue(parsed.isEmpty())
        assertTrue(matched.bookIds.isEmpty())
        assertTrue(matched.external.isEmpty())
    }
}
