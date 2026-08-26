import XCTest
@testable import BookstrIOS

final class FavoritesCollectionExtraCoverageTests: XCTestCase {
    func testParseCollectionUsesFallbackTitleAndUpdatedAt() {
        let collection = FavoritesParser.parseCollection(
            #"""
            [["title","Favorites"],["bookstr","book","id","1700000010"]]
            """#,
            id: "bookstr-collection-" + String(repeating: "a", count: 32),
            fallbackTitle: "Saved",
            fallbackUpdatedAt: 1_700_000_000,
        )

        XCTAssertNotNil(collection)
        XCTAssertEqual(collection?.title, "Saved")
        XCTAssertEqual(collection?.updatedAt, 1_700_000_000)
    }

    func testParseCollectionIndexSkipsInvalidEntriesButKeepsValidOnes() {
        let updated = FavoritesParser.parseCollectionIndex(
            #"""
            [
              0,
              "bad",
              ["collection","bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Reading List","1700000020"],
              ["deleted","bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","1700000000"]
            ]
            """#,
        )
        XCTAssertEqual(updated.entries, [("bookstr-collection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Reading List", 1_700_000_020)])
        XCTAssertEqual(updated.tombstones, [CollectionTombstone(id: "bookstr-collection-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", deletedAt: 1_700_000_000)])
    }

    func testCollectionTagsRoundTripPreservesDescriptionAndUpdatedTimestamp() {
        let collection = BookCollection(
            id: "bookstr-collection-" + String(repeating: "b", count: 32),
            title: "Library",
            description: "My books",
            updatedAt: 1_700_000_100,
            items: [
                SharedFavoriteRef(isbn: "978-0-12-345-678-9", title: "Title", addedAt: 1_700_000_050),
            ],
        )
        let tags = FavoritesParser.collectionTags(collection)
        let parsed = FavoritesParser.parseCollection(
            FavoritesParser.serializeTags(tags),
            id: collection.id,
            fallbackTitle: "Fallback",
            fallbackUpdatedAt: 1_700_000_000,
        )

        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed?.description, "My books")
        XCTAssertEqual(parsed?.updatedAt, 1_700_000_100)
        XCTAssertEqual(parsed?.items.count, 1)
        XCTAssertEqual(parsed?.items[0].isbn, "9780123456789")
    }

    func testCollectionIndexTagsIncludeUpdatedAtAndCollectionId() {
        let snapshot = CollectionSnapshot(
            collections: [
                BookCollection(
                    id: "bookstr-collection-" + String(repeating: "c", count: 32),
                    title: "Read",
                    description: "",
                    updatedAt: 1_700_000_111,
                    items: [],
                ),
            ],
            tombstones: [CollectionTombstone(id: "bookstr-collection-" + String(repeating: "d", count: 32), deletedAt: 1_700_000_222)],
        )
        let tags = FavoritesParser.collectionIndexTags(snapshot)

        XCTAssertEqual(tags[1], ["collection", "bookstr-collection-c" + String(repeating: "c", count: 31), "Read", "1700000111"])
        XCTAssertEqual(tags[2], ["deleted", "bookstr-collection-" + String(repeating: "d", count: 32), "1700000222"])
    }
}
