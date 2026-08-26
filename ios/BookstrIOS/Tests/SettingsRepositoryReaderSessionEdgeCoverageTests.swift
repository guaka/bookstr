import XCTest
@testable import BookstrIOS

final class SettingsRepositoryReaderSessionEdgeCoverageTests: XCTestCase {
    func testSaveReaderSessionClearsSessionWhenBookIdIsBlank() {
        let suite = "bookstr-reader-session-blank-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Failed to create suite")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let repository = SettingsRepository(defaults: defaults)

        repository.saveReaderSession(
            ReaderSession(
                bookId: "book-id",
                bookTitle: "Book",
                format: .epub,
                author: "Author",
                locator: "chapter-1",
                pageIndex: 4,
                pageOffset: 12,
            )
        )
        XCTAssertNotNil(repository.readerSession())

        repository.saveReaderSession(
            ReaderSession(
                bookId: "   ",
                bookTitle: "Blank",
                format: .epub,
            )
        )
        XCTAssertNil(repository.readerSession())
    }

    func testReaderSessionReturnsNilForMalformedStoredPayload() {
        let suite = "bookstr-reader-session-malformed-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Failed to create suite")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let repository = SettingsRepository(defaults: defaults)
        defaults.set(Data("not-json".utf8), forKey: "reader_session")

        XCTAssertNil(repository.readerSession())
    }

    func testSaveReaderSessionClampsNegativeIndexes() {
        let suite = "bookstr-reader-session-index-clamp-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Failed to create suite")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let repository = SettingsRepository(defaults: defaults)
        repository.saveReaderSession(
            ReaderSession(
                bookId: "book-id",
                bookTitle: "Book",
                format: .epub,
                pageIndex: -5,
                pageOffset: -9,
            )
        )
        let loaded = repository.readerSession()

        XCTAssertEqual(loaded?.pageIndex, 0)
        XCTAssertEqual(loaded?.pageOffset, 0)
    }

    func testHasNip46SessionCredentialsRequiresBunkerPrefix() {
        let suite = "bookstr-nip46-session-creds-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            XCTFail("Failed to create suite")
            return
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let repository = SettingsRepository(defaults: defaults)
        repository.authMode = .nip46
        repository.nip46ClientSecret = "secret"
        repository.nip46BunkerURL = "https://example.com/relay"

        XCTAssertFalse(repository.hasNip46SessionCredentials)

        repository.nip46BunkerURL = "bunker://relay"
        XCTAssertTrue(repository.hasNip46SessionCredentials)
    }
}
