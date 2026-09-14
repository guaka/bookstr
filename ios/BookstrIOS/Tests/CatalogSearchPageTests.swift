import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class CatalogSearchPageTests: XCTestCase {
    let md5 = String(repeating: "a", count: 32)

    func testMetadataIdentityFormatsAndPagination() throws {
        let records: [[String: Any]] = [
            ["md5": md5.uppercased(), "extension": "PDF", "title": "Example", "author": "Author",
             "year": "2020", "publisher": "Press", "language": "en", "rights_status": "public_domain",
             "license": "CC0", "license_url": "https://example.org/license", "rights_source": "catalog"],
            ["md5": String(repeating: "c", count: 32)],
            ["md5": "invalid"], [:]
        ]
        let page = CatalogSearchPage.libcat(["books": records, "next_offset": 50], offset: 0)
        XCTAssertEqual(page.books.count, 2)
        XCTAssertEqual(page.nextOffset, 50)
        let result = try XCTUnwrap(page.books.first)
        XCTAssertEqual(result.id, md5)
        XCTAssertEqual(result.source, "libcat")
        XCTAssertEqual(result.publisher, "Press")
        XCTAssertTrue(result.isReadable)
        let book = try XCTUnwrap(result.asCatalogBook())
        XCTAssertEqual(book.libvaultMd5, md5)
        XCTAssertEqual(book.format, .pdf)
        XCTAssertEqual(book.epubUrl, "")
        XCTAssertEqual(book.year, "2020")
        XCTAssertEqual(book.language, "en")
        XCTAssertEqual(book.rightsStatus, "public_domain")
        XCTAssertEqual(result.asFavoriteBook().libvaultMd5, md5)
        XCTAssertFalse(page.books[1].isReadable)
        XCTAssertNil(page.books[1].asCatalogBook())
        XCTAssertEqual(page.books[1].title, "Untitled")
        XCTAssertEqual(page.books[1].author, "Unknown author")
        XCTAssertEqual(page.books[1].asFavoriteBook().format, .epub)
        XCTAssertEqual(CatalogSearchPage.merge(page.books, page.books).count, 2)
        XCTAssertTrue(CatalogSearchPage.libcat([:], offset: 0).books.isEmpty)
        for next in [0, -1, 50] {
            XCTAssertNil(CatalogSearchPage.libcat(["next_offset": next], offset: 50).nextOffset)
        }
        for ext in ["epub", "fb2", "cbr", "cbz", "mobi"] {
            let item = CatalogSearchPage.libcat(["books": [["md5": md5, "extension": ext]]], offset: 0).books[0]
            XCTAssertEqual(item.isReadable, ext != "mobi")
        }
    }

    func testAuthorsFieldAndLegacyFallback() {
        for (fields, expected): ([String: Any], String) in [
            (["authors": "  Ursula Le Guin  ", "author": "legacy"], "Ursula Le Guin"),
            (["authors": " ", "author": "Legacy Author"], "Legacy Author"),
            (["authors": 123, "author": "Legacy Author"], "Legacy Author"),
            (["authors": " ", "author": " "], "Unknown author")
        ] {
            var record = fields; record["md5"] = md5
            XCTAssertEqual(CatalogSearchPage.libcat(["books": [record]], offset: 0).books[0].author, expected)
        }
    }

    func testHashValidation() {
        XCTAssertTrue(CatalogSearchPage.validHash("0123456789abcdefABCDEF", length: 22))
        for hash in ["", "zz", "éa", "a/", "a:", "a@", "aG", "ag"] {
            XCTAssertFalse(CatalogSearchPage.validHash(hash, length: 2))
        }
    }

}
