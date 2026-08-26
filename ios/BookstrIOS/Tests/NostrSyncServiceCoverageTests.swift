import XCTest
import NostrCore
@testable import BookstrIOS

final class NostrSyncServiceCoverageTests: XCTestCase {
    private struct TestContext {
        let settings: SettingsRepository
        let syncService: NostrSyncService
        let defaults: UserDefaults
        let suite: String
    }

    private func makeContext() -> TestContext {
        let suite = "bookstr-sync-service-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let settings = SettingsRepository(defaults: defaults)
        let fileStore = JSONFileStore(subdirectory: "bookstr-sync-service-" + suite)
        let progress = ProgressRepository(fileStore: fileStore)
        let vocabulary = VocabularyRepository(fileStore: fileStore)
        let favoriteMetadata = FavoriteMetadataRepository(fileStore: fileStore)
        let nip46Service = Nip46Service()
        let signerStore = SignerStore(nip46Service: nip46Service)
        let client = NostrClient()
        let service = NostrSyncService(
            settings: settings,
            progress: progress,
            vocabulary: vocabulary,
            favoriteMetadata: favoriteMetadata,
            client: client,
            signerStore: signerStore,
            nip46Service: nip46Service
        )
        return TestContext(settings: settings, syncService: service, defaults: defaults, suite: suite)
    }

