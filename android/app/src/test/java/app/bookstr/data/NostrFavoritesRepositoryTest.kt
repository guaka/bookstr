package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun chunkManifestAcceptsMaximumBoundaryCount() {
        assertEquals(
            FavoriteChunkManifest(10_000, "bookstr-boundary"),
            NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","10000","bookstr-boundary"]]"""),
        )
    }

    @Test
    fun chunkManifestDefaultsMissingBookstrPrefixToCanonicalName() {
        assertEquals(
            FavoriteChunkManifest(2, "libvault-favorites-chunk"),
            NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","2"]]"""),
        )
    }

    @Test
    fun chunkManifestSkipsNoiseAndParsesValidEntry() {
        assertEquals(
            FavoriteChunkManifest(2, "bookstr-chunk-generation"),
            NostrFavoritesRepository.chunkManifest(
                """[
                  ["title","Favorites"],
                  ["bookstr-chunks","2","bookstr-chunk-generation"],
                  ["book","libvault","${"a".repeat(32)}","1700000000"]
                ]""",
            ),
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
    fun chunkManifestRejectsExtremeCountUpperBound() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["libvault-chunks","999999","main"]]"""))
    }

    @Test
    fun chunkManifestDefaultsWhitespacePrefixToCanonicalName() {
        assertEquals(
            FavoriteChunkManifest(5, "libvault-favorites-chunk"),
            NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","5","   "]]"""),
        )
    }

    @Test
    fun chunkManifestRejectsNegativeCount() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","-1","generation"]]"""))
    }

    @Test
    fun chunkManifestRejectsDecimalCount() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","4.0","generation"]]"""))
    }

    @Test
    fun chunkManifestRejectsNonNumericCount() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks","four","generation"]]"""))
    }

    @Test
    fun chunkManifestRejectsMissingCount() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks"]]"""))
    }

    @Test
    fun chunkManifestSkipsInvalidTopLevelEntriesBeforeManifest() {
        assertEquals(
            FavoriteChunkManifest(2, "bookstr-chunk-generation"),
            NostrFavoritesRepository.chunkManifest(
                """[
                  0,
                  {"note":"not-an-array"},
                  ["title","Favorites"],
                  ["bookstr-chunks","2","bookstr-chunk-generation"]
                ]""",
            ),
        )
    }

    @Test
    fun chunkManifestRejectsEmptyArrayPayload() {
        assertNull(NostrFavoritesRepository.chunkManifest("[]"))
    }

    @Test
    fun chunkManifestRejectsNullCount() {
        assertNull(NostrFavoritesRepository.chunkManifest("""[["bookstr-chunks",null,"bookstr-chunk-generation"]]"""))
    }

    @Test(expected = org.json.JSONException::class)
    fun parseSharedFavoriteTagsRejectsInvalidJsonPayload() {
        NostrFavoritesRepository.parseSharedFavoriteTags("not-json")
    }

    @Test(expected = org.json.JSONException::class)
    fun parseSharedFavoriteTagsRejectsWrappedTagsObjectPayload() {
        NostrFavoritesRepository.parseSharedFavoriteTags(
            """{"tags":[["libvault","$md5"],["libvault-book","$md5","A Book","An Author","epub","1234","2024"]]}""",
        )
    }

    @Test
    fun legacyBlossomTagCompletesExistingLibvaultFavorite() {
        val sha = "e".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000000","https://example.org/book.epub"],
              ["blossom","$md5","$sha","https://blossom.bfr.ee/$sha","epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book.epub", refs.single().url)
        assertEquals(sha, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha", refs.single().blossomUrl)
        assertEquals("epub", refs.single().format)
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
        assertEquals(1_700_000_001L, refs.single().addedAt)
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

        assertEquals(2, Regex("\"libvault-added\"").findAll(upgraded).count())
        assertEquals(2, refs.size)
        assertEquals(1_700_000_001L, refs.single { it.libvaultMd5 == md5 }.addedAt)
        assertEquals(1_700_000_003L, refs.single { it.libvaultMd5 == otherMd5 }.addedAt)
    }

    @Test
    fun ensureFavoriteAddedAtTagsSkipsNonLibvaultFavorites() {
        val plaintext = """[
          ["book","bookstr","source:42","1700000001","https://source.example/books/42"],
          ["book","isbn","9781234567890","1700000002"]
        ]"""

        assertEquals(
            plaintext,
            NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_700_000_042L),
        )
    }

    @Test
    fun ensureFavoriteAddedAtTagsSkipsMalformedLegacyIdentifiers() {
        val plaintext = """[
          ["libvault","not-md5"],
          ["libvault-book","not-md5","Legacy title","Legacy author","epub"],
          ["blossom","bad-sha", "${"b".repeat(64)}", "https://blossom.bfr.ee/${"b".repeat(64)}","epub"]
        ]"""

        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_700_000_042L)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded)

        assertEquals(0, Regex("\"libvault-added\"").findAll(upgraded).count())
        assertEquals(0, refs.size)
    }

    @Test
    fun ensureFavoriteAddedAtTagsAddsEntryForLegacyBlossomMembershipWithoutTimestamp() {
        val sha = "c".repeat(64)
        val plainText = """[
          ["blossom", "$md5", "$sha", "https://blossom.bfr.ee/$sha", "epub"]
        ]"""
        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plainText, 1_700_000_042L)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded)

        assertEquals(1, refs.size)
        assertEquals(1_700_000_042L, refs.single().addedAt)
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

    @Test(expected = org.json.JSONException::class)
    fun objectPayloadWithoutTagsIsRejected() {
        NostrFavoritesRepository.parseSharedFavoriteTags("""{}""")
    }

    @Test(expected = org.json.JSONException::class)
    fun objectPayloadWithNonArrayTagsIsRejected() {
        NostrFavoritesRepository.parseSharedFavoriteTags("""{"tags":"not-an-array"}""")
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
    fun matchSharedFavoritesDropsRefsWithoutMatchingKeys() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(), SharedFavoriteRef(libvaultMd5 = md5)),
            emptyList(),
        )

        assertTrue(result.bookIds.isEmpty())
        assertEquals(1, result.external.size)
        assertEquals(md5, result.external.first().key)
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
    fun ensureFavoriteAddedAtTagsLowercasesLegacyUppercaseLibvaultMembership() {
        val uppercaseMd5 = md5.uppercase()
        val plaintext = """[["libvault","$uppercaseMd5"]]"""
        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_700_000_042L)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded)

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(1_700_000_042L, refs.single().addedAt)
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
    fun ensureFavoriteAddedAtTagsAddsFallbackTimestampWhenExistingLibvaultAddedIsInvalid() {
        val plaintext = """[
          ["libvault","$md5"],
          ["libvault-added","$md5","bad"],
          ["libvault-added","$md5","0"]
        ]"""

        val upgraded = NostrFavoritesRepository.ensureFavoriteAddedAtTags(plaintext, 1_700_000_042L)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(upgraded)

        assertEquals(1, Regex("\"libvault-added\"").findAll(upgraded).count())
        assertEquals(1, refs.size)
        assertEquals(1_700_000_042L, refs.single().addedAt)
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
        assertEquals("9780123456789", parsed.single().isbn)
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
    fun currentCompactRefFillsUrlFromIstagLocatorWhenMissing() {
        val locator = "https://example.org/filled-by-istag"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "libvault", "$md5", "1700000000"],
              ["i", "isbn:978-0-123456-78-9", "$locator"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(locator, refs.single().url)
        assertEquals("9780123456789", refs.single().isbn)
    }

    @Test
    fun currentIstagLocatorDoesNotReplaceExistingUrl() {
        val existingUrl = "https://example.org/book.epub"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault", "$md5", "$existingUrl"],
              ["i", "isbn:978-0-123456-78-9", "https://example.org/other-location"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(existingUrl, refs.single().url)
        assertEquals("9780123456789", refs.single().isbn)
    }

    @Test
    fun emptyBookstrIdentifierIsIgnoredInCompactTags() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "bookstr", "", "1700000000", "https://example.org/skip"],
              ["book", "bookstr", "source:42", "1700000001", "https://example.org/keep"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("source:42", refs.single().bookstrId)
        assertEquals("https://example.org/keep", refs.single().url)
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
    fun libvaultBookUnsupportedFormatFallsBackToNullFormat() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-book", "${"a".repeat(32)}", "Legacy title", "Legacy author", "txt", "11", "2024"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Legacy title", refs[0].title)
        assertEquals("Legacy author", refs[0].author)
        assertEquals("${"a".repeat(32)}", refs[0].libvaultMd5)
        assertEquals(null, refs[0].format)
        assertEquals("2024", refs[0].year)
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
    fun bookstrBookMetadataWithEmptyFieldsDoesNotOverwriteExistingValues() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Existing title", "Existing author", "epub", "11", "2024"],
              ["bookstr-book", "$md5", "", "", "", "", ""]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Existing title", refs[0].title)
        assertEquals("Existing author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2024", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithPartialFieldsOverwritesExistingValues() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Existing title", "Existing author", "epub", "11", "2024"],
              ["bookstr-book", "$md5", "Updated title", "", "", "", "2025"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Updated title", refs[0].title)
        assertEquals("Existing author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2025", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithUnsupportedFormatIsOverwrittenByLaterSupportedFormat() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Recovered title", "Author", "txt", "11", "2024"],
              ["bookstr-book", "$md5", "Recovered title", "Author", "epub", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("Recovered title", refs[0].title)
        assertEquals("Author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2026", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithExistingFormatAndUnsupportedUpdate() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Existing title", "Existing author", "epub", "11", "2024"],
              ["bookstr-book", "$md5", "New title", "", "txt", "", "2027"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("New title", refs[0].title)
        assertEquals("Existing author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2027", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithExistingFormatIsNotOverwrittenByUnsupportedFormat() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Recovered title", "Author", "epub", "11", "2024"],
              ["bookstr-book", "$md5", "Recovered title", "Author", "txt", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Recovered title", refs[0].title)
        assertEquals("Author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2026", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithUppercaseIdentifierIsLowercased() {
        val upperMd5 = "A".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$upperMd5", "Recovered title", "Author", "epub", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("a".repeat(32), refs[0].libvaultMd5)
        assertEquals("Recovered title", refs[0].title)
        assertEquals("Author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2026", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithUnsupportedFormatIsIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "$md5", "Recovered title", "Author", "txt", "11", "2024"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Recovered title", refs[0].title)
        assertEquals("Author", refs[0].author)
        assertEquals(null, refs[0].format)
        assertEquals("2024", refs[0].year)
    }

    @Test
    fun bookstrBookMetadataWithInvalidIdentifierIsIgnored() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["bookstr-book", "not-an-md5", "Should be ignored", "No one", "epub", "11", "2024"],
              ["bookstr-book", "$md5", "Recovered title", "Author", "epub", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs[0].libvaultMd5)
        assertEquals("Recovered title", refs[0].title)
        assertEquals("Author", refs[0].author)
        assertEquals("epub", refs[0].format)
        assertEquals("2026", refs[0].year)
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
    fun compactBlossomInvalidIdentifierSkipsOnlyInvalidEntry() {
        val sha = "1".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book", "blossom", "not-a-sha", "1700000000", "https://blossom.invalid/ignore", "epub"],
              ["book", "blossom", "$sha", "1700000001", "https://blossom.bfr.ee/$sha", "epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(sha, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha", refs.single().blossomUrl)
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
    fun matchesFavoriteBySourceUrlWhenEpubUrlDiffers() {
        val sourceUrl = "https://cdn.example.org/source/book.epub"
        val book = CatalogBook(
            id = "local-id",
            title = "Book",
            author = "Author",
            epubUrl = "https://cdn.example.org/content/download.epub",
            coverUrl = null,
            sourceUrl = sourceUrl,
        )

        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = sourceUrl)),
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
    fun legacyBlossomInvalidIdentifierSkipsOnlyInvalidEntry() {
        val sha = "1".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom", "not-an-md5", "$sha", "https://blossom.invalid/ignore", "epub"],
              ["blossom", "$md5", "$sha", "https://blossom.bfr.ee/$sha", "epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(sha, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha", refs.single().blossomUrl)
    }

    @Test
    fun legacyBlossomUnsupportedFormatIsStoredInAndroidShape() {
        val sha = "2".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom", "$md5", "$sha", "https://blossom.bfr.ee/$sha", "txt"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("txt", refs.single().format)
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
        assertEquals("source:7", result.external.single().title)
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
        assertEquals(source, result.external.single().title)
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
        assertEquals("MD5 ${md5.take(10)}…", result.external.single().title)
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
        assertEquals("ISBN 9780123456789", result.external.single().title)
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
        assertEquals("Blossom ${sha.take(10)}…", result.external.single().title)
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
                    format = BookFormat.Epub,
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
    fun libvaultAddedCanAppearBeforeMembershipAndStillCollapse() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-added", "$md5", "1700000003"],
              ["book", "libvault", "$md5", "1700000005", "https://example.org/book"],
              ["libvault-book", "$md5", "Recovered", "Author", "epub", "11", "2026"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(1_700_000_003L, refs.single().addedAt)
        assertEquals("Recovered", refs.single().title)
        assertEquals("https://example.org/book", refs.single().url)
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
        assertEquals(1_700_000_002L, refs[0].addedAt)
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

    @Test
    fun parseSharedFavoriteTagsSkipsEmptyCompactIdentifiers() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","isbn","","1700000000"],
              ["book","url","","1700000001"],
              ["book","libvault","$md5","1700000002","https://example.org/libvault"],
              ["book","blossom","not-a-sha","1700000003","https://example.org/invalid"],
              ["book","isbn","978-0-123456-78-9","1700000004","https://example.org/isbn"]
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals(md5, refs.single { it.libvaultMd5 == md5 }.libvaultMd5)
        assertEquals("9780123456789", refs.single { it.isbn == "9780123456789" }.isbn)
    }

    @Test
    fun parseSharedFavoriteTagsSkipsUnsupportedCompactNamespaces() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","unsupported","something","1700000000","https://example.org/unsupported"],
              ["book","isbn","978-0-123456-78-9","1700000001","https://example.org/isbn"],
              ["book","libvault","$md5","1700000002","https://example.org/libvault"]
            ]""",
        )

        assertEquals(2, refs.size)
        assertEquals("9780123456789", refs.first { it.isbn == "9780123456789" }.isbn)
        assertEquals(md5, refs.first { it.libvaultMd5 == md5 }.libvaultMd5)
    }

    @Test
    fun parseSharedFavoriteTagsPreservesFirstLibvaultUrlWhenDuplicatedCompactTagsMerge() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val originalUrl = "https://example.org/read/original"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000003","$originalUrl"],
              ["book","libvault","$md5","1700000002","https://example.org/read/ignored"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(originalUrl, refs.single().url)
        assertEquals(1_700_000_002L, refs.single().addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsDeduplicatesIsbnByCanonicalValueAndUsesEarliestAddedAt() {
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","isbn","978-0-123456-78-9","1700000003","https://example.org/first"],
              ["book","isbn","9780123456789","1700000002","https://example.org/second"],
              ["book","isbn","978-0-1234-5678-9","1700000001","https://example.org/third"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals("9780123456789", refs.single().isbn)
        assertEquals("https://example.org/first", refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
    }

    @Test
    fun parseSharedFavoriteTagsUpgradesLegacyBlossomMetadataForExistingFavorite() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val sha1 = "a".repeat(64)
        val sha2 = "b".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","libvault","$md5","1700000005","https://example.org/book.epub"],
              ["blossom","$md5","$sha1","https://blossom.bfr.ee/$sha1","txt"],
              ["blossom","$md5","$sha2","https://blossom.bfr.ee/$sha2","epub"],
              ["blossom","$md5","$sha2","https://blossom.bfr.ee/$sha2","pdf"],
              ["libvault-added","$md5","1700000003"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(sha2, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha2", refs.single().blossomUrl)
        assertEquals("pdf", refs.single().format)
        assertEquals(1_700_000_003L, refs.single().addedAt)
    }

    @Test
    fun libvaultAddedTagWithInvalidIdIsIgnoredAndDoesNotBlockLaterValidEntry() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["libvault-added","not-an-md5","1700000001"],
              ["libvault-added","$md5","1700000003"],
              ["book", "libvault", "$md5", "1700000005", "https://example.org/book.epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book.epub", refs.single().url)
        assertEquals(1_700_000_003L, refs.single().addedAt)
    }

    @Test
    fun legacyBlossomUnsupportedFormatDoesNotOverwriteExistingFormatOrUrl() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val sha1 = "c".repeat(64)
        val sha2 = "d".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom","$md5","$sha1","https://blossom.bfr.ee/$sha1","epub"],
              ["blossom","$md5","$sha2","https://blossom.bfr.ee/$sha2","txt"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(sha2, refs.single().blossomSha256)
        assertEquals("https://blossom.bfr.ee/$sha2", refs.single().blossomUrl)
        assertEquals("epub", refs.single().format)
    }

    @Test
    fun legacyBlossomUnsupportedFormatThenSupportedFormatKeepsUnsupported() {
        val md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        val sha1 = "e".repeat(64)
        val sha2 = "f".repeat(64)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["blossom","$md5","$sha1","https://blossom.example/$sha1","txt"],
              ["blossom","$md5","$sha2","https://blossom.example/$sha2","epub"]
            ]""",
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals(sha2, refs.single().blossomSha256)
        assertEquals("https://blossom.example/$sha2", refs.single().blossomUrl)
        assertEquals("txt", refs.single().format)
    }

    @Test
    fun duplicateUrlRefsMatchCatalogBySourceUrl() {
        val sourceUrl = "https://catalogue.example.com/books/123"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(url = sourceUrl, title = "Offline", addedAt = 1),
                SharedFavoriteRef(url = sourceUrl, title = "Latest", addedAt = 2),
            ),
            listOf(
                CatalogBook(
                    id = "book-source",
                    title = "Catalog title",
                    author = "Catalog author",
                    epubUrl = "https://example.org/read.epub",
                    coverUrl = null,
                    sourceUrl = sourceUrl,
                    isbn = null,
                    libvaultMd5 = null,
                    format = BookFormat.Epub,
                    blossomSha256 = null,
                    year = null,
                ),
            ),
        )

        assertEquals(setOf("book-source"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }
    @Test
    fun duplicateUrlWithLibvaultMetadataDeduplicatesToSingleCatalogMatch() {
        val sourceUrl = "https://catalogue.example.com/books/123"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["r", "$sourceUrl"],
              ["libvault", "$md5"],
              ["book", "url", "$sourceUrl", "1700000000"],
              ["book", "url", "$sourceUrl", "1700000100"]
            ]""".trimIndent(),
        )

        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://catalogue.example.com/books/123", refs.single().url)
        assertEquals(1_700_000_000L, refs.single().addedAt)

        val result = NostrFavoritesRepository.matchSharedFavorites(
            refs,
            listOf(
                CatalogBook(
                    id = "catalog-id",
                    title = "Catalog Book",
                    author = "Author",
                    epubUrl = "https://cdn.example.com/catalog.epub",
                    coverUrl = null,
                    isbn = null,
                    sourceUrl = sourceUrl,
                    libvaultMd5 = md5,
                    format = BookFormat.Epub,
                    blossomSha256 = null,
                    year = null,
                ),
            ),
        )

        assertEquals(setOf("catalog-id"), result.bookIds)
        assertEquals(0, result.external.size)
    }

    @Test
    fun unmatchedRefsWithoutIdentifyingKeysAreIgnored() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(title = "Offline favorite", year = "2024")),
            emptyList(),
        )

        assertEquals(0, result.bookIds.size)
        assertEquals(0, result.external.size)
    }

    @Test
    fun duplicateUrlRefsWithoutCatalogKeepEarliestTimestampForExternalFallback() {
        val url = "https://example.org/unknown.epub"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(url = url, title = "Later", addedAt = 1_700_000_010L),
                SharedFavoriteRef(url = url, title = "Earliest", addedAt = 1_700_000_000L),
            ),
            emptyList(),
        )

        assertEquals(1, result.external.size)
        assertEquals(url, result.external.single().key)
        assertEquals("Earliest", result.external.single().title)
        assertEquals(1_700_000_000L, result.external.single().addedAt)
    }

    @Test
    fun duplicateCompactUrlRefsKeepEarliestTimestampDuringParse() {
        val url = "https://example.org/duplicate.url"
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags(
            """[
              ["book","url","$url","1700000010"],
              ["book","url","$url","1700000001"],
              ["book","url","$url","1700000015"]
            ]""".trimIndent(),
        )

        assertEquals(1, refs.size)
        assertEquals(url, refs.single().url)
        assertEquals(1_700_000_001L, refs.single().addedAt)
    }

    @Test
    fun fallbackMatchingNormalizesUrlAndIgnoresQueryAndFragment() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(url = "HTTPS://Catalog.Example/books/one?source=nostr#chapter")),
            listOf(
                CatalogBook(
                    id = "catalog-book",
                    title = "Catalog book",
                    author = "Author",
                    epubUrl = "https://catalog.example/books/one?download=1",
                    coverUrl = null,
                ),
            ),
        )

        assertEquals(setOf("catalog-book"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun stableFavoriteDoesNotMatchDifferentBookThroughFallbackIdentity() {
        val sharedUrl = "https://catalog.example/books/one"
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    bookstrId = "source:expected",
                    isbn = "9780123456789",
                    url = sharedUrl,
                ),
            ),
            listOf(
                CatalogBook(
                    id = "source:different",
                    title = "Different edition",
                    author = "Author",
                    epubUrl = sharedUrl,
                    coverUrl = null,
                    isbn = "9780123456789",
                ),
            ),
        )

        assertTrue(result.bookIds.isEmpty())
        assertEquals("source:expected", result.external.single().key)
    }

    @Test
    fun blankStableIdentifiersStillAllowLegacyFallbackMatching() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(
                    bookstrId = " ",
                    libvaultMd5 = "",
                    isbn = "9780123456789",
                    blossomSha256 = "\n",
                ),
            ),
            listOf(
                CatalogBook(
                    id = "legacy-isbn",
                    title = "Legacy book",
                    author = "Author",
                    epubUrl = "",
                    coverUrl = null,
                    isbn = "9780123456789",
                ),
            ),
        )

        assertEquals(setOf("legacy-isbn"), result.bookIds)
        assertTrue(result.external.isEmpty())
    }

    @Test
    fun malformedAndRelativeFallbackUrlsDoNotMatchCatalogBooks() {
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(
                SharedFavoriteRef(url = "https://[broken"),
                SharedFavoriteRef(url = "relative/path"),
            ),
            listOf(
                CatalogBook(
                    id = "catalog-book",
                    title = "Catalog book",
                    author = "Author",
                    epubUrl = "https://catalog.example/books/one",
                    coverUrl = null,
                ),
            ),
        )

        assertTrue(result.bookIds.isEmpty())
        assertEquals(setOf("https://[broken", "relative/path"), result.external.map { it.key }.toSet())
    }

    @Test
    fun unmatchedStableFavoritePrefersBlossomKeyBeforeIsbn() {
        val sha = "b".repeat(64)
        val result = NostrFavoritesRepository.matchSharedFavorites(
            listOf(SharedFavoriteRef(blossomSha256 = sha, isbn = "9780123456789")),
            emptyList(),
        )

        assertEquals(sha, result.external.single().key)
        assertEquals("Blossom ${sha.take(10)}…", result.external.single().title)
        assertFalse(result.external.single().key.startsWith("978"))
    }
}
