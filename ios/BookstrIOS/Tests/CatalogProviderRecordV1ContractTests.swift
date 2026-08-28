import Foundation
import XCTest
@testable import BookstrLogic

final class CatalogProviderRecordV1ContractTests: XCTestCase {
    func testGeneratedDTORoundTripsEveryCanonicalProviderFixture() throws {
        let data = try Data(contentsOf: fixtureURL())
        let document = try JSONDecoder().decode(FixtureDocument.self, from: data)

        XCTAssertEqual(document.version, catalogProviderRecordVersion)
        XCTAssertEqual(document.records.count, 5)
        for record in document.records {
            XCTAssertEqual(try JSONDecoder().decode(
                CatalogProviderRecordV1.self,
                from: JSONEncoder().encode(record)
            ), record)
            XCTAssertEqual(record.publicationId, "\(record.provider):\(record.recordId)")
        }
    }

    func testGeneratedDTOPreservesOptionalRightsAndPDFAcquisition() throws {
        let data = Data("""
        {
          "provider":"fixture","recordId":"pdf","publicationId":"fixture:pdf","title":"PDF",
          "authors":[],"languages":[],"publishedYear":"2026",
          "rights":{"status":"open_license","license":"CC BY","licenseUrl":"https://example.test/license","source":"fixture"},
          "acquisitions":[{"format":"pdf","url":"https://example.test/book.pdf","availability":"preview"}]
        }
        """.utf8)
        let record = try JSONDecoder().decode(CatalogProviderRecordV1.self, from: data)

        XCTAssertEqual(record.publishedYear, "2026")
        XCTAssertEqual(record.rights.license, "CC BY")
        XCTAssertEqual(record.rights.licenseUrl, "https://example.test/license")
        XCTAssertEqual(record.rights.source, "fixture")
        XCTAssertEqual(record.acquisitions.count, 1)
        XCTAssertEqual(record.acquisitions.first?.format, "pdf")
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("shared/catalog/provider-records.json")
    }
}

private struct FixtureDocument: Decodable {
    let version: Int
    let records: [CatalogProviderRecordV1]
}
