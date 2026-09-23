import XCTest
import NostrCore
@testable import BookstrIOS

final class FavoriteOutboxTests: XCTestCase {
    private final class SecureStore: SecureStringStore {
        var values: [String: String] = [:]
        @discardableResult
        func set(key: String, value: String?) -> Bool { values[key] = value; return true }
        func get(key: String) -> String? { values[key] }
    }

    private final class Publisher: NostrEventPublishing {
        var accepted = false
        private(set) var events: [NostrEvent] = []

        func publishEvent(_ event: NostrEvent, relays: [String]) async -> Bool {
            events.append(event)
            return accepted
        }
    }

    private struct Context {
        let settings: SettingsRepository
        let service: NostrSyncService
        let defaults: UserDefaults
        let suite: String
    }

    private func makeContext(publisher: Publisher = Publisher()) -> Context {
        let suite = "bookstr-favorite-outbox-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults, keychain: SecureStore())
        let fileStore = JSONFileStore(subdirectory: suite)
        let nip46 = Nip46Service()
        let service = NostrSyncService(
            settings: settings,
            progress: ProgressRepository(fileStore: fileStore),
            vocabulary: VocabularyRepository(fileStore: fileStore),
            snippets: SnippetRepository(fileStore: fileStore),
            favoriteMetadata: FavoriteMetadataRepository(fileStore: fileStore),
            client: NostrClient(),
            signerStore: SignerStore(nip46Service: nip46),
            nip46Service: nip46,
            favoritePublisher: publisher
        )
        return Context(settings: settings, service: service, defaults: defaults, suite: suite)
    }

    private func book(_ id: String = "book-id") -> CatalogBook {
        CatalogBook(
            id: id, title: "Book title", author: "Author", epubUrl: "https://example.org/book.epub",
            coverUrl: nil, sourceUrl: nil, isbn: nil, libvaultMd5: nil, format: .epub,
            year: nil
        )
    }

    func testOutboxRoundTripIsPerIdentityMonotonicAndDoesNotClearNewerSnapshot() {
        let suite = "bookstr-favorite-settings-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = SettingsRepository(defaults: defaults)
        let first = FavoritePendingSnapshot(refs: [], timestamp: 10)
        let second = FavoritePendingSnapshot(refs: [], timestamp: 11)
        settings.saveFavoriteOutbox(pubkey: "ABCD", snapshot: first)
        XCTAssertEqual(settings.favoriteOutbox(pubkey: "abcd"), first)
        settings.saveFavoriteOutbox(pubkey: "abcd", snapshot: second)
        settings.clearFavoriteOutbox(pubkey: "abcd", timestamp: first.timestamp)
        XCTAssertEqual(settings.favoriteOutbox(pubkey: "ABCD"), second)
        settings.clearFavoriteOutbox(pubkey: "abcd", timestamp: second.timestamp)
        XCTAssertNil(settings.favoriteOutbox(pubkey: "abcd"))
        XCTAssertEqual(settings.nextFavoritePublishTimestamp(pubkey: "abcd", wallClock: 100), 100)
        XCTAssertEqual(settings.nextFavoritePublishTimestamp(pubkey: "ABCD", wallClock: 100), 101)
    }

