import NostrCore
import XCTest
@testable import BookstrIOS

final class NostrSnippetPublishingTests: XCTestCase {
    private final class MemorySecureStore: SecureStringStore {
        var values: [String: String] = [:]

        @discardableResult
        func set(key: String, value: String?) -> Bool {
            values[key] = value
            return true
        }

        func get(key: String) -> String? { values[key] }
    }

    private final class StubPublisher: NostrEventPublishing {
        let accepted: Bool
        private(set) var events: [NostrEvent] = []
        private(set) var relays: [[String]] = []

        init(accepted: Bool) {
            self.accepted = accepted
        }

        func publishEvent(_ event: NostrEvent, relays: [String]) async -> Bool {
            events.append(event)
            self.relays.append(relays)
            return accepted
        }
    }

    private struct Context {
        let settings: SettingsRepository
        let service: NostrSyncService
        let cleanup: () -> Void
    }

    func testCanonicalConstantsModelsAndErrorDescriptions() throws {
        XCTAssertEqual(NostrKinds.comment, 1111)
        XCTAssertEqual(NostrKinds.snippetPrefix, "app.bookstr.snippet.")
        XCTAssertEqual(SnippetVisibility.publicPost.rawValue, "publicPost")
        XCTAssertEqual(SnippetVisibility.privateNote.rawValue, "privateNote")
        XCTAssertEqual(NostrSyncError.noSigner.errorDescription, "Connect Nostr in Settings first.")
        XCTAssertEqual(NostrSyncError.missingBookIdentity.errorDescription,
                       "Public snippets require an ISBN for this book.")
        XCTAssertEqual(NostrSyncError.relayRejected.errorDescription,
                       "No configured relay accepted the snippet.")
        XCTAssertEqual(NostrSyncError.favoriteAuthorMismatch.errorDescription,
                       "Favorite event has the wrong author")

        let payload = BookSnippetPayload(
            version: 1,
            id: "snippet",
            text: "A passage",
            bookId: "book",
            title: "Title",
            author: "Author",
            isbn: "9781234567897",
            format: .epub,
            locator: "epubcfi(/6/2)",
            createdAt: 1_700_000_000_000
        )
        XCTAssertEqual(try JSONDecoder().decode(
            BookSnippetPayload.self,
            from: JSONEncoder().encode(payload)
        ), payload)
    }

    func testISBNNormalizationAcceptsLegacySeparatorsAndRejectsInvalidValues() {
        XCTAssertEqual(NostrSyncService.normalizedISBN("978-1-2345-6789-7"), "9781234567897")
        XCTAssertEqual(NostrSyncService.normalizedISBN("0 12345678 X"), "012345678X")
        XCTAssertNil(NostrSyncService.normalizedISBN(nil))
        XCTAssertNil(NostrSyncService.normalizedISBN("123"))
        XCTAssertNil(NostrSyncService.normalizedISBN("978123456789X"))
    }

    func testBlankSnippetIsRejectedBeforeSignerLookup() async {
        let context = makeContext()
        defer { context.cleanup() }

        await assertSyncError(.relayRejected) {
            try await context.service.publishSnippet(
                text: "  \n ", book: sampleBook(), locator: "epubcfi(/6/2)", visibility: .privateNote
            )
        }
    }

    func testPublishingRequiresAConfiguredSigner() async {
        let context = makeContext()
        defer { context.cleanup() }

        await assertSyncError(.noSigner) {
            try await context.service.publishSnippet(
                text: "Passage", book: sampleBook(), locator: "epubcfi(/6/2)", visibility: .privateNote
            )
        }
    }

    func testPublicSnippetRequiresCanonicalISBN() async throws {
        let publisher = StubPublisher(accepted: true)
        let context = makeContext(publisher: publisher)
        defer { context.cleanup() }
        _ = try configureSigner(context.settings)

        await assertSyncError(.missingBookIdentity) {
            try await context.service.publishSnippet(
                text: "Passage",
                book: sampleBook(isbn: "not-an-isbn"),
                locator: "epubcfi(/6/2)",
                visibility: .publicPost
            )
        }
        XCTAssertTrue(publisher.events.isEmpty)
    }

    func testPublicSnippetPublishesCanonicalNIP73Event() async throws {
        let publisher = StubPublisher(accepted: true)
        let context = makeContext(publisher: publisher)
        defer { context.cleanup() }
        let signer = try configureSigner(context.settings)
        context.settings.relays = ["wss://relay.example"]

        let published = try await context.service.publishSnippet(
            text: "  Public passage  ",
            book: sampleBook(isbn: "978-1-2345-6789-7"),
            locator: "epubcfi(/6/2)",
            visibility: .publicPost
        )

        XCTAssertEqual(published.id, publisher.events.single?.id)
        XCTAssertEqual(published.pubkey, signer.publicKeyHex)
        XCTAssertEqual(published.kind, NostrKinds.comment)
        XCTAssertEqual(published.content, "Public passage")
        XCTAssertEqual(published.tags, [
            ["I", "isbn:9781234567897"], ["K", "isbn"],
            ["i", "isbn:9781234567897"], ["k", "isbn"]
        ])
        XCTAssertEqual(publisher.relays, [["wss://relay.example"]])
        XCTAssertNotNil(published.sig)
    }

