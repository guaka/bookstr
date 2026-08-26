import XCTest
@testable import BookstrIOS

final class CatalogRepositoryIntegrityCoverageTests: XCTestCase {
    func testDetectedFormatReturnsNilForMissingFile() {
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-missing-" + UUID().uuidString)
        XCTAssertNil(CatalogRepository.detectedFormat(fileURL: missing))
    }

    func testSha256ReturnsNilForInvalidChunkSizesOrMissingFile() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-sha256-" + UUID().uuidString)
        try? "catalog test".data(using: .utf8)?.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        XCTAssertNil(CatalogRepository.sha256(fileURL: file, chunkSize: 0))
        XCTAssertNil(CatalogRepository.sha256(fileURL: file, chunkSize: -5))
        XCTAssertNil(CatalogRepository.sha256(fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-missing-" + UUID().uuidString), chunkSize: 1024))
    }

    func testDetectedFormatReturnsPdfForPdfHeader() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-pdf-" + UUID().uuidString)
        try? "%PDF-1.7\n".data(using: .utf8)?.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        XCTAssertEqual(.pdf, CatalogRepository.detectedFormat(fileURL: file))
    }

    func testDetectedFormatReturnsNilForUnknownHeader() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-unknown-" + UUID().uuidString)
        try? "not a book".data(using: .utf8)?.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        XCTAssertNil(CatalogRepository.detectedFormat(fileURL: file))
    }

    func testSha256MatchesExpectedDigestForSmallPayload() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("bookstr-sha256-hello-" + UUID().uuidString)
        try? "hello".data(using: .utf8)?.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        XCTAssertEqual("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", CatalogRepository.sha256(fileURL: file))
    }
}
