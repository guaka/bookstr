import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class BookRightsV1ContractTests: XCTestCase {
    func testIOSRightsAdapterConformsToEverySharedV1Case() throws {
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL()))
        XCTAssertEqual(fixture.version, 1)

        for entry in fixture.cases {
            let actual = BookRights.normalize(
                status: entry.input.status,
                license: entry.input.license,
                licenseURL: entry.input.licenseURL,
                source: entry.input.rightsSource,
                copyright: entry.input.copyright
            )
            XCTAssertEqual(actual.status.rawValue, entry.expected.rightsStatus, entry.name)
            XCTAssertEqual(actual.license, entry.expected.license, entry.name)
            XCTAssertEqual(actual.licenseURL, entry.expected.licenseURL, entry.name)
            XCTAssertEqual(actual.source, entry.expected.rightsSource, entry.name)
        }
    }

    func testBookFormatsCoverMetadataAndURLFallbacks() {
        XCTAssertEqual(BookFormat.from(format: " fb2.zip "), .fb2)
        XCTAssertEqual(BookFormat.from(format: "CBR"), .cbr)
        XCTAssertEqual(BookFormat.from(format: "cbz"), .cbz)
        XCTAssertEqual(BookFormat.from(format: nil, url: "https://example.test/book.PDF?download=1"), .pdf)
        XCTAssertEqual(BookFormat.from(format: nil, url: "book.fb2.zip"), .fb2)
        XCTAssertEqual(BookFormat.from(format: nil, url: "book.cbr"), .cbr)
        XCTAssertEqual(BookFormat.from(format: nil, url: "book.cbz"), .cbz)
        XCTAssertEqual(BookFormat.from(format: "unknown", url: "book.bin"), .epub)
    }

    func testRightsLabelsAndBookAdaptersExposeAllComputedProperties() throws {
        XCTAssertEqual(BookRights(status: .publicDomain).accessibleLabel, "Public domain")
        XCTAssertEqual(BookRights(status: .openLicense).accessibleLabel, "Open license")
        XCTAssertEqual(BookRights(status: .copyrighted).accessibleLabel, "Copyrighted")
        XCTAssertEqual(BookRights(status: .unknown).accessibleLabel, "No open license identified")
        XCTAssertEqual(BookRights(status: .publicDomain, license: "CC 0").compactLabel, "CC0")
        XCTAssertEqual(BookRights(status: .openLicense, license: "Creative Commons CC-BY-SA 4.0").compactLabel, "CC BY-SA 4.0")
        XCTAssertEqual(BookRights(status: .openLicense).compactLabel, "OPEN")
        XCTAssertEqual(BookRights(status: .copyrighted).compactLabel, "©")

        let catalog = CatalogBook(
            id: "catalog", title: "Title", author: "Author", epubUrl: "book.cbz", coverUrl: nil,
            sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .cbz, year: nil,
            rightsStatus: "open", license: "CC BY 4.0", licenseUrl: nil, rightsSource: "test"
        )
        XCTAssertEqual(catalog.rights.status, .openLicense)

        let readable = BookSearchResult(
            id: "result", source: "test", title: "Title", author: "Author", year: "2026",
            publisher: nil, language: "pt", format: .cbr, downloadUrl: "https://example.test/book.cbr",
            coverUrl: nil, rating: 1, editionCount: 1, rightsStatus: "public_domain",
            license: "Public domain", rightsSource: "catalog"
        )
        XCTAssertTrue(readable.isReadable)
        XCTAssertEqual(readable.rights.status, .publicDomain)
        XCTAssertEqual(try XCTUnwrap(readable.asCatalogBook()).format, .cbr)
        XCTAssertEqual(readable.asFavoriteBook().language, "pt")

        let unavailable = BookSearchResult(
            id: "missing", source: "test", title: "Missing", author: "", year: nil,
            publisher: nil, language: nil, format: nil, downloadUrl: nil, coverUrl: nil,
            rating: 0, editionCount: 0
        )
        XCTAssertFalse(unavailable.isReadable)
        XCTAssertNil(unavailable.asCatalogBook())
        XCTAssertEqual(unavailable.asFavoriteBook().format, .epub)
        XCTAssertEqual(unavailable.asFavoriteBook().epubUrl, "")
    }

    func testModelIdentifiersReturnStableKeys() {
        let word = VocabularyWord(
            key: "word-key", word: "word", language: "en", syncId: "sync", bookId: "book",
            bookTitle: "Title", cfi: "cfi", contextSentence: "context", partOfSpeech: "noun",
            definitions: [], translation: nil, sourceUrl: "", lookupCount: 1,
            firstSeenAt: 1, lastSeenAt: 2, deleted: false
        )
        let snippet = BookSnippet(
            syncId: "snippet-key", text: "text", bookId: "book", bookTitle: "Title", author: "Author",
            isbn: nil, format: .cbz, locator: "comic:1:2", createdAt: 1, updatedAt: 2, deleted: false
        )
        XCTAssertEqual(word.id, "word-key")
        XCTAssertEqual(snippet.id, "snippet-key")
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/fixtures/book-rights-v1.json")
    }
}

private struct Fixture: Decodable {
    let version: Int
    let cases: [FixtureCase]
}

private struct FixtureCase: Decodable {
    let name: String
    let input: Input
    let expected: Expected
}

private struct Input: Decodable {
    let status: String?
    let license: String?
    let licenseURL: String?
    let rightsSource: String?
    let copyright: Bool?

    enum CodingKeys: String, CodingKey {
        case status, license, copyright
        case licenseURL = "license_url"
        case rightsSource = "rights_source"
    }
}

private struct Expected: Decodable {
    let rightsStatus: String
    let license: String?
    let licenseURL: String?
    let rightsSource: String?

    enum CodingKeys: String, CodingKey {
        case rightsStatus = "rights_status"
        case license
        case licenseURL = "license_url"
        case rightsSource = "rights_source"
    }
}