    func testPrivateSnippetEncryptsVersionedPayloadForSelf() async throws {
        let publisher = StubPublisher(accepted: true)
        let context = makeContext(publisher: publisher)
        defer { context.cleanup() }
        let signer = try configureSigner(context.settings)

        let published = try await context.service.publishSnippet(
            text: "Private passage",
            book: sampleBook(isbn: "9781234567897"),
            locator: "epubcfi(/6/4)",
            visibility: .privateNote
        )

        XCTAssertEqual(published.kind, NostrKinds.progress)
        let dTag = try XCTUnwrap(published.dTag)
        XCTAssertTrue(dTag.hasPrefix(NostrKinds.snippetPrefix))
        let plaintext = try await signer.nip44Decrypt(published.content, from: signer.publicKeyHex)
        let payload = try JSONDecoder().decode(BookSnippet.self, from: Data(plaintext.utf8))
        XCTAssertEqual(payload.syncId, String(dTag.dropFirst(NostrKinds.snippetPrefix.count)))
        XCTAssertEqual(payload.text, "Private passage")
        XCTAssertEqual(payload.bookId, "book-id")
        XCTAssertEqual(payload.bookTitle, "Book title")
        XCTAssertEqual(payload.author, "Book author")
        XCTAssertEqual(payload.isbn, "9781234567897")
        XCTAssertEqual(payload.format, .epub)
        XCTAssertEqual(payload.locator, "epubcfi(/6/4)")
        XCTAssertGreaterThan(payload.createdAt, 0)
        XCTAssertFalse(payload.deleted)
    }

    func testRejectedPublisherReturnsRelayRejectedAfterSigning() async throws {
        let publisher = StubPublisher(accepted: false)
        let context = makeContext(publisher: publisher)
        defer { context.cleanup() }
        _ = try configureSigner(context.settings)

        await assertSyncError(.relayRejected) {
            try await context.service.publishSnippet(
                text: "Passage",
                book: sampleBook(isbn: "9781234567897"),
                locator: "epubcfi(/6/2)",
                visibility: .publicPost
            )
        }
        XCTAssertEqual(publisher.events.count, 1)
        XCTAssertNotNil(publisher.events.first?.sig)
    }

    private func makeContext(publisher: NostrEventPublishing? = nil) -> Context {
        let suite = "bookstr-snippet-\(UUID().uuidString)"
        let subdirectory = "bookstr-snippet-files-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults, keychain: MemorySecureStore())
        let fileStore = JSONFileStore(subdirectory: subdirectory)
        let progress = ProgressRepository(fileStore: fileStore)
        let vocabulary = VocabularyRepository(fileStore: fileStore)
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nip46 = Nip46Service()
        let service = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: vocabulary,
            snippets: SnippetRepository(fileStore: fileStore),
            favoriteMetadata: favoriteMetadata,
            client: NostrClient(),
            signerStore: SignerStore(nip46Service: nip46),
            nip46Service: nip46,
            snippetPublisher: publisher
        )
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return Context(settings: settings, service: service) {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: support.appendingPathComponent(subdirectory))
        }
    }

    private func configureSigner(_ settings: SettingsRepository) throws -> LocalNsecSigner {
        let keyPair = try KeyPair()
        settings.authMode = .nsec
        let nsec = try keyPair.nsec
        settings.nsec = nsec
        settings.pubkeyHex = keyPair.publicKeyHex
        return LocalNsecSigner(nsec: nsec, publicKeyHex: keyPair.publicKeyHex)
    }

    private func sampleBook(isbn: String? = "9781234567897") -> CatalogBook {
        CatalogBook(
            id: "book-id",
            title: "Book title",
            author: "Book author",
            epubUrl: "https://example.test/book.epub",
            coverUrl: nil,
            sourceUrl: "https://example.test/book",
            isbn: isbn,
            libvaultMd5: nil,
            format: .epub,
            year: "2026"
        )
    }

    private func assertSyncError(
        _ expected: NostrSyncError,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            XCTFail("Expected \(expected)")
        } catch let error as NostrSyncError {
            XCTAssertEqual(error.errorDescription, expected.errorDescription)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

private extension Array {
    var single: Element? { count == 1 ? first : nil }
}