    func testCachedFavoritesAndCollectionsReturnEmptyBeforeIdentity() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let empty = context.syncService.cachedFavorites()
        XCTAssertEqual(empty, SharedFavorites())
        XCTAssertTrue(context.syncService.cachedCollections().isEmpty)
    }

    func testPullFavoritesReturnsDebugMessageWhenNoNostrIdentity() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let result = await context.syncService.pullFavorites(seedBooks: [])

        XCTAssertNil(result.error)
        XCTAssertTrue(result.favorites.bookIds.isEmpty)
        XCTAssertTrue(result.debug.contains("stop: no nostr identity"))
    }

    func testPullCollectionsSkipsWhenNoIdentity() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let collections = try await context.syncService.pullCollections()
        XCTAssertTrue(collections.isEmpty)
    }

    func testPushProgressNoSignerIsNoOp() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        await context.syncService.pushProgress(
            book: CatalogBook(
                id: "book-id",
                title: "Book title",
                author: "Author",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            ),
            progression: 0.5,
            cfi: "cfi"
        )
    }

    func testPushVocabularyWordNoSignerReturnsFalse() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let pushed = await context.syncService.pushVocabularyWord(
            VocabularyWord(
                key: "word",
                word: "Hello",
                language: "en",
                syncId: "word-sync-id",
                bookId: "book-id",
                bookTitle: "Book title",
                cfi: "cfi",
                contextSentence: "A sample sentence",
                partOfSpeech: "",
                definitions: [],
                translation: nil,
                sourceUrl: "",
                lookupCount: 1,
                firstSeenAt: 0,
                lastSeenAt: 1_700_000_000_000
            )
        )
        XCTAssertFalse(pushed)
    }

    func testSetFavoriteThrowsWithoutSignerButWithIdentity() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789a"

        do {
            _ = try await context.syncService.setFavorite(
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                favorite: true,
                books: []
            )
            XCTFail("Expected missing signer error")
        } catch {
            let error = error as NSError
            XCTAssertEqual(error.domain, "NostrFavorites")
            XCTAssertEqual(error.code, 1)
        }
    }

    func testSetFavoriteWithNip46ModeWithoutSessionThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = String(repeating: "a", count: 32)

        do {
            _ = try await context.syncService.setFavorite(
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                favorite: true,
                books: []
            )
            XCTFail("Expected nip46 session error")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testSetFavoriteWithNsecAndHugeCachedFavoritesThrowsPayloadTooLarge() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let signer = try KeyPair()
        context.settings.authMode = .nsec
        context.settings.nsec = signer.nsec
        context.settings.pubkeyHex = signer.publicKeyHex

        let veryLong = String(repeating: "x", count: 8_000)
        let cachedFavorites = FavoritesParser.serializeSharedFavoriteTags([
            SharedFavoriteRef(
                libvaultMd5: String(repeating: "a", count: 32),
                title: veryLong,
                addedAt: 1_700_000_000
            )
        ])
        context.settings.cacheNostrFavorites(pubkey: signer.publicKeyHex, plaintext: cachedFavorites)

        do {
            _ = try await context.syncService.setFavorite(
                book: CatalogBook(
                    id: "other-book",
                    title: "Other book",
                    author: "Author",
                    epubUrl: "https://example.org/other.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                favorite: true,
                books: []
            )
            XCTFail("Expected favorites chunk payload too large error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrFavorites")
            XCTAssertEqual(nsError.code, 3)
        }
    }

    func testPullProgressReturnsWithNoPubkey() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        await context.syncService.pullProgress(bookId: "book-id")
    }

    func testPullReadingMetadataReturnsWithoutIdentity() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let merged = await context.syncService.pullReadingMetadata()
        XCTAssertEqual(merged, 0)
    }

    func testPullApplicationDataReturnsZeroWithoutIdentity() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let merged = try await context.syncService.pullApplicationData(force: true)
        XCTAssertEqual(merged.vocabularyMerged, 0)
        XCTAssertEqual(merged.progressMerged, 0)
    }

    func testPullReadingMetadataReturnsZeroWithIdentityButNoRelays() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "aa".repeating(32)
        context.settings.relays = []

        let merged = await context.syncService.pullReadingMetadata()
        XCTAssertEqual(merged, 0)
    }

    func testPullApplicationDataUpdatesLastSyncWhenNoEventsAndNoRelays() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "bb".repeating(32)
        context.settings.relays = []

        XCTAssertNil(context.settings.lastApplicationDataSync)
        let merged = try await context.syncService.pullApplicationData(force: false)
        XCTAssertEqual(merged.vocabularyMerged, 0)
        XCTAssertEqual(merged.progressMerged, 0)
        XCTAssertNotNil(context.settings.lastApplicationDataSync)
    }

    func testPullCollectionsFallsBackToCacheWhenIndexMissingOnInvalidRelay() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "c1", count: 32)
        context.settings.pubkeyHex = pubkey
        context.settings.relays = ["%%%"]

        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: "bookstr-collection-" + String(repeating: "a", count: 32),
                title: "Cached reading",
                description: "",
                updatedAt: 1,
                items: [SharedFavoriteRef(bookstrId: "book-1", title: "Book 1", author: "Author", addedAt: 1)]
            )
        ])
        context.settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)

        let collections = try await context.syncService.pullCollections()

        XCTAssertEqual(collections.count, 1)
        XCTAssertEqual(collections.first?.id, snapshot.collections.first?.id)
    }

    func testPullCollectionsFallsBackToEmptyWhenNoCachedCollectionAndInvalidRelay() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "bb", count: 32)
        context.settings.relays = ["%%%"]

        let collections = try await context.syncService.pullCollections()

        XCTAssertTrue(collections.isEmpty)
    }

    func testRenameCollectionWithNsecModeButNoSignerReturnsCode1() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "f0", count: 32)
        context.settings.pubkeyHex = pubkey
        let collectionID = "bookstr-collection-" + String(repeating: "2", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 10,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)

        do {
            _ = try await context.syncService.renameCollection(collectionID, title: "New name")
            XCTFail("Expected missing signer error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 1)
        }
    }

    func testDeleteCollectionWithNsecModeButNoSignerReturnsCode1() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "f1", count: 32)
        context.settings.pubkeyHex = pubkey
        let collectionID = "bookstr-collection-" + String(repeating: "3", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 10,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)

        do {
            _ = try await context.syncService.deleteCollection(collectionID)
            XCTFail("Expected missing signer error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 1)
        }
    }

    func testMoveCollectionItemWithNsecModeButNoSignerReturnsCode1() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "f2", count: 32)
        context.settings.pubkeyHex = pubkey
        let collectionID = "bookstr-collection-" + String(repeating: "4", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 10,
                items: [SharedFavoriteRef(bookstrId: "book-a", addedAt: 1, title: "Book A")]
            )
        ])
        context.settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)

        do {
            _ = try await context.syncService.moveCollectionItem(collectionID, from: IndexSet(integer: 0), to: 0)
            XCTFail("Expected missing signer error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 1)
        }
    }

    func testSetCollectionMembershipWithNsecModeButNoSignerReturnsCode1() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "f3", count: 32)
        context.settings.pubkeyHex = pubkey
        let collectionID = "bookstr-collection-" + String(repeating: "5", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 10,
                items: [
                    SharedFavoriteRef(bookstrId: "book-a", addedAt: 1),
                    SharedFavoriteRef(bookstrId: "book-b", addedAt: 2)
                ]
            )
        ])
        context.settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)

        do {
            _ = try await context.syncService.setCollectionMembership(
                book: CatalogBook(
                    id: "book-a",
                    title: "Book A",
                    author: "Author",
                    epubUrl: "https://example.org/a.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                collectionID: collectionID,
                included: false
            )
            XCTFail("Expected missing signer error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 1)
        }
    }

    func testRenameCollectionWithHugePayloadRejectedBeforePublish() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let signer = try KeyPair()
        context.settings.authMode = .nsec
        context.settings.nsec = signer.nsec
        context.settings.pubkeyHex = signer.publicKeyHex

        let hugeItems = (0..<250).map { index in
            SharedFavoriteRef(
                bookstrId: "book-\(index)",
                libvaultMd5: String(repeating: "a", count: 32),
                isbn: "978-0-1234-5678-\(index)",
                url: "https://example.org/books/\(index)",
                title: "Very long title \(String(repeating: "x", count: 64)) \(index)",
                author: "Author \(index)",
                year: "2024",
                format: "epub",
                blossomSha256: String(repeating: "b", count: 64),
                blossomUrl: "https://example.org/blossom/\(index)",
                addedAt: 1_700_000_000 + Int64(index)
            )
        }

        let collection = BookCollection(
            id: "bookstr-collection-" + String(repeating: "d", count: 32),
            title: "Reading",
            description: "cache",
            updatedAt: 1,
            items: hugeItems
        )
        context.settings.cacheNostrCollections(pubkey: signer.publicKeyHex, snapshot: CollectionSnapshot(collections: [collection]))

        do {
            _ = try await context.syncService.renameCollection(collection.id, title: "Huge collection")
            XCTFail("Expected oversized payload error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 2)
        }
    }

    func testCachedFavoritesReturnsEnrichedMatchesFromCachedMetadata() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.pubkeyHex = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aa"
        context.settings.cacheNostrFavorites(
            pubkey: context.settings.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["book", "libvault", "0123456789abcdef0123456789abcdef", "0"]
            ])
        )
        let book = CatalogBook(
            id: "local",
            title: "Cached book",
            author: "Cached",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: "0123456789abcdef0123456789abcdef",
            format: .epub,
            blossomSha256: nil,
            year: nil
        )
        let favorites = context.syncService.cachedFavorites(seedBooks: [book])
        XCTAssertTrue(favorites.bookIds.contains("local"))
    }

    func testCachedFavoritesReturnsUnmatchedLegacyExternalFavoriteFromCache() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "ee".repeating(32)
        context.settings.cacheNostrFavorites(
            pubkey: context.settings.pubkeyHex!,
            plaintext: FavoritesParser.serializeTags([
                ["bookstr", "legacy-offline-id", "Legacy title", "Legacy author", "", ""]
            ])
        )
        context.settings.relays = ["%%%"]

        let favorites = context.syncService.cachedFavorites()

        XCTAssertTrue(favorites.bookIds.isEmpty)
        XCTAssertEqual(favorites.external.count, 1)
        XCTAssertEqual(favorites.external.first?.key, "legacy-offline-id")
        XCTAssertEqual(favorites.external.first?.title, "Legacy title")
        XCTAssertEqual(favorites.external.first?.author, "Legacy author")
    }

    func testCachedCollectionsReturnsSnapshotWhenPubkeyExists() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "aa".repeating(32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: "bookstr-collection-" + String(repeating: "b", count: 32),
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        let cached = context.syncService.cachedCollections()
        XCTAssertEqual(cached.count, 1)
        XCTAssertEqual(cached.first?.id, snapshot.collections.first?.id)
    }

    func testCachedCollectionsWithoutSnapshotReturnsEmptyWhenPubkeyExists() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "cc", count: 32)

        XCTAssertTrue(context.syncService.cachedCollections().isEmpty)
    }

    func testCachedCollectionsWithoutPubkeyReturnsEmpty() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        XCTAssertTrue(context.syncService.cachedCollections().isEmpty)
    }

    func testCreateCollectionWithNsecButNoSignerThrowsNostrCollectionsError() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = String(repeating: "2", count: 64)

        do {
            _ = try await context.syncService.createCollection("Reading list")
            XCTFail("Expected missing signer error")
        } catch {
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, "NostrCollections")
            XCTAssertEqual(nsError.code, 1)
            XCTAssertTrue(nsError.localizedDescription.contains("Connect Nostr"))
        }
    }

    func testCreateCollectionWithoutIdentityReturnsExistingCollections() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let collections = try await context.syncService.createCollection("   ")
        XCTAssertTrue(collections.isEmpty)
    }

    func testCreateCollectionWithNip46ButNoSignerThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = String(repeating: "c", count: 64)

        do {
            _ = try await context.syncService.createCollection("Reading List")
            XCTFail("Expected NIP-46 not connected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testSetCollectionMembershipWhenCollectionMissingReturnsCache() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = String(repeating: "d", count: 64)

        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: "bookstr-collection-" + String(repeating: "e", count: 32),
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        let results = try await context.syncService.setCollectionMembership(
            book: CatalogBook(
                id: "book-id",
                title: "Book",
                author: "Author",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            ),
            collectionID: "bookstr-collection-" + String(repeating: "f", count: 32),
            included: true
        )

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.id, snapshot.collections.first?.id)
    }

    func testSetCollectionMembershipWithSignerUnavailableThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = String(repeating: "e", count: 64)
        let collectionID = "bookstr-collection-" + String(repeating: "f", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        do {
            _ = try await context.syncService.setCollectionMembership(
                book: CatalogBook(
                    id: "book-id",
                    title: "Book",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                collectionID: collectionID,
                included: true
            )
            XCTFail("Expected NIP-46 not connected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testDeleteAndRenameAndMoveNoMatchingCollectionAreNoOp() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "bb".repeating(32)
        let expected = CollectionSnapshot(collections: [
            BookCollection(
                id: "bookstr-collection-" + String(repeating: "1", count: 32),
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: expected)

        let missingID = "bookstr-collection-" + String(repeating: "2", count: 32)
        let renames = try await context.syncService.renameCollection(missingID, title: "New Name")
        let deletes = try await context.syncService.deleteCollection(missingID)
        let moved = try await context.syncService.moveCollectionItem(missingID, from: IndexSet(integer: 0), to: 0)

        XCTAssertEqual(renames, expected.collections)
        XCTAssertEqual(deletes, expected.collections)
        XCTAssertEqual(moved, expected.collections)
    }

    func testPullFavoritesUsesCachedFavoritesWhenNoNetworkEvent() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let pubkey = String(repeating: "a1", count: 32)
        context.settings.authMode = .nsec
        context.settings.pubkeyHex = pubkey
        context.settings.relays = ["%%%"]

        let cachedBook = [
            ["book", "bookstr", "cached-book", "1700000000"],
        ]
        context.settings.cacheNostrFavorites(
            pubkey: pubkey,
            plaintext: FavoritesParser.serializeTags(cachedBook)
        )

        let localBook = CatalogBook(
            id: "cached-book",
            title: "Cached",
            author: "Author",
            epubUrl: "https://example.org/book.epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )

        let result = await context.syncService.pullFavorites(seedBooks: [localBook])

        XCTAssertNil(result.error)
        XCTAssertTrue(result.favorites.bookIds.contains("cached-book"))
        XCTAssertTrue(result.debug.contains("using cache: matched=1"))
    }

    func testCachedFavoritesReturnsEmptyForMalformedCachedStorage() {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        let pubkey = String(repeating: "b2", count: 32)
        context.settings.pubkeyHex = pubkey
        context.settings.cacheNostrFavorites(pubkey: pubkey, plaintext: "not-json")

        let favorites = context.syncService.cachedFavorites()

        XCTAssertTrue(favorites.bookIds.isEmpty)
        XCTAssertTrue(favorites.external.isEmpty)
    }

    func testRenameCollectionWithMatchingIDThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = "f1" + String(repeating: "0", count: 62)
        let collectionID = "bookstr-collection-" + String(repeating: "3", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        do {
            _ = try await context.syncService.renameCollection(collectionID, title: "New")
            XCTFail("Expected NIP-46 not connected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testRenameCollectionWithBlankTitleReturnsOriginal() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "aa".repeating(32)
        let collectionID = "bookstr-collection-" + String(repeating: "6", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        let renamed = try await context.syncService.renameCollection(collectionID, title: "   ")

        XCTAssertEqual(renamed.count, 1)
        XCTAssertEqual(renamed.first?.title, "Reading")
    }

    func testDeleteCollectionWithMatchingIDThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = "f2" + String(repeating: "0", count: 62)
        let collectionID = "bookstr-collection-" + String(repeating: "4", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: []
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        do {
            _ = try await context.syncService.deleteCollection(collectionID)
            XCTFail("Expected NIP-46 not connected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testPullApplicationDataSkipsWhenRecentlySynced() async throws {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nsec
        context.settings.pubkeyHex = "bb".repeating(32)
        context.settings.lastApplicationDataSync = Date()

        let merged = try await context.syncService.pullApplicationData(force: false)
        XCTAssertEqual(merged.vocabularyMerged, 0)
        XCTAssertEqual(merged.progressMerged, 0)
    }

    func testMoveCollectionItemWithMatchingIDThrowsNotConnected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .nip46
        context.settings.pubkeyHex = "f3" + String(repeating: "0", count: 62)
        let collectionID = "bookstr-collection-" + String(repeating: "5", count: 32)
        let snapshot = CollectionSnapshot(collections: [
            BookCollection(
                id: collectionID,
                title: "Reading",
                description: "",
                updatedAt: 1,
                items: [
                    SharedFavoriteRef(
                        bookstrId: "book-a",
                        libvaultMd5: nil,
                        isbn: nil,
                        url: nil,
                        title: "Book A",
                        author: "",
                        year: nil,
                        format: nil,
                        blossomSha256: nil,
                        blossomUrl: nil,
                        addedAt: 1_700_000_000
                    )
                ]
            )
        ])
        context.settings.cacheNostrCollections(pubkey: context.settings.pubkeyHex!, snapshot: snapshot)

        do {
            _ = try await context.syncService.moveCollectionItem(collectionID, from: IndexSet(integer: 0), to: 0)
            XCTFail("Expected NIP-46 not connected")
        } catch {
            XCTAssertEqual(error as? Nip46Error, .notConnected)
        }
    }

    func testNormalizedISBNAcceptsValid13And10DigitCodesAndRejectsInvalid() {
        XCTAssertEqual("9781234567897", NostrSyncService.normalizedISBN("978-1-2345-6789-7"))
        XCTAssertEqual("0123456789X", NostrSyncService.normalizedISBN("0 123456789X"))
        XCTAssertNil(NostrSyncService.normalizedISBN("123"))
        XCTAssertNil(NostrSyncService.normalizedISBN("978123456789"))
    }

    func testPublishSnippetRejectsBlankText() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        do {
            _ = try await context.syncService.publishSnippet(
                text: "   ",
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "9781234567897",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                locator: "epubcfi(/6/2)",
                visibility: .privateNote
            )
            XCTFail("Expected empty-snippet rejection")
        } catch {
            XCTAssertEqual(error as? NostrSyncError, .relayRejected)
        }
    }

    func testPublishSnippetRequiresValidIsbnForPublicPost() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let signer = try! KeyPair()
        context.settings.authMode = .nsec
        context.settings.nsec = signer.nsec
        context.settings.pubkeyHex = signer.publicKeyHex
        context.settings.relays = []

        do {
            _ = try await context.syncService.publishSnippet(
                text: "hello",
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "not-an-isbn",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                locator: "epubcfi(/6/2)",
                visibility: .publicPost
            )
            XCTFail("Expected missing-book-identity rejection")
        } catch {
            XCTAssertEqual(error as? NostrSyncError, .missingBookIdentity)
        }
    }

    func testPublishPrivateSnippetWithNoSignerReturnsNoSignerError() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        context.settings.authMode = .none
        context.settings.pubkeyHex = String(repeating: "a", count: 64)

        do {
            _ = try await context.syncService.publishSnippet(
                text: "hello",
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: "9781234567897",
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                locator: "epubcfi(/6/2)",
                visibility: .privateNote
            )
            XCTFail("Expected no signer rejection")
        } catch {
            XCTAssertEqual(error as? NostrSyncError, .noSigner)
        }
    }

    func testPublishPrivateSnippetWithSignerAndNoRelaysReturnsRelayRejected() async {
        let context = makeContext()
        defer { context.defaults.removePersistentDomain(forName: context.suite) }

        let signer = try! KeyPair()
        context.settings.authMode = .nsec
        context.settings.nsec = signer.nsec
        context.settings.pubkeyHex = signer.publicKeyHex
        context.settings.relays = []

        do {
            _ = try await context.syncService.publishSnippet(
                text: "hello",
                book: CatalogBook(
                    id: "book-id",
                    title: "Book title",
                    author: "Author",
                    epubUrl: "https://example.org/book.epub",
                    coverUrl: nil,
                    sourceUrl: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: .epub,
                    blossomSha256: nil,
                    year: nil
                ),
                locator: "epubcfi(/6/2)",
                visibility: .privateNote
            )
            XCTFail("Expected relay rejection")
        } catch {
            XCTAssertEqual(error as? NostrSyncError, .relayRejected)
        }
    }
}