    func testFavoriteIsSavedLocallyWhenSignerIsUnavailable() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "a", count: 64)

        let result = await context.service.updateFavorite(book: book(), favorite: true, books: [book()])

        guard case .savedPending(let message) = result.state else { return XCTFail("Expected pending outbox") }
        XCTAssertTrue(message.contains("Signer"))
        XCTAssertEqual(result.favorites.bookIds, ["book-id"])
        XCTAssertNotNil(context.settings.favoriteOutbox(pubkey: String(repeating: "a", count: 64)))
        XCTAssertNotNil(context.settings.cachedNostrFavorites(pubkey: String(repeating: "a", count: 64)))
    }

    func testCompatibilityFavoriteEntryPointReturnsOptimisticState() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "c", count: 64)

        let favorites = try await context.service.setFavorite(book: book(), favorite: true, books: [book()])

        XCTAssertEqual(favorites.bookIds, ["book-id"])
        XCTAssertNotNil(context.settings.favoriteOutbox(pubkey: String(repeating: "c", count: 64)))
    }

    func testRejectedOutboxRetriesAndClearsOnlyAfterAcceptance() async throws {
        let publisher = Publisher()
        let context = makeContext(publisher: publisher)
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        let keyPair = try KeyPair()
        let nsec = try keyPair.nsec
        context.settings.authMode = .nsec
        context.settings.nsec = nsec
        context.settings.pubkeyHex = keyPair.publicKeyHex

        let pending = await context.service.updateFavorite(book: book(), favorite: true, books: [book()])
        guard case .savedPending = pending.state else { return XCTFail("Expected rejected publish to remain pending") }
        let saved = try XCTUnwrap(context.settings.favoriteOutbox(pubkey: keyPair.publicKeyHex))
        XCTAssertEqual(publisher.events.count, 1)

        publisher.accepted = true
        let retried = await context.service.retryPendingFavorites(seedBooks: [book()])
        let synced = try XCTUnwrap(retried)
        XCTAssertEqual(synced.state, .synced)
        XCTAssertEqual(synced.favorites.bookIds, ["book-id"])
        XCTAssertEqual(publisher.events.count, 2)
        XCTAssertNil(context.settings.favoriteOutbox(pubkey: keyPair.publicKeyHex))
        XCTAssertEqual(context.settings.cachedFavoritesEventId(pubkey: keyPair.publicKeyHex), publisher.events.last?.id)
        XCTAssertGreaterThan(saved.timestamp, 0)
    }

    func testRepeatedTapReplacesRatherThanDuplicatesPendingFavorite() async {
        let publisher = Publisher()
        let context = makeContext(publisher: publisher)
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "b", count: 64)

        _ = await context.service.updateFavorite(book: book(), favorite: true, books: [book()])
        let first = context.settings.favoriteOutbox(pubkey: String(repeating: "b", count: 64))!
        _ = await context.service.updateFavorite(book: book(), favorite: true, books: [book()])
        let second = context.settings.favoriteOutbox(pubkey: String(repeating: "b", count: 64))!

        XCTAssertEqual(second.refs.count, 1)
        XCTAssertEqual(second.refs.first?.bookstrId, "book-id")
        XCTAssertGreaterThan(second.timestamp, first.timestamp)
    }

    @MainActor
    func testNetworkRecoveryOnlySignalsARealTransition() async throws {
        let monitor = FavoriteNetworkRecoveryMonitor(startMonitoring: false)
        monitor.recordConnectivity(true)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(monitor.recoveryToken, 0)
        monitor.recordConnectivity(false)
        monitor.recordConnectivity(true)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(monitor.recoveryToken, 1)
        monitor.recordConnectivity(true)
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(monitor.recoveryToken, 1)
    }

    func testPullReadingMetadataSkipsWhenReadingOrApplicationSyncIsRecent() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "e", count: 64)

        context.settings.lastReadingMetadataSync = Date()
        let skippedByReading = await context.service.pullReadingMetadata()
        XCTAssertEqual(skippedByReading, 0)

        context.settings.lastReadingMetadataSync = nil
        context.settings.lastApplicationDataSync = Date()
        let skippedByApplication = await context.service.pullReadingMetadata()
        XCTAssertEqual(skippedByApplication, 0)
    }

    func testPullReadingMetadataSkipsWithoutIdentity() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        let merged = await context.service.pullReadingMetadata(force: true)
        XCTAssertEqual(merged, 0)
    }

    func testPullApplicationDataSkipsWhenRecentlySynced() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "f", count: 64)
        context.settings.lastApplicationDataSync = Date()

        let merged = try await context.service.pullApplicationData()
        XCTAssertEqual(merged.vocabularyMerged, 0)
        XCTAssertEqual(merged.progressMerged, 0)
        XCTAssertEqual(merged.snippetsMerged, 0)
    }
}
