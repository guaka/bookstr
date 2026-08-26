import XCTest
@testable import BookstrIOS

final class CatalogRepositoryPrepareForOpeningCoverageTests: XCTestCase {
    private func withRepository(_ test: (JSONFileStore, CatalogRepository) async throws -> Void) async throws {
        let subdirectory = "bookstr-test-open-" + UUID().uuidString
        let store = JSONFileStore(subdirectory: subdirectory)
        let settings = SettingsRepository(defaults: UserDefaults(suiteName: "bookstr-tests-" + UUID().uuidString)!)
        let signerStore = SignerStore(nip46Service: Nip46Service())
        let repository = CatalogRepository(
            fileStore: store,
            settings: settings,
            signerStore: signerStore,
            nip46Service: Nip46Service()
        )
        try await test(store, repository)
    }

    func testEnsureDownloadedReturnsExistingValidLocalPublication() async throws {
        try await withRepository { _, repository in
            let id = "a".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Local publication",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let file = repository.fileStore.bookFileURL(bookId: id, format: .epub)
            try "PK\x03\x04...META-INF/container.xml".data(using: .utf8)?.write(to: file)

            let local = try await repository.ensureDownloaded(book: requested)

            XCTAssertEqual(local, file)
            XCTAssertEqual(local.pathExtension, "epub")
        }
    }

    func testPrepareForOpeningCorrectsRequestedFormatUsingLocalPublicationCandidate() async throws {
        try await withRepository { _, repository in
            let id = "b".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Format correction",
                author: "Reader",
                epubUrl: "https://example.org/request.pdf",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = repository.fileStore.bookFileURL(bookId: id, format: .epub)
            try "PK\x03\x04...META-INF/container.xml".data(using: .utf8)?.write(to: epubFile)

            let prepared = try await repository.prepareForOpening(book: requested)

            XCTAssertEqual(prepared.format, .epub)
            XCTAssertEqual(prepared.id, id)
        }
    }

    func testPrepareForOpeningRejectsBadRemoteUrlWithoutFallbackPublication() async {
        try await withRepository { _, repository in
            let book = CatalogBook(
                id: "c".repeating(64),
                title: "Bad remote",
                author: "Reader",
                epubUrl: "notaurl",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            do {
                _ = try await repository.prepareForOpening(book: book)
                XCTFail("prepareForOpening should fail for malformed remote URL")
            } catch let error as URLError {
                XCTAssertEqual(error.code, .badURL)
            }
        }
    }
}
