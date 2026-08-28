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
