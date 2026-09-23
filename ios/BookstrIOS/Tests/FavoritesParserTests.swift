import XCTest
import PDFKit
#if canImport(UIKit)
import UIKit
import SwiftUI
import WebKit
#endif
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class FavoritesParserTests: XCTestCase {
    func testRetiredBlossomTagsAreIgnoredAndLegacyJSONStillDecodes() throws {
        let hash = String(repeating: "a", count: 64)
        let tags: [Any] = [
            ["book", "blossom", hash, "1700000000", "https://blossom.invalid/\(hash)"],
            ["blossom", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", hash, "https://blossom.invalid/\(hash)", "epub"],
        ]
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags(tags).isEmpty)

        let json = """
        {"id":"local","title":"Local","author":"Author","epubUrl":"","coverUrl":null,
         "sourceUrl":null,"isbn":null,"libvaultMd5":null,"format":"epub",
         "blossomSha256":"\(hash)","year":null}
        """
        let book = try JSONDecoder().decode(CatalogBook.self, from: Data(json.utf8))
        XCTAssertEqual(book.id, "local")
        XCTAssertEqual(book.title, "Local")
    }

    func testIOSRuntimeContainsNoBlossomSupportSymbols() throws {
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")
        let files = try FileManager.default.subpathsOfDirectory(atPath: sources.path)
            .filter { $0.hasSuffix(".swift") }
        for file in files {
            let text = try String(contentsOf: sources.appendingPathComponent(file), encoding: .utf8)
            XCTAssertFalse(text.localizedCaseInsensitiveContains("blossom"), file)
        }
    }

    func testSharedCollectionSemanticsV1Fixtures() throws {
        let fixture = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: collectionSemanticsFixtureURL())) as? [String: Any]
        )
        XCTAssertEqual(fixture["version"] as? Int, 1)
        for entry in try XCTUnwrap(fixture["indexCases"] as? [[String: Any]]) {
            let name = try XCTUnwrap(entry["name"] as? String)
            let expected = try XCTUnwrap(entry["expected"] as? [String: Any])
            let actual = FavoritesParser.parseCollectionIndex(try XCTUnwrap(entry["plaintext"] as? String))
            let entries = actual.entries.map {
                ["id": $0.id, "title": $0.title, "updatedAt": $0.updatedAt] as [String: Any]
            }
            let tombstones = actual.tombstones.map {
                ["id": $0.id, "deletedAt": $0.deletedAt] as [String: Any]
            }
            XCTAssertTrue(
                NSArray(array: entries).isEqual(to: try XCTUnwrap(expected["entries"] as? [[String: Any]])),
                name
            )
            XCTAssertTrue(
                NSArray(array: tombstones).isEqual(to: try XCTUnwrap(expected["tombstones"] as? [[String: Any]])),
                name
            )
        }

        for entry in try XCTUnwrap(fixture["collectionCases"] as? [[String: Any]]) {
            let name = try XCTUnwrap(entry["name"] as? String)
            let collection = FavoritesParser.parseCollection(
                try XCTUnwrap(entry["plaintext"] as? String),
                id: try XCTUnwrap(entry["id"] as? String),
                fallbackTitle: try XCTUnwrap(entry["fallbackTitle"] as? String),
                fallbackUpdatedAt: try XCTUnwrap(entry["fallbackUpdatedAt"] as? Int64
                    ?? (entry["fallbackUpdatedAt"] as? NSNumber)?.int64Value)
            )
            guard let expected = entry["expected"] as? [String: Any] else {
                XCTAssertNil(collection, name)
                continue
            }
            let value = try XCTUnwrap(collection, name)
            let items = value.items.map(canonicalFavoriteReference)
            let actual: [String: Any] = [
                "id": value.id,
                "title": value.title,
                "description": value.description,
                "updatedAt": value.updatedAt,
                "items": items,
            ]
            XCTAssertTrue(NSDictionary(dictionary: actual).isEqual(to: expected), name)
        }
    }

    private func collectionSemanticsFixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/collection-semantics-v1.json")
    }

    private func canonicalFavoriteReference(_ ref: SharedFavoriteRef) -> [String: Any] {
        let type: String
        let identifier: String
        let locator: String
        if let value = ref.libvaultMd5 {
            (type, identifier, locator) = ("libvault", value, ref.url ?? "")
        } else if let value = ref.bookstrId {
            (type, identifier, locator) = ("bookstr", value, ref.url ?? "")
        } else if let value = ref.isbn {
            (type, identifier, locator) = ("isbn", value, ref.url ?? "")
        } else {
            (type, identifier, locator) = ("url", ref.url ?? "", ref.url ?? "")
        }
        return ["type": type, "identifier": identifier, "locator": locator, "addedAt": ref.addedAt ?? 0]
    }

    func testRightsNormalizationMarkersAndSafeURLs() {
        XCTAssertEqual(BookRights.normalize(license: "Public Domain Mark 1.0").status, .publicDomain)
        XCTAssertEqual(BookRights.normalize(license: "CC0 1.0").compactLabel, "CC0")
        XCTAssertEqual(BookRights.normalize(license: "CC BY-SA 4.0").compactLabel, "CC BY-SA 4.0")
        XCTAssertEqual(BookRights.normalize(license: "GNU Free Documentation License").compactLabel, "OPEN")
        XCTAssertEqual(BookRights.normalize(license: "All rights reserved").status, .copyrighted)
        XCTAssertEqual(BookRights.normalize(source: "gutenberg").status, .unknown)
        XCTAssertEqual(BookRights().accessibleLabel, "No open license identified")
        XCTAssertNil(BookRights.normalize(licenseURL: "javascript:alert(1)").licenseURL)
    }

    func testGutendexSemanticsAndPartialRefreshPreservation() {
        let publicDomain = BookRights.normalize(source: "gutendex", copyright: false)
        XCTAssertEqual(publicDomain.license, "Public domain in the U.S.")
        XCTAssertEqual(BookRights.normalize(copyright: true).status, .copyrighted)
        XCTAssertEqual(BookRights.normalize(copyright: nil).status, .unknown)
        let current = BookRights.normalize(license: "CC BY 4.0", source: "catalog")
        XCTAssertEqual(BookRights.preferred(current: current, incoming: BookRights()), current)
    }

    func testPublicationV2RoundTripsRightsAndLegacyRemainsUnknown() {
        let ref = SharedFavoriteRef(
            bookstrId: "gutenberg:7", title: "Open", author: "Author", year: "2024", format: "epub",
            rightsStatus: RightsStatus.openLicense.rawValue, license: "CC BY 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by/4.0/", rightsSource: "gutendex"
        )
        let tags = FavoritesParser.collectionTags(refs: [ref], updatedAt: 1)
        XCTAssertEqual(tags[1], ["bookstr-publications", "2"])
        let parsed = FavoritesParser.parseSharedFavoriteTags(tags as [Any])
        XCTAssertEqual(parsed.first?.license, "CC BY 4.0")
        XCTAssertEqual(parsed.first?.rights.status, .openLicense)

        let legacy = FavoritesParser.parseSharedFavoriteTags([["book", "bookstr", "legacy", "1"]] as [Any])
        XCTAssertEqual(legacy.first?.rights.status, .unknown)
    }


    func testCompactItemTagsFallsBackToCollectionTimestampForInvalidAddedAt() {
        let tags = FavoritesParser.compactItemTags(
            refs: [SharedFavoriteRef(isbn: "978-0-123456-78-9", addedAt: 0)],
            fallbackAddedAt: 1_700_000_000
        )
        XCTAssertEqual(tags, [["book", "isbn", "9780123456789", "1700000000"]])
    }

    func testSplitItemTagsReturnsSingleEmptyChunkForNoItems() {
        XCTAssertEqual(FavoritesParser.splitItemTags([], limit: 10), [[]])
    }

    func testSplitItemTagsKeepsSingleOversizedItemTagAsSingleChunk() {
        let tag = [["book", "url", "https://example.com/\(String(repeating: "x", count: 500))", "1700000000"]]

        XCTAssertEqual(FavoritesParser.splitItemTags(tag, limit: 10), [tag])
    }

    func testSplitItemTagsHonorsBoundaryWhenSerializedLengthEqualsLimit() {
        let tag = [["book", "isbn", "9780123456789", "1700000000"]]
        let limit = FavoritesParser.serializeTags(tag).count

        XCTAssertEqual(FavoritesParser.splitItemTags(tag, limit: limit), [tag])
    }



    func testMatchesPortableISBNsAndKeepsUnmatchedEditions() {
        let tags: [Any] = [
            ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            ["i", "isbn:9780123456789"],
            ["r", "https://lib.b.bfr.ee/#book?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
            ["libvault", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
        ]
        let refs = FavoritesParser.parseSharedFavoriteTags(tags)
        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: [
                CatalogBook(
                    id: "book-1",
                    title: "One",
                    author: "Author",
                    epubUrl: "one.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "978-0-123456-78-9",
                    libvaultMd5: nil,
                    format: .epub,
                    year: nil
                )
            ]
        )
        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].libvaultMd5, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    }















    func testParsesWrappedTagsObject() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let json = "{\"tags\":[[\"libvault\",\"\(md5)\"],[\"libvault-book\",\"\(md5)\",\"Wrapped\",\"Author\",\"epub\"]]}"
        let refs = FavoritesParser.parseSharedFavoriteTags(json)
        XCTAssertEqual(refs.first?.title, "Wrapped")
    }

    func testRelayEventWithNumericTagsDecodes() {
        let event = NostrEvent.fromRelayObject([
            "id": "abc",
            "pubkey": "def",
            "created_at": 1_700_000_000,
            "kind": 30003,
            "tags": [["d", "libvault-favorites"], ["published_at", 123]],
            "content": "ciphertext",
            "sig": "sig"
        ])
        XCTAssertEqual(event?.kind, 30003)
        XCTAssertEqual(event?.dTag, "libvault-favorites")
        XCTAssertEqual(event?.tags.last, ["published_at", "123"])
    }

    func testReadsChunkManifest() {
        let manifest = FavoritesParser.chunkManifest(from: #"[["libvault-chunks","3","libvault-favorites-chunk"]]"#)
        XCTAssertEqual(manifest?.count, 3)
        XCTAssertEqual(manifest?.prefix, "libvault-favorites-chunk")
        XCTAssertEqual(NostrKinds.favoritesChunkDTag(index: 1), "libvault-favorites-chunk-1")
        XCTAssertNil(FavoritesParser.chunkManifest(from: #"[["libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]"#))
    }

    func testChunkManifestDefaultsMissingPrefix() {
        let manifest = FavoritesParser.chunkManifest(from: #"[["bookstr-chunks","4"]]"#)
        XCTAssertEqual(manifest?.count, 4)
        XCTAssertEqual(manifest?.prefix, "libvault-favorites-chunk")
    }

    func testReadsChunkManifestSkipsUnrecognizedLeadingTag() {
        let manifest = FavoritesParser.chunkManifest(
            from: #"[["title","Library favorites"],["bookstr-chunks","7","bookstr-chunk-generation"],["book","libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","1700000000"]]"#
        )
        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 7, prefix: "bookstr-chunk-generation"))
    }

    func testChunkManifestFromValueRejectsNegativeCount() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks", "-1", "bookstr-chunk-generation"]] as [Any]
        )

        XCTAssertNil(manifest)
    }

    func testChunkManifestFromValueRejectsDecimalCount() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks", "4.0", "bookstr-chunk-generation"]] as [Any]
        )

        XCTAssertNil(manifest)
    }

    func testChunkManifestFromValueDefaultsWhitespacePrefixToCanonicalName() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks", "4", "   "]] as [Any]
        )

        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 4, prefix: "libvault-favorites-chunk"))
    }

    func testChunkManifestFromValueRejectsOutOfRangeCount() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks", "10001", "bookstr-chunk-generation"]] as [Any]
        )

        XCTAssertNil(manifest)
    }

    func testChunkManifestFromValueRejectsMissingCount() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks"]] as [Any]
        )

        XCTAssertNil(manifest)
    }

    func testChunkManifestFromValueRejectsNullCount() {
        let manifest = FavoritesParser.chunkManifest(
            from: [["bookstr-chunks", NSNull(), "bookstr-chunk-generation"]] as [Any]
        )

        XCTAssertNil(manifest)
    }

    func testParsesCompactFavoriteReference() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-collection", "2"],
            ["title", "Favorites"],
            ["book", "libvault", md5, "1700000000"]
        ])
        XCTAssertEqual(refs, [SharedFavoriteRef(libvaultMd5: md5, addedAt: 1_700_000_000)])
    }





    func testCompactIsbnSkipsInvalidValueAndKeepsValidOne() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "isbn", "abc", "1"],
            ["book", "isbn", "978-0-123456-78-9", "2"],
            ["book", "isbn", "0000", "3"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].addedAt, 2)
    }

    func testParseSharedFavoriteTagsSkipsLegacyBookstrTagWithNoIdentifier() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr", "", "Legacy title", "Legacy author", "https://example.org/book"]
        ])

        XCTAssertEqual(refs.count, 0)
    }

    func testPendingUrlIsPreservedAcrossInvalidLegacyBookstrIdentifier() {
        let url = "https://example.org/books/track?source=openlibrary:OL9M"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["bookstr", "", "", "", ""],
            ["bookstr", "openlibrary:OL9M", "", "", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "openlibrary:OL9M")
        XCTAssertEqual(refs[0].url, url)
    }

    func testStandaloneIstagUsesPendingUrlAfterInvalidLeadingIstag() {
        let url = "https://lib.b.bfr.ee/books/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["i", "isbn:not-an-isbn"],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
    }

    func testInvalidCompactUrlIsSkipped() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "not-a-url", "1700000000"],
            ["book", "url", "https://books-api.guaka.org/api/books/12345/download", "1700000001"],
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://books-api.guaka.org/api/books/12345/download")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testMixedCompactTagsSkipsInvalidIdentifierType() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", 123, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000"],
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000001", "https://example.org/book.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].url, "https://example.org/book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testLegacyBookstrBookMetadataTagIsRecognized() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000000"],
            ["bookstr-book", md5, "Legacy title", "Legacy author", "epub"]
        ])
        XCTAssertEqual(refs.first?.title, "Legacy title")
        XCTAssertEqual(refs.first?.author, "Legacy author")
    }

    func testMixedCompactAndLegacyBookstrMembershipIsDeduplicated() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "bookstr", "source:42", "20", "https://example.org/read"],
            ["bookstr", "source:42", "Legacy title", "Legacy author", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:42")
        XCTAssertEqual(refs[0].title, "Legacy title")
        XCTAssertEqual(refs[0].author, "Legacy author")
        XCTAssertEqual(refs[0].url, "https://example.org/read")
    }

    func testCompactTagWithInvalidAddedAtDoesNotBlockLaterTimestamp() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "not-a-timestamp", "https://example.org/first"],
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000001", "https://example.org/book"],
            ["libvault-added", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000002"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].url, "https://example.org/book")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }





    func testLegacyBookstrMetadataEmptyFieldsDoNotOverwriteExisting() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Existing title", "Existing author", "epub", "11", "2024"],
            ["bookstr-book", md5, "", "", "", "", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Existing title")
        XCTAssertEqual(refs[0].author, "Existing author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2024")
    }

    func testLegacyBookstrMetadataWithUppercaseIdentifierIsLowercased() {
        let md5 = String(repeating: "A", count: 32)
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Recovered title", "Author", "epub", "11", "2026"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, String(repeating: "a", count: 32))
        XCTAssertEqual(refs[0].title, "Recovered title")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].format, "epub")
    }

    func testLegacyBookstrMetadataPartialFieldsOverwriteExisting() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Existing title", "Existing author", "epub", "11", "2024"],
            ["bookstr-book", md5, "Updated title", "", "", "", "2025"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Updated title")
        XCTAssertEqual(refs[0].author, "Existing author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2025")
    }

    func testLegacyBookstrMetadataUnsupportedFormatThenSupported() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Recovered title", "Author", "txt", "11", "2024"],
            ["bookstr-book", md5, "Recovered title", "Author", "epub", "11", "2026"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Recovered title")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2026")
    }

    func testLegacyBookstrMetadataExistingFormatAndUnsupportedUpdate() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Existing title", "Existing author", "epub", "11", "2024"],
            ["bookstr-book", md5, "New title", "", "txt", "", "2027"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "New title")
        XCTAssertEqual(refs[0].author, "Existing author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2027")
    }

    func testLegacyBookstrMetadataExistingFormatNotOverwrittenByUnsupportedFormat() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Recovered title", "Author", "epub", "11", "2024"],
            ["bookstr-book", md5, "Recovered title", "Author", "txt", "11", "2026"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Recovered title")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2026")
    }

    func testLegacyBookstrMetadataWithUnsupportedFormatIsIgnored() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", md5, "Recovered title", "Author", "txt", "11", "2024"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Recovered title")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].year, "2024")
        XCTAssertNil(refs[0].format)
    }

    func testLegacyBookstrMetadataInvalidIdentifierIsIgnored() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["bookstr-book", "not-an-md5", "Should be ignored", "No one", "epub", "11", "2024"],
            ["bookstr-book", md5, "Recovered title", "Author", "epub", "11", "2026"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Recovered title")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2026")
    }



    func testLibvaultAddedWithUppercaseIdentifierMatchesExistingFavorite() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["libvault", md5],
            ["libvault-added", md5.uppercased(), "1700000000"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_000)
    }

    func testUnsupportedCompactFormatIsIgnored() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000000"],
            ["bookstr-book", md5, "Unsupported format", "Author Name", "txt", "11", "2024"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].format, nil)
        XCTAssertEqual(refs[0].title, "Unsupported format")
        XCTAssertEqual(refs[0].year, "2024")
    }



    func testParseSharedFavoriteTagsRejectsNonJsonInput() {
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("null").isEmpty)
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("not-json").isEmpty)
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags("{}").isEmpty)
    }

    func testParseSharedFavoriteTagsIgnoresNonArrayTagsValueInObjectPayload() {
        XCTAssertTrue(
            FavoritesParser.parseSharedFavoriteTags("""
            {"tags":"not-an-array"}
            """).isEmpty
        )
    }

    func testParseSharedFavoriteTagsSkipsInvalidIsbnValues() {
        let tags: [Any] = [
            ["i", "isbn:123"],
            ["i", "isbn:0000"],
            ["title", "Ignored"]
        ]
        XCTAssertTrue(FavoritesParser.parseSharedFavoriteTags(tags).isEmpty)
    }

    func testPendingUrlAppliesToCompactBookstrMembership() {
        let url = "https://example.org/book?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["book", "bookstr", "openlibrary:OL1M", "1710000000"],
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "openlibrary:OL1M")
        XCTAssertEqual(refs[0].addedAt, 1_710_000_000)
        XCTAssertEqual(refs[0].url, url)
    }

    func testPendingUrlAppliesToLegacyBookstrMembership() {
        let url = "https://example.org/books/track?source=openlibrary:OL1M"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["bookstr", "openlibrary:OL1M", "Legacy title", "Legacy author", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "openlibrary:OL1M")
        XCTAssertEqual(refs[0].title, "Legacy title")
        XCTAssertEqual(refs[0].author, "Legacy author")
        XCTAssertEqual(refs[0].url, url)
    }

    func testPendingUrlAppliesToCompactIsbnTagWithoutLocator() {
        let url = "https://lib.b.bfr.ee/books/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["i", "isbn:978-0-123456-78-9"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
    }

    func testCurrentFavoriteKeepsUrlWhenIstagMatchesExistingRef() {
        let url = "https://example.org/book.epub"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000", url],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
        XCTAssertNil(refs[0].bookstrId)
    }

    func testCurrentFavoriteKeepsProvidedIstagLocatorWhenUrlAlreadyPresent() {
        let existingUrl = "https://example.org/book.epub"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000", existingUrl],
            ["i", "isbn:978-0-123456-78-9", "https://example.org/other-location"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].url, existingUrl)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
    }



    func testMatchSharedFavoritesMatchesBySourceUrl() {
        let sourceUrl = "https://example.com/book.epub"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(url: sourceUrl)],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched",
                author: "Author",
                epubUrl: "https://another.example.com/book.epub",
                coverUrl: nil,
                sourceUrl: sourceUrl,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )
        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testMatchSharedFavoritesMatchesByEpubUrlWhenSourceUrlIsMissing() {
        let epubUrl = "https://example.com/book.epub"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(url: epubUrl)],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched by EPUB URL",
                author: "Author",
                epubUrl: epubUrl,
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testDuplicateMatchedRefsDoNotCreateExternalFallback() {
        let isbn = "9781234567890"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(isbn: "978-1-2345-6789-0", title: "First"),
                SharedFavoriteRef(isbn: isbn, title: "Latest"),
            ],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched",
                author: "Author",
                epubUrl: "https://example.com/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: isbn,
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testMatchSharedFavoritesReturnsStableExternalFavoriteForUnmatchedSourceUrl() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(
                bookstrId: "source:7",
                title: "Unmatched external favorite",
                author: "Legacy author",
                addedAt: 13,
            )],
            books: []
        )

        XCTAssertEqual(result.bookIds, [])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, "source:7")
        XCTAssertEqual(result.external[0].title, "Unmatched external favorite")
        XCTAssertEqual(result.external[0].author, "Legacy author")
        XCTAssertEqual(result.external[0].addedAt, 13)
    }

    func testMatchSharedFavoritesPreservesMetadataForUnmatchedLibvaultFavorite() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(
                libvaultMd5: md5,
                title: "Offline favorite",
                author: "Legacy author",
                addedAt: 11,
            )],
            books: []
        )

        XCTAssertEqual(result.bookIds, [])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, md5)
        XCTAssertEqual(result.external[0].title, "Offline favorite")
        XCTAssertEqual(result.external[0].author, "Legacy author")
        XCTAssertEqual(result.external[0].addedAt, 11)
    }







    func testMixedTypeCompactTagsSkipInvalidEntriesAndParseValidOne() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", 123, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000"],
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000001", "https://example.org/book.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].url, "https://example.org/book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testMatchSharedFavoritesMatchesByLibvaultMd5CaseInsensitive() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(libvaultMd5: md5)],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched",
                author: "Author",
                epubUrl: "https://example.com/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: md5.uppercased(),
                format: .epub,
                year: nil
            )]
        )
        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testInvalidLibvaultAddedValuesAreIgnored() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["libvault", md5],
            ["libvault-added", md5, "bad"],
            ["libvault-added", md5, "-1"],
            ["libvault-added", md5, "1700000005"],
            ["libvault-added", md5, "1700000000"],
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_000)
    }

    func testCollectionIndexFiltersDeletedCollections() {
        let snapshot = FavoritesParser.parseCollectionIndex(#"""
            [["collection","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Keep","10"],
             ["deleted","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","20"],
             ["collection","bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Show","30"]]
            """#)

        XCTAssertEqual(snapshot.entries.count, 1)
        XCTAssertEqual(snapshot.entries[0].0, "bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        XCTAssertEqual(snapshot.entries[0].1, "Show")
    }

    func testParseCollectionUsesTagsForTitleDescriptionAndUpdatedAt() {
        let json = #"""
            [["bookstr-collection","2"],
             ["title","Reading list"],
             ["description","Weekend picks"],
             ["updated","1700001111"],
             ["book","libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","1700000001","https://example.org/book"]]
            """#
        let collection = FavoritesParser.parseCollection(
            json,
            id: "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            fallbackTitle: "Fallback title",
            fallbackUpdatedAt: 1_000_000
        )

        XCTAssertEqual(collection?.title, "Reading list")
        XCTAssertEqual(collection?.description, "Weekend picks")
        XCTAssertEqual(collection?.updatedAt, 1_700_001_111)
        XCTAssertEqual(collection?.items.count, 1)
        XCTAssertEqual(collection?.items[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testParseCollectionReturnsNilForInvalidCollectionId() {
        let collection = FavoritesParser.parseCollection(
            "[]",
            id: "not-a-collection-id",
            fallbackTitle: "Fallback",
            fallbackUpdatedAt: 123,
        )

        XCTAssertNil(collection)
    }

    func testParseCollectionFallsBackToProvidedTitleAndUpdatedAt() {
        let json = #"""
            [["bookstr-collection","2"],
             ["book","libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","1700000001","https://example.org/book"]]
            """#
        let collection = FavoritesParser.parseCollection(
            json,
            id: "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            fallbackTitle: "Fallback list",
            fallbackUpdatedAt: 1_680_000_000
        )

        XCTAssertEqual(collection?.title, "Fallback list")
        XCTAssertEqual(collection?.description, "")
        XCTAssertEqual(collection?.updatedAt, 1_680_000_000)
        XCTAssertEqual(collection?.items.count, 1)
    }

    func testCollectionTagsSerializeAndParseRoundTrip() {
        let collection = BookCollection(
            id: "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "Round trip",
            description: "Generated by test",
            updatedAt: 1_700_000_123,
            items: [SharedFavoriteRef(libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", title: "Title", author: "Author", format: "epub")]
        )
        let tags = FavoritesParser.collectionTags(collection)
        let parsed = FavoritesParser.parseCollection(
            FavoritesParser.serializeTags(tags),
            id: collection.id,
            fallbackTitle: "Fallback",
            fallbackUpdatedAt: 0,
        )

        XCTAssertEqual(parsed?.title, "Round trip")
        XCTAssertEqual(parsed?.description, "Generated by test")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_123)
        XCTAssertEqual(parsed?.items.count, 1)
        XCTAssertEqual(parsed?.items[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testMatchSharedFavoritesFallbackTitleUsesIsbnAlias() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(isbn: "978-0-1234-5678-9")],
            books: []
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].title, "ISBN 9780123456789")
        XCTAssertEqual(result.external[0].key, "9780123456789")
    }

    func testMatchSharedFavoritesFallbackTitleUsesLibvaultMd5Prefix() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(libvaultMd5: md5)],
            books: []
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertTrue(result.external[0].title.hasPrefix("MD5 \(md5.prefix(10))"))
        XCTAssertEqual(result.external[0].key, md5)
        XCTAssertEqual(result.external[0].libvaultMd5, md5)
    }



    func testMatchSharedFavoritesPrefersLatestMetadataForDuplicateUrlKey() {
        let source = "https://example.org/duplicate.epub"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(url: source, title: "First title"),
                SharedFavoriteRef(url: source, title: "Latest title")
            ],
            books: []
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, source)
        XCTAssertEqual(result.external[0].title, "Latest title")
    }

    func testMatchSharedFavoritesDuplicateIsbnRefsMatchCatalogByNormalizedISBN() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(isbn: "978-0-123456-78-9", title: "Legacy match"),
                SharedFavoriteRef(isbn: "9780123456789", title: "Current match")
            ],
            books: [CatalogBook(
                id: "book-isbn-1",
                title: "Catalog ISBN",
                author: "Author",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: "978-0-123456-78-9",
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["book-isbn-1"])
        XCTAssertEqual(result.external.count, 0)
    }

    func testMatchSharedFavoritesDuplicateBookstrRefsMatchCatalogBookBySourceId() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(bookstrId: "source:42", title: "Legacy title", author: "Old author"),
                SharedFavoriteRef(bookstrId: "source:42", title: "Current title", author: "Current author"),
            ],
            books: [CatalogBook(
                id: "source:42",
                title: "Catalog title",
                author: "Catalog author",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["source:42"])
        XCTAssertEqual(result.external.count, 0)
    }



    func testPendingUrlSurvivesUnknownCompactTagUntilKnownConsumesIt() {
        let url = "https://example.org/books/123"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["book", "mystery", "ignored", "1700000000"],
            ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].url, url)
    }

    func testCurrentSharedFavoriteRefPreservesUrlWhenIstagHasBlankLocator() {
        let url = "https://example.org/book.epub"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000", url],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
    }

    func testCurrentSharedFavoriteRefRetainsUrlWhenIstagIsbnIsInvalid() {
        let url = "https://example.org/read"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "bookstr", "source:42", "1700000000", url],
            ["i", "isbn:not-an-isbn", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:42")
        XCTAssertEqual(refs[0].url, url)
    }

    func testCurrentSharedFavoriteRefRetainsMetadataWhenIstagIsNotIsbn() {
        let url = "https://example.org/read"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "bookstr", "source:42", "1700000000", url],
            ["i", "not-a-supported-tag", "https://example.org/other"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:42")
        XCTAssertEqual(refs[0].url, url)
    }

    func testCurrentSharedFavoriteRefPreservesUrlWhenIstagHasDifferentLocator() {
        let existingUrl = "https://example.org/read/original"
        let replacementUrl = "https://example.org/read/ignored"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "bookstr", "source:42", "1700000000", existingUrl],
            ["i", "isbn:978-0-123456-78-9", replacementUrl],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:42")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, existingUrl)
    }

    func testStandaloneIstagUsesProvidedLocatorWithoutPendingUrl() {
        let locator = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["i", "isbn:978-0-123456-78-9", locator],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertNil(refs[0].libvaultMd5)
        XCTAssertNil(refs[0].bookstrId)
        XCTAssertEqual(refs[0].url, locator)
    }

    func testStandaloneIstagUsesPendingUrlAfterInvalidIstag() {
        let pendingUrl = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", pendingUrl],
            ["i", "isbn:not-an-isbn", "https://example.org/ignored"],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, pendingUrl)
    }

    func testStandaloneIstagUsesPendingUrlWhenNoCurrentRefExists() {
        let url = "https://example.org/books/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertNil(refs[0].libvaultMd5)
        XCTAssertNil(refs[0].bookstrId)
        XCTAssertEqual(refs[0].url, url)
    }

    func testUnknownCompactTagDoesNotBlockSubsequentIstagIsbn() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "bookstr", "source:42", "1700000000", "https://example.org/read"],
            ["book", "mystery", "ignored", "1700000001"],
            ["i", "isbn:978-0-123456-78-9", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:42")
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/read")
    }

    func testPendingUrlIsPreservedWhenInvalidIsbnTagIsSkipped() {
        let url = "https://example.org/books/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["i", "isbn:not-an-isbn", "1700000000"],
            ["book", "bookstr", "openlibrary:OL9M", "1700000001"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "openlibrary:OL9M")
        XCTAssertEqual(refs[0].url, url)
    }

    func testPendingUrlIsAppliedToLegacyBookstrTagWithMissingMetadata() {
        let url = "https://example.org/books/track?source=openlibrary:OL9M"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", url],
            ["bookstr", "openlibrary:OL9M", "", "", ""],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "openlibrary:OL9M")
        XCTAssertEqual(refs[0].url, url)
        XCTAssertNil(refs[0].title)
        XCTAssertNil(refs[0].author)
    }



    func testCompactItemTagsFallsBackToProvidedAddedAt() {
        let tags = FavoritesParser.compactItemTags(
            refs: [SharedFavoriteRef(
                libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                title: "Title",
                addedAt: 0,
            )],
            fallbackAddedAt: 1_700_000_000
        )

        XCTAssertEqual(tags.first, ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000"])
        XCTAssertTrue(tags.contains { $0.first == "libvault-book" && $0.count >= 7 })
    }

    func testParseCollectionIndexIgnoresMalformedEntriesAndKeepsValidOnes() {
        let snapshot = FavoritesParser.parseCollectionIndex(#"""
            [["deleted","bad-id","1700000020"],
             ["collection","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Keep","1700000010"],
             ["collection","not-a-collection","Ignored","1700000011"],
             ["deleted","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","1700000015"]]
            """#)

        XCTAssertEqual(snapshot.entries.count, 0)
        XCTAssertEqual(snapshot.tombstones.count, 1)
        XCTAssertEqual(snapshot.tombstones[0].id, "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testParseCollectionIndexDefaultsEmptyTitlesToUntitledList() {
        let snapshot = FavoritesParser.parseCollectionIndex(#"""
            [["collection","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","","1700000010"]]
            """#)

        XCTAssertEqual(snapshot.entries.count, 1)
        XCTAssertEqual(snapshot.entries[0].0, "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(snapshot.entries[0].1, "Untitled list")
        XCTAssertEqual(snapshot.entries[0].2, 1_700_000_010)
    }

    func testCollectionTagsDropEmptyDescription() {
        let collection = BookCollection(
            id: "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            title: "No description",
            description: "",
            updatedAt: 1_700_000_000,
            items: []
        )
        let tags = FavoritesParser.collectionTags(collection)

        XCTAssertFalse(tags.contains { $0.first == "description" })
    }

    func testMatchSharedFavoritesUsesNormalizedISBNAcrossFormats() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(isbn: "978-1-2345-6789-0")],
            books: [CatalogBook(
                id: "book-1",
                title: "Matched",
                author: "Author",
                epubUrl: "https://example.com/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: "9781234567890",
                libvaultMd5: nil,
                format: .epub,
                year: nil
            )]
        )

        XCTAssertEqual(result.bookIds, ["book-1"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testInvalidPdfHeaderIsRejectedInsteadOfOpeningBlackReader() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data("%PDF-not-a-document".utf8).write(to: url)
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .pdf)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .pdf))
    }

    func testCBZIsDetectedFromImageEntriesInsteadOfBeingMisclassifiedAsEPUB() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".cbz")
        defer { try? FileManager.default.removeItem(at: url) }
        try makeStoredZip([
            ("001.jpg", "image-one"),
            ("chapter/002.png", "image-two")
        ]).write(to: url)

        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .cbz)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .cbz))
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    func testArbitraryZipIsNotAcceptedAsEPUBOrCBZ() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".zip")
        defer { try? FileManager.default.removeItem(at: url) }
        try makeStoredZip([("notes.txt", "not a publication")]).write(to: url)

        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .epub)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .epub))
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .cbz))
    }

    func testCBRRecognizesRAR4AndRAR5Signatures() throws {
        for signature in [
            Data([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00, 0x01]),
            Data([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00, 0x01])
        ] {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".cbr")
            defer { try? FileManager.default.removeItem(at: url) }
            try signature.write(to: url)
            XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .cbr)
            XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .cbr))
        }
    }

#if canImport(UIKit)
    func testRealPdfIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 200, height: 200))
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            "Bookstr".draw(at: CGPoint(x: 20, y: 20), withAttributes: nil)
        }
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .pdf)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .pdf))
    }

    func testPublicDomainAlicePdfFixtureIsAcceptedAndHasReadableText() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let excerpt = "Alice was beginning to get very tired of sitting by her sister on the bank."
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 420, height: 595))
        try renderer.writePDF(to: url) { context in
            context.beginPage()
            "Alice's Adventures in Wonderland\nLewis Carroll\n\n\(excerpt)".draw(
                in: CGRect(x: 36, y: 36, width: 348, height: 500),
                withAttributes: [.font: UIFont.systemFont(ofSize: 15)]
            )
        }
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .pdf))
        let extracted = PDFDocument(url: url)?.string ?? ""
        XCTAssertTrue(extracted.contains("Alice was beginning"))
        XCTAssertTrue(extracted.contains("Lewis Carroll"))
    }

    func testPublicDomainAliceEpubFixtureIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        let entries = [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Alice's Adventures in Wonderland</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/chapter.xhtml", "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>Down the Rabbit-Hole</h1><p>Alice was beginning to get very tired.</p></body></html>")
        ]
        try makeStoredZip(entries).write(to: url)
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .epub)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    @MainActor
    func testOpeningCoverImagesAndIndexRemainScrollableAndStable() async throws {
        try await checkOpeningCoverLayout(separateCover: false)
    }

    @MainActor
    func testPercentageSizedCoverAndFollowingImagesRemainStable() async throws {
        try await checkOpeningCoverLayout(separateCover: true)
    }

    @MainActor
    private func checkOpeningCoverLayout(separateCover: Bool) async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        var entries = [
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">opening</dc:identifier><dc:title>Opening images</dc:title><dc:language>nl</dc:language></metadata><manifest><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="cover" linear="no"/><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/cover.xhtml", #"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover and index</title></head><body><svg xmlns="http://www.w3.org/2000/svg" id="front-cover" width="400" height="650" viewBox="0 0 400 650"><rect width="400" height="650" fill="green"/></svg><svg xmlns="http://www.w3.org/2000/svg" id="second-image" width="400" height="650" viewBox="0 0 400 650"><rect width="400" height="650" fill="blue"/></svg><nav id="opening-index"><h1>Inhoud</h1><a href="chapter.xhtml">Hoofdstuk een</a></nav></body></html>"#),
            ("OEBPS/nav.xhtml", #"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Hoofdstuk een</a></li></ol></nav></body></html>"#),
            ("OEBPS/chapter.xhtml", #"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Hoofdstuk een</h1><p>Het verhaal begint hier.</p></body></html>"#)
        ]
        if separateCover {
            entries[2].1 = entries[2].1
                .replacingOccurrences(of: "<spine>", with: "<spine><itemref idref=\"titlepage\" linear=\"no\"/>")
                .replacingOccurrences(of: "</manifest>", with: "<item id=\"titlepage\" href=\"titlepage.xhtml\" media-type=\"application/xhtml+xml\"/></manifest>")
            entries[3].1 = entries[3].1.replacingOccurrences(of: "id=\"front-cover\"", with: "id=\"opening-image\"")
            entries.append(("OEBPS/titlepage.xhtml", #"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body style="text-align:center;margin:0;padding:0"><div><svg xmlns="http://www.w3.org/2000/svg" id="front-cover" width="100%" height="100%" viewBox="0 0 781 1186" preserveAspectRatio="none"><rect width="781" height="1186" fill="green"/></svg></div></body></html>"#))
        }
        try makeStoredZip(entries).write(to: url)
        let book = CatalogBook(
            id: "opening-fixture", title: "Opening images", author: "Test",
            epubUrl: url.absoluteString, coverUrl: nil, sourceUrl: nil, isbn: nil,
            libvaultMd5: nil, format: .epub, year: nil
        )
        let controller = EPUBReaderController()
        let view = EPUBReaderView(
            book: book, fileURL: url, controller: controller,
            initialCFI: nil, highlightCFI: nil
        )
        .frame(width: 390, height: 844)
        .environmentObject(AppContainer.bootstrap())
        let host = UIHostingController(rootView: view)
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        defer { window.isHidden = true }
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            controller.ready || controller.errorMessage != nil
        }, object: nil)], timeout: 15)
        XCTAssertNil(controller.errorMessage)
        XCTAssertTrue(controller.ready)
        let webView = try XCTUnwrap(findSubview(WKWebView.self, in: host.view))
        let result = try await webView.callAsyncJavaScript(
            """
            const wait = () => new Promise(resolve => setTimeout(resolve, 700));
            await wait();
            const container = document.querySelector('.epub-container');
            const opening = () => Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).find(d => d && d.getElementById('front-cover'));
            const doc = opening();
            if (!doc) return { missingCover: true };
            const cover = doc.getElementById('front-cover').getBoundingClientRect();
            const imageDoc = Array.from(document.querySelectorAll('iframe')).map(f => f.contentDocument).find(d => d && d.getElementById('second-image'));
            if (!imageDoc) return { missingImages: true };
            const second = imageDoc.getElementById('second-image').getBoundingClientRect();
            const index = imageDoc.getElementById('opening-index').getBoundingClientRect();
            const ordered = cover.height > 300 && second.height > 300 && (doc !== imageDoc || second.top >= cover.bottom - 1) && index.top >= second.bottom - 1;
            container.scrollTop = 350;
            await wait();
            const position = container.scrollTop;
            const height = container.scrollHeight;
            await wait();
            const stable = Math.abs(container.scrollTop - position) < 3 && Math.abs(container.scrollHeight - height) < 3;
            container.scrollTop = 0;
            await wait();
            const returned = opening();
            const returnedHeight = returned ? returned.getElementById('front-cover').getBoundingClientRect().height : 0;
            return { ordered, stable, scrolled: position > 300, restored: Math.abs(returnedHeight - cover.height) < 3 };
            """, arguments: [:], in: nil, contentWorld: .page
        ) as? [String: Bool]
        XCTAssertEqual(result?["ordered"], true, "Images and index must stay in vertical order: \(String(describing: result))")
        XCTAssertEqual(result?["stable"], true)
        XCTAssertEqual(result?["scrolled"], true)
        XCTAssertEqual(result?["restored"], true, "Cover must remain visible when returning to the beginning")
    }

    @MainActor
    private func findSubview<T: UIView>(_ type: T.Type, in root: UIView) -> T? {
        if let match = root as? T { return match }
        return root.subviews.lazy.compactMap { self.findSubview(type, in: $0) }.first
    }
#endif

    func testEpubContainerMarkerAcrossReadBoundaryIsAccepted() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        let padding = String(repeating: "x", count: 65_530)
        try makeStoredZip([("padding.txt", padding), ("META-INF/container.xml", "<container/>")]).write(to: url)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    func testZipWithoutEpubContainerIsRejected() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? FileManager.default.removeItem(at: url) }
        try Data([0x50, 0x4b, 0x03, 0x04, 0x00]).write(to: url)
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .epub)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .epub))
    }

    func testNativeFB2MetadataAndValidationRejectUnsafeXML() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2")
        defer { try? FileManager.default.removeItem(at: url) }
        let fb2 = """
            <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
              <description><title-info><book-title>Тест</book-title><author><first-name>Ada</first-name><last-name>Writer</last-name></author><date>2024-01-01</date></title-info></description>
              <body><section><title><p>Глава</p></title><p>Текст</p></section></body>
            </FictionBook>
            """
        try Data(fb2.utf8).write(to: url)
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: url), .fb2)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: url, format: .fb2))
        XCTAssertEqual(PublicationUtilities.fb2Metadata(fileURL: url)?.title, "Тест")
        XCTAssertEqual(PublicationUtilities.fb2Metadata(fileURL: url)?.author, "Ada Writer")
        XCTAssertEqual(PublicationUtilities.fb2Metadata(fileURL: url)?.year, "2024")

        let unsafe = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2")
        defer { try? FileManager.default.removeItem(at: unsafe) }
        try Data("<!DOCTYPE FictionBook [<!ENTITY x SYSTEM 'https://example.test/x'>]><FictionBook><body><section><p>&x;</p></section></body></FictionBook>".utf8).write(to: unsafe)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: unsafe, format: .fb2))
    }

    func testSingleStoredFB2ZipIsAcceptedAndMultiEntryZipRejected() throws {
        let valid = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2")
        defer { try? FileManager.default.removeItem(at: valid) }
        let xml = #"<FictionBook><description><title-info><book-title>Stored</book-title></title-info></description><body><section><p>Text</p></section></body></FictionBook>"#
        try makeStoredZip([("book.fb2", xml)]).write(to: valid)
        XCTAssertEqual(PublicationUtilities.detectedFormat(fileURL: valid), .fb2)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: valid, format: .fb2))

        let multiple = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2")
        defer { try? FileManager.default.removeItem(at: multiple) }
        try makeStoredZip([("one.fb2", xml), ("two.fb2", xml)]).write(to: multiple)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: multiple, format: .fb2))

        let traversal = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2")
        defer { try? FileManager.default.removeItem(at: traversal) }
        try makeStoredZip([("../book.fb2", xml)]).write(to: traversal)
        XCTAssertFalse(PublicationUtilities.isStructurallyValidPublication(fileURL: traversal, format: .fb2))
    }

    func testSingleDeflatedFB2ZipIsAccepted() throws {
        let valid = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2.zip")
        defer { try? FileManager.default.removeItem(at: valid) }
        // ZIP_DEFLATED archive containing exactly one safe FB2 entry.
        let encoded = "UEsDBBQAAAAIAI+eHF2swOoxXQAAAJsAAAAIAAAAYm9vay5mYjJVjkEKgDAMBF9U8oGQg4gv8AO2jRAsTbE56O+tClKPOzssi5MEE82D6kYYuYZdyg0ITSyxk7wqoW+1ewCNvKbFOCJ0EKG34bfjNZ6ElcMbC818GEJp3gfhlaB/cwFQSwECFAMUAAAACACPnhxdrMDqMV0AAACbAAAACAAAAAAAAAAAAAAAgAEAAAAAYm9vay5mYjJQSwUGAAAAAAEAAQA2AAAAgwAAAAAA"
        guard let data = Data(base64Encoded: encoded) else { return XCTFail("invalid fixture") }
        try data.write(to: valid)
        XCTAssertTrue(PublicationUtilities.isStructurallyValidPublication(fileURL: valid, format: .fb2))
    }





    func testSerializesFavoriteMetadataForOfflineClients() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tags = FavoritesParser.collectionTags(refs: [
            SharedFavoriteRef(libvaultMd5: md5, title: "Not synchronized", author: "Private cache",
                              addedAt: 1_700_000_000)
        ], updatedAt: 1_700_000_100)
        XCTAssertTrue(tags.contains(["book", "libvault", md5, "1700000000"]))
        XCTAssertTrue(FavoritesParser.serializeTags(tags).contains("Not synchronized"))
        XCTAssertTrue(FavoritesParser.serializeTags(tags).contains("Private cache"))
    }

    func testSplitsCompactItemsUnderSignerLimit() {
        let refs = (0..<240).map { index in
            SharedFavoriteRef(
                libvaultMd5: String(format: "%032x", index),
                addedAt: Int64(1_700_000_000 + index)
            )
        }
        let itemTags = FavoritesParser.compactItemTags(refs: refs, fallbackAddedAt: 1_700_000_000)
        let chunks = FavoritesParser.splitItemTags(itemTags)
        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertEqual(chunks.flatMap { $0 }.count, itemTags.count)
        XCTAssertTrue(chunks.allSatisfy {
            FavoritesParser.serializeTags($0).count <= FavoritesParser.maxChunkPlaintextChars
        })
        let manifest = FavoritesParser.chunkManifest(
            from: #"[["bookstr-chunks","3","bookstr-chunk-generation"]]"#
        )
        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 3, prefix: "bookstr-chunk-generation"))
    }

    func testParseSharedFavoriteTagsSkipsInvalidTags() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            "not-a-tag",
            123,
            ["not", ["deep", "array"], "tag"],
            ["invalid": "payload"],
            ["url", "not-a-url", "1700000000"],
            ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000000"],
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    }

    func testParseSharedFavoriteTagsSkipsObjectPayloadWithoutTags() {
        let refs = FavoritesParser.parseSharedFavoriteTags(#"{"payload":"unsupported"}"#)
        XCTAssertEqual(refs.count, 0)
    }

    func testParseSharedFavoriteTagsSkipsObjectPayloadWithNonArrayTags() {
        let refs = FavoritesParser.parseSharedFavoriteTags(#"{"tags":123}"#)
        XCTAssertEqual(refs.count, 0)
    }

    func testParseSharedFavoriteTagsUsesObjectPayloadTagsArray() {
        let url = "https://example.org/booktrack/978-0-1234-5678-9"
        let refs = FavoritesParser.parseSharedFavoriteTags("""
            {"tags":[
              ["r","\(url)"],
              ["bookstr","source:7","","",""]
            ]}
        """)
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].bookstrId, "source:7")
        XCTAssertEqual(refs[0].url, url)
    }

    func testParseSharedFavoriteTagsSkipsInvalidObjectPayloadItems() {
        let url = "https://example.org/booktrack/978-0-1234-5678-9"
        let refs = FavoritesParser.parseSharedFavoriteTags("""
            {"tags":[
              ["r","\(url)"],
              123,
              ["i","isbn:978-0-1234-5678-9",""],
              {"note":"unsupported"},
              ["book","libvault","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","1700000001","https://example.org/book"]
            ]}
        """)
        XCTAssertEqual(refs.count, 2)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
        XCTAssertEqual(refs[1].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[1].url, "https://example.org/book")
    }

    func testLegacyLibvaultTagDoesNotReplaceExistingUrl() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000003", "https://example.org/read/original"],
            ["libvault", md5],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].url, "https://example.org/read/original")
    }

    func testParseSharedFavoriteTagsLowercasesCompactLibvaultIdentifier() {
        let md5 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000001", "https://example.org/book.epub"]
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testParseSharedFavoriteTagsDeduplicatesLibvaultEntriesAndKeepsEarliestAddedAt() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000005", "https://example.org/first"],
            ["libvault-book", md5, "Favorite title", "Favorite author", "epub", "1", "2025"],
            ["book", "libvault", md5, "1700000001", "https://example.org/second"],
            ["libvault-added", md5, "1700000003"],
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
        XCTAssertEqual(refs[0].title, "Favorite title")
        XCTAssertEqual(refs[0].url, "https://example.org/first")
    }

    func testParseSharedFavoriteTagsHandlesLibvaultAddedBeforeMembership() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["libvault-added", md5, "1700000003"],
            ["book", "libvault", md5, "1700000005", "https://example.org/book"],
            ["libvault-book", md5, "Recovered", "Author", "epub", "11", "2026"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_003)
        XCTAssertEqual(refs[0].title, "Recovered")
        XCTAssertEqual(refs[0].author, "Author")
        XCTAssertEqual(refs[0].url, "https://example.org/book")
        XCTAssertEqual(refs[0].format, "epub")
    }

    func testParseSharedFavoriteTagsDeduplicatesUrlMembershipAndLaterLibvaultMetadata() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let sharedURL = "https://example.org/shared.epub"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", sharedURL, "1700000042"],
            ["book", "libvault", md5, "1700000043", "https://override.example.org/book.epub"],
            ["libvault-book", md5, "Merged title", "Merged author", "epub", "11", "2026"]
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].title, "Merged title")
        XCTAssertEqual(refs[0].author, "Merged author")
        XCTAssertEqual(refs[0].format, "epub")
        XCTAssertEqual(refs[0].year, "2026")
        XCTAssertEqual(refs[0].url, sharedURL)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_042)
    }

    func testParseCompactUrlEntriesDeduplicateByUrlAndKeepEarliestAddedAt() {
        let sharedURL = "https://example.org/duplicate.url"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", sharedURL, "1700000010"],
            ["book", "url", sharedURL, "1700000002", ""],
            ["libvault", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "1700000015"]
        ])

        XCTAssertEqual(refs.count, 2)
        XCTAssertEqual(refs[0].url, sharedURL)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_002)
        XCTAssertEqual(refs[1].libvaultMd5, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    }

    func testMatchSharedFavoritesUnmatchedLibvaultReferencePrefersLatestMetadata() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(libvaultMd5: md5, title: "Legacy", author: "Old"),
                SharedFavoriteRef(libvaultMd5: md5, title: "Current", author: "New", year: "2020"),
            ],
            books: []
        )

        XCTAssertEqual(result.bookIds, [])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, md5)
        XCTAssertEqual(result.external[0].title, "Current")
        XCTAssertEqual(result.external[0].author, "New")
        XCTAssertEqual(result.external[0].year, "2020")
    }

    func testMatchSharedFavoritesPrefersLatestMetadataForDuplicateIsbnKey() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(isbn: "978-0-123456-78-9", title: "First", author: "Old"),
                SharedFavoriteRef(isbn: "9780123456789", title: "Latest", author: "New")
            ],
            books: []
        )

        XCTAssertEqual(result.bookIds, [])
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, "9780123456789")
        XCTAssertEqual(result.external[0].title, "Latest")
        XCTAssertEqual(result.external[0].author, "New")
    }





    func testParseSharedFavoriteTagsKeepsEarliestAddedAtFromLaterUrlMembership() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000042", "https://example.org/original-book.epub"],
            ["book", "url", "https://example.org/ignored-override.epub", "1700000043"]
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].url, "https://example.org/original-book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_042)
    }

    func testMatchSharedFavoritesPrefersLatestMetadataForDuplicateBookstrKey() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(bookstrId: "source:42", title: "Legacy title", author: "Old author"),
                SharedFavoriteRef(bookstrId: "source:42", title: "Current title", author: "Current author"),
            ],
            books: []
        )

        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, "source:42")
        XCTAssertEqual(result.external[0].title, "Current title")
        XCTAssertEqual(result.external[0].author, "Current author")
    }

    func testCurrentCompactRefFillsUrlFromIstagLocatorWhenMissing() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let url = "https://books.example.org/book/track?isbn=978-0-123456-78-9"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "libvault", md5, "1700000000"],
            ["i", "isbn:978-0-123456-78-9", url],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, url)
    }

    func testFavoritesParserMatchesCatalogBookByIdentifiersAndSourceUrl() {
        let book = CatalogBook(
            id: "book-id",
            title: "Catalog match",
            author: "An Author",
            epubUrl: "https://example.test/book.epub",
            coverUrl: nil,
            sourceUrl: "https://catalogue.test/read",
            isbn: "9780123456789",
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: .epub,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(SharedFavoriteRef(libvaultMd5: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), book: book))
        XCTAssertTrue(FavoritesParser.matches(SharedFavoriteRef(bookstrId: "book-id"), book: book))
        XCTAssertTrue(FavoritesParser.matches(SharedFavoriteRef(isbn: "978-0-1234-5678-9"), book: book))
        XCTAssertTrue(FavoritesParser.matches(SharedFavoriteRef(url: "https://catalogue.test/read?x=1"), book: book))
        XCTAssertFalse(FavoritesParser.matches(SharedFavoriteRef(isbn: "9789999999999"), book: book))
    }

    func testFavoritesParserMatchesByCaseInsensitiveLibvaultMd5() {
        let book = CatalogBook(
            id: "local",
            title: "Catalog match",
            author: "An Author",
            epubUrl: "https://example.test/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            format: .epub,
            year: nil
        )

        XCTAssertTrue(
            FavoritesParser.matches(
                SharedFavoriteRef(libvaultMd5: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
                book: book,
            ),
        )
    }

    func testFavoritesParserMatchesByDirectReadUrlOrRejectsMismatch() {
        let book = CatalogBook(
            id: "book-id",
            title: "Catalog match",
            author: "An Author",
            epubUrl: "https://example.test/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            year: nil
        )

        XCTAssertTrue(FavoritesParser.matches(SharedFavoriteRef(url: "https://example.test/book.epub"), book: book))
        XCTAssertFalse(FavoritesParser.matches(SharedFavoriteRef(url: "https://example.test/book-v2.epub"), book: book))
    }

    func testFavoriteFallbackMatchingNormalizesURLAndIgnoresQueryAndFragment() {
        let book = CatalogBook(
            id: "catalog-book",
            title: "Catalog book",
            author: "Author",
            epubUrl: "https://catalog.example/books/one?download=1",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            year: nil
        )
        let ref = SharedFavoriteRef(url: "HTTPS://Catalog.Example/books/one?source=nostr#chapter")

        XCTAssertTrue(FavoritesParser.matches(ref, book: book))
        XCTAssertEqual(
            FavoritesParser.matchSharedFavorites(refs: [ref], books: [book]).bookIds,
            ["catalog-book"]
        )
    }

    func testStableFavoriteDoesNotMatchDifferentBookThroughFallbackIdentity() {
        let sharedURL = "https://catalog.example/books/one"
        let ref = SharedFavoriteRef(
            bookstrId: "source:expected",
            isbn: "9780123456789",
            url: sharedURL
        )
        let book = CatalogBook(
            id: "source:different",
            title: "Different edition",
            author: "Author",
            epubUrl: sharedURL,
            coverUrl: nil,
            sourceUrl: sharedURL,
            isbn: "9780123456789",
            libvaultMd5: nil,
            format: .epub,
            year: nil
        )

        XCTAssertFalse(FavoritesParser.matches(ref, book: book))
        let result = FavoritesParser.matchSharedFavorites(refs: [ref], books: [book])
        XCTAssertTrue(result.bookIds.isEmpty)
        XCTAssertEqual(result.external.first?.key, "source:expected")
    }





    func testReadsChunkManifestWithNoiseInStringPayload() {
        let manifest = FavoritesParser.chunkManifest(
            from: """
            [
              123,
              {"note":"unsupported"},
              ["title","Favorites"],
              ["bookstr-chunks","2","bookstr-chunk-generation"]
            ]
            """
        )

        XCTAssertEqual(manifest, FavoriteChunkManifest(count: 2, prefix: "bookstr-chunk-generation"))
    }

    func testChunkManifestFromStringRejectsNonNumericCount() {
        XCTAssertNil(FavoritesParser.chunkManifest(from: #"[["bookstr-chunks","many","bookstr-chunk-generation"]]"#))
    }

    func testNormalizeISBNReturnsEmptyForInvalidInput() {
        XCTAssertEqual("9780123456789", FavoritesParser.normalizeISBN("978-0-123-45678-9"))
        XCTAssertEqual("012345678X", FavoritesParser.normalizeISBN("0-123-45678-x"))
        XCTAssertEqual("", FavoritesParser.normalizeISBN("123456"))
        XCTAssertEqual("", FavoritesParser.normalizeISBN("not-a-book-isbn"))
    }

    /// Small, dependency-free ZIP writer used to make a genuine EPUB fixture.
    /// The Alice text is public domain; keeping it generated avoids shipping a
    /// large opaque binary in the test bundle.
    private func makeStoredZip(_ entries: [(String, String)]) throws -> Data {
        var archive = Data()
        var directory = Data()
        var count: UInt16 = 0
        for (name, contents) in entries {
            let nameData = Data(name.utf8)
            let body = Data(contents.utf8)
            let crc = crc32(body)
            let offset = UInt32(archive.count)
            appendLE(UInt32(0x04034b50), to: &archive)
            appendLE(UInt16(20), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive)
            appendLE(crc, to: &archive); appendLE(UInt32(body.count), to: &archive); appendLE(UInt32(body.count), to: &archive)
            appendLE(UInt16(nameData.count), to: &archive); appendLE(UInt16(0), to: &archive)
            archive.append(nameData); archive.append(body)

            appendLE(UInt32(0x02014b50), to: &directory)
            appendLE(UInt16(20), to: &directory); appendLE(UInt16(20), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(crc, to: &directory); appendLE(UInt32(body.count), to: &directory); appendLE(UInt32(body.count), to: &directory)
            appendLE(UInt16(nameData.count), to: &directory); appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory)
            appendLE(UInt16(0), to: &directory); appendLE(UInt16(0), to: &directory); appendLE(UInt32(0), to: &directory)
            appendLE(offset, to: &directory); directory.append(nameData)
            count += 1
        }
        let directoryOffset = UInt32(archive.count)
        archive.append(directory)
        appendLE(UInt32(0x06054b50), to: &archive)
        appendLE(UInt16(0), to: &archive); appendLE(UInt16(0), to: &archive)
        appendLE(count, to: &archive); appendLE(count, to: &archive)
        appendLE(UInt32(directory.count), to: &archive); appendLE(directoryOffset, to: &archive); appendLE(UInt16(0), to: &archive)
        return archive
    }

    private func makeAliceEpub() throws -> Data {
        let paragraphs = (1...36).map { index in
            "<p>Passage \(index). Alice followed the White Rabbit through Wonderland, " +
            "where every turn brought another curious conversation and another reason to continue reading.</p>"
        }.joined()
        return try makeStoredZip([
            ("mimetype", "application/epub+zip"),
            ("META-INF/container.xml", #"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#),
            ("OEBPS/content.opf", #"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">alice-test</dc:identifier><dc:title>Alice's Adventures in Wonderland</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#),
            ("OEBPS/chapter.xhtml", "<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>Down the Rabbit-Hole</title></head><body><h1>Down the Rabbit-Hole</h1><p>Alice was beginning to get very tired.</p>\(paragraphs)</body></html>")
        ])
    }

    private func appendLE<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { data.append(contentsOf: $0) }
    }

    private func crc32(_ data: Data) -> UInt32 {
        var crc = UInt32.max
        for byte in data {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = (crc >> 1) ^ (0xedb88320 & (0 &- (crc & 1))) }
        }
        return ~crc
    }

    func testParseSharedFavoriteTagsDeduplicatesIsbnByCanonicalValueAndPreservesEarliestMetadata() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "isbn", "978-0-123456-78-9", "1700000003", "https://example.org/first"],
            ["book", "isbn", "9780123456789", "1700000002", "https://example.org/second"],
            ["book", "isbn", "978-0-1234-5678-9", "1700000001", "https://example.org/third"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, "https://example.org/first")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testParseSharedFavoriteTagsIstagUpdatesCurrentFavoriteUsingPendingUrl() {
        let pendingUrl = "https://example.org/shared/book.epub"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", pendingUrl, "1700000010"],
            ["i", "isbn:978-0-1234-5678-9", "https://override.example.org/isbn"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].isbn, "9780123456789")
        XCTAssertEqual(refs[0].url, pendingUrl)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_010)
    }



    func testParseSharedFavoriteTagsSkipsInvalidLibvaultAddedTagWhenValidOneComesLater() {
        let md5 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["libvault-added", "not-an-md5", "1700000001"],
            ["libvault-added", md5, "1700000003"],
            ["book", "libvault", md5, "1700000005", "https://example.org/book.epub"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, md5)
        XCTAssertEqual(refs[0].url, "https://example.org/book.epub")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_003)
    }







    func testMatchSharedFavoritesMatchesByDuplicateSourceUrlRefs() {
        let sourceUrl = "https://catalogue.example.com/books/123"
        let result = FavoritesParser.matchSharedFavorites(
            refs: [
                SharedFavoriteRef(url: sourceUrl, title: "Offline", addedAt: 1),
                SharedFavoriteRef(url: sourceUrl, title: "Latest", addedAt: 2),
            ],
            books: [
                CatalogBook(
                    id: "book-id",
                    title: "Catalog match",
                    author: "An Author",
                    epubUrl: "https://example.test/book.epub",
                    coverUrl: nil,
                    sourceUrl: sourceUrl,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    year: nil
                )
            ],
        )

        XCTAssertEqual(result.bookIds, Set(["book-id"]))
        XCTAssertEqual(result.external.count, 0)
    }

    func testParseCollectionIndexParsesValidEntriesAndSkipsTombstonedCollections() {
        let keepId = "bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        let tombstoneId = "bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let entries = FavoritesParser.parseCollectionIndex(
            """
            [
              ["collection", "\(keepId)", "Reading list", "1700000010"],
              ["collection", "\(tombstoneId)", "Old list", "1700000000"],
              ["deleted", "\(tombstoneId)", "1700000020"],
              ["title", "Not a collection"]
            ]
            """
        )

        XCTAssertEqual(entries.entries.count, 1)
        XCTAssertEqual(entries.entries[0].id, keepId)
        XCTAssertEqual(entries.entries[0].title, "Reading list")
        XCTAssertEqual(entries.entries[0].updatedAt, 1_700_000_010)
        XCTAssertEqual(entries.tombstones.first?.id, tombstoneId)
    }

    func testParseCollectionFallsBackToProvidedTitleWhenTitleMissing() {
        let collection = FavoritesParser.parseCollection(
            """
            [
              ["description", "A fallback title"],
              ["title", ""],
              ["updated", "1700000011"],
              ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000010"]
            ]
            """,
            id: "bookstr-collection-cccccccccccccccccccccccccccccccc",
            fallbackTitle: "Fallback name",
            fallbackUpdatedAt: 1_700_000_000,
        )

        XCTAssertEqual(collection?.title, "Fallback name")
        XCTAssertEqual(collection?.description, "A fallback title")
        XCTAssertEqual(collection?.updatedAt, 1_700_000_011)
        XCTAssertEqual(collection?.items.count, 1)
    }

    func testParseCollectionRejectsInvalidCollectionId() {
        let collection = FavoritesParser.parseCollection(
            """
            [
              ["book", "libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "1700000010"]
            ]
            """,
            id: "not-a-collection-id",
            fallbackTitle: "Fallback name",
            fallbackUpdatedAt: 1_700_000_000,
        )

        XCTAssertNil(collection)
    }



    func testCollectionIndexTagsIncludesTombstonesAndDescription() {
        let snapshot = CollectionSnapshot(
            collections: [
                BookCollection(
                    id: "dddddddddddddddddddddddddddddddd",
                    title: "Collection One",
                    description: "Some description",
                    updatedAt: 1_700_000_020,
                    items: [
                        SharedFavoriteRef(libvaultMd5: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", addedAt: 1_700_000_020)
                    ],
                )
            ],
            tombstones: [CollectionTombstone(id: "ffffffffffffffffffffffffffffffff", deletedAt: 1_700_000_030)],
        )

        let tags = FavoritesParser.collectionIndexTags(snapshot)

        XCTAssertEqual(tags[0], ["bookstr-collection-index", "1"])
        XCTAssertEqual(tags[1], ["collection", "dddddddddddddddddddddddddddddddd", "Collection One", "1700000020"])
        XCTAssertEqual(tags[2], ["deleted", "ffffffffffffffffffffffffffffffff", "1700000030"])
    }

    func testParseCollectionIndexIgnoresInvalidUpdatedAtAndDefaultsToZero() {
        let id = "bookstr-collection-dddddddddddddddddddddddddddddddd"
        let entries = FavoritesParser.parseCollectionIndex(
            """
            [["collection","\(id)","Bad update","invalid"]]
            """
        )

        XCTAssertEqual(entries.entries.count, 1)
        XCTAssertEqual(entries.entries[0].id, id)
        XCTAssertEqual(entries.entries[0].updatedAt, 0)
    }

    func testCollectionIndexTagsOmitsDeletedSectionsWhenNonePresent() {
        let snapshot = CollectionSnapshot(
            collections: [
                BookCollection(
                    id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    title: "Reading List",
                    description: "Should be ignored by index tags",
                    updatedAt: 1_700_000_040,
                    items: []
                )
            ],
            tombstones: [],
        )

        let tags = FavoritesParser.collectionIndexTags(snapshot)

        XCTAssertEqual(tags, [
            ["bookstr-collection-index", "1"],
            ["collection", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Reading List", "1700000040"]
        ])
    }

    func testDuplicateUrlRefsAndLibvaultMetadataResolveToSingleCatalogMatch() {
        let sourceUrl = "https://catalogue.example.com/books/123"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", sourceUrl],
            ["libvault", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            ["book", "url", sourceUrl, "1700000100"],
            ["book", "url", sourceUrl, "1700000000"]
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].libvaultMd5, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_000)

        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: [
                CatalogBook(
                    id: "catalog-id",
                    title: "Catalog Book",
                    author: "Author",
                    epubUrl: "https://cdn.example.com/catalog.epub",
                    coverUrl: nil,
                    sourceUrl: sourceUrl,
                    isbn: nil,
                    libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    format: .epub,
                    year: nil
                )
            ]
        )
        XCTAssertEqual(result.bookIds, ["catalog-id"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testMatchSharedFavoritesGeneratesFallbackTitleForLibvaultMetadata() {
        let md5 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        let sourceUrl = "https://example.com/fallback-book"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", sourceUrl],
            ["libvault", md5],
            ["book", "url", sourceUrl, "1700000000"]
        ])
        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: []
        )
        XCTAssertEqual(result.external.count, 1)
        XCTAssertEqual(result.external[0].key, md5)
        XCTAssertEqual(result.external[0].title, "MD5 bbbbbbbbbb…")
    }

    func testMatchSharedFavoritesDropsUnidentifiableFavorites() {
        let result = FavoritesParser.matchSharedFavorites(
            refs: [SharedFavoriteRef(title: "Offline")],
            books: []
        )
        XCTAssertTrue(result.bookIds.isEmpty)
        XCTAssertTrue(result.external.isEmpty)
    }

    func testUppercaseLibvaultMd5MatchesCatalogByLowercaseId() {
        let md5 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["r", "https://example.org/source/book.epub"],
            ["book", "libvault", md5, "1700000000", "https://example.org/source/book.epub"],
        ])
        let result = FavoritesParser.matchSharedFavorites(
            refs: refs,
            books: [
                CatalogBook(
                    id: "catalog-id",
                    title: "Catalog Book",
                    author: "Author",
                    epubUrl: "https://catalog.example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: "https://example.org/source/book.epub",
                    isbn: nil,
                    libvaultMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    format: .epub,
                    year: nil
                )
            ]
        )
        XCTAssertEqual(result.bookIds, ["catalog-id"])
        XCTAssertTrue(result.external.isEmpty)
    }

    func testDuplicateCompactUrlRefsKeepEarliestTimestampDuringParse() {
        let url = "https://example.org/duplicate.url"
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", url, "1700000010"],
            ["book", "url", url, "1700000001"],
            ["book", "url", url, "1700000015"]
        ])
        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, url)
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }

    func testInvalidCompactUrlIsIgnoredWhenMergingDuplicateUrlRefs() {
        let refs = FavoritesParser.parseSharedFavoriteTags([
            ["book", "url", "not-a-valid-url", "1700000010"],
            ["book", "url", "https://example.org/valid", "1700000001"],
            ["book", "url", "not-a-valid-url", "1700000000"],
        ])

        XCTAssertEqual(refs.count, 1)
        XCTAssertEqual(refs[0].url, "https://example.org/valid")
        XCTAssertEqual(refs[0].addedAt, 1_700_000_001)
    }



    func testFavoriteConvenienceSerializationUsesCurrentTimestampFallback() throws {
        let ref = SharedFavoriteRef(bookstrId: "book", title: "Comic", format: "cbz", addedAt: 0)
        let serialized = FavoritesParser.serializeSharedFavoriteTags([ref])
        let tags = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [[String]])
        XCTAssertEqual(tags.first, ["bookstr-collection", "2"])
        XCTAssertEqual(tags.first { $0.first == "book" }?[1], "bookstr")
        XCTAssertGreaterThan(Int64(tags.first { $0.first == "book" }?[3] ?? "0") ?? 0, 0)
        XCTAssertEqual(FavoritesParser.parseSharedFavoriteTags(serialized).first?.bookstrId, "book")
    }




}
