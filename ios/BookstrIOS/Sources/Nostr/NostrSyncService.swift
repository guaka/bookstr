import Foundation

enum NostrSyncError: LocalizedError {
    case favoriteAuthorMismatch

    var errorDescription: String? {
        switch self {
        case .favoriteAuthorMismatch:
            return "Favorite event has the wrong author"
        }
    }
}

struct FavoritesPullResult {
    var favorites: SharedFavorites
    var debug: String
    var error: String? = nil
}

final class NostrSyncService {
    private let settings: SettingsRepository
    private let progress: ProgressRepository
    private let vocabulary: VocabularyRepository
    private let favoriteMetadata: FavoriteMetadataRepository
    private let client: NostrClient
    private let signerStore: SignerStore
    private let nip46Service: Nip46Service
    private var lastDecryptNote = ""

    init(
        settings: SettingsRepository,
        progress: ProgressRepository,
        vocabulary: VocabularyRepository,
        favoriteMetadata: FavoriteMetadataRepository,
        client: NostrClient,
        signerStore: SignerStore,
        nip46Service: Nip46Service
    ) {
        self.settings = settings
        self.progress = progress
        self.vocabulary = vocabulary
        self.favoriteMetadata = favoriteMetadata
        self.client = client
        self.signerStore = signerStore
        self.nip46Service = nip46Service
    }

    func ensureSignerReady() async {
        if settings.authMode == .nip46 {
            await nip46Service.restore(from: settings)
        }
    }

    func pushProgress(book: CatalogBook, progression: Double, cfi: String) async {
        favoriteMetadata.remember(book: book)
        await ensureSignerReady()
        guard let signer = signerStore.signer(from: settings) else { return }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let content = NostrClient.progressContent(
            bookId: book.id,
            progression: progression,
            cfi: cfi,
            title: book.title,
            author: book.author,
            updatedAt: now,
            rights: book.rights
        )
        var event = NostrEvent(
            id: nil,
            pubkey: signer.publicKeyHex,
            createdAt: now / 1000,
            kind: NostrKinds.progress,
            tags: [["d", NostrKinds.progressDTag(bookId: book.id)]],
            content: content,
            sig: nil
        )
        guard let signed = try? await signer.sign(event) else {
            return
        }
        _ = await client.publishEvent(signed, relays: settings.relays)
    }

    @discardableResult
    func pushVocabularyWord(_ word: VocabularyWord) async -> Bool {
        await ensureSignerReady()
        guard let pubkey = settings.pubkeyHex,
              let signer = signerStore.signer(from: settings),
              let plaintextData = try? JSONEncoder().encode(word),
              let plaintext = String(data: plaintextData, encoding: .utf8),
              let content = try? await signer.nip44Encrypt(plaintext, to: pubkey)
        else { return false }
        let event = NostrEvent(
            id: nil,
            pubkey: signer.publicKeyHex,
            createdAt: word.lastSeenAt / 1000,
            kind: NostrKinds.progress,
            tags: [["d", NostrKinds.vocabularyPrefix + word.syncId]],
            content: content,
            sig: nil
        )
        guard let signed = try? await signer.sign(event) else { return false }
        return await client.publishEvent(signed, relays: settings.relays)
    }

    func pullProgress(bookId: String) async {
        guard let pubkey = settings.pubkeyHex else { return }
        guard let event = await client.fetchLatestProgress(pubkey: pubkey, bookId: bookId, relays: settings.relays) else { return }
        guard let parsed = NostrClient.parseProgressContent(event.content, fallbackBookId: bookId) else { return }
        progress.mergeRemote(
            bookId: parsed.bookId,
            progression: parsed.progression,
            cfi: parsed.cfi,
            updatedAt: parsed.updatedAt ?? event.createdAt * 1000
        )
        favoriteMetadata.rememberProgress(bookId: parsed.bookId, title: parsed.title, author: parsed.author,
                                          updatedAt: parsed.updatedAt ?? event.createdAt * 1000,
                                          rights: NostrClient.parseProgressRights(event.content))
    }

    /// Refreshes the same descriptive cache the web app builds from reading
    /// events, without decrypting vocabulary records or contacting LibVault.
    @discardableResult
    func pullReadingMetadata() async -> Int {
        guard let pubkey = settings.pubkeyHex, settings.hasNostrIdentity else { return 0 }
        let events = await client.fetchApplicationData(pubkey: pubkey, relays: settings.relays)
        var merged = 0
        for event in events {
            guard let dTag = event.dTag, dTag.hasPrefix("app.bookstr.progress.") else { continue }
            let fallback = String(dTag.dropFirst("app.bookstr.progress.".count))
            guard let parsed = NostrClient.parseProgressContent(event.content, fallbackBookId: fallback) else { continue }
            progress.mergeRemote(
                bookId: parsed.bookId,
                progression: parsed.progression,
                cfi: parsed.cfi,
                updatedAt: parsed.updatedAt ?? event.createdAt * 1000
            )
            favoriteMetadata.rememberProgress(
                bookId: parsed.bookId, title: parsed.title, author: parsed.author,
                updatedAt: parsed.updatedAt ?? event.createdAt * 1000,
                rights: NostrClient.parseProgressRights(event.content)
            )
            if parsed.title?.isEmpty == false { merged += 1 }
        }
        return merged
    }

    func cachedFavorites(seedBooks: [CatalogBook] = []) -> SharedFavorites {
        guard let pubkey = settings.pubkeyHex,
              let cached = settings.cachedNostrFavorites(pubkey: pubkey)
        else { return SharedFavorites() }
        return FavoritesParser.matchSharedFavorites(
            refs: favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(cached)),
            books: seedBooks
        )
    }

    func setFavorite(book: CatalogBook, favorite: Bool, books: [CatalogBook]) async throws -> SharedFavorites {
        favoriteMetadata.remember(book: book)
        await ensureSignerReady()
        guard let pubkey = settings.pubkeyHex, let signer = signerStore.signer(from: settings) else {
            throw NSError(domain: "NostrFavorites", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Connect a NIP-46 signer to edit favorites"])
        }
        var plaintext = settings.cachedNostrFavorites(pubkey: pubkey)
        if plaintext == nil {
            _ = await pullFavorites(seedBooks: books)
            plaintext = settings.cachedNostrFavorites(pubkey: pubkey)
        }
        var refs = favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(plaintext ?? "[]"))
        let present = refs.contains { FavoritesParser.matches($0, book: book) }
        if favorite, !present {
            refs.append(
                SharedFavoriteRef(
                    bookstrId: book.id,
                    libvaultMd5: book.libvaultMd5,
                    isbn: book.isbn,
                    url: book.sourceUrl ?? book.epubUrl,
                    title: book.title,
                    author: book.author,
                    year: book.year,
                    format: book.format.rawValue,
                    blossomSha256: book.blossomSha256,
                    blossomUrl: book.blossomSha256 == nil ? nil : book.epubUrl,
                    addedAt: Int64(Date().timeIntervalSince1970)
                )
            )
        } else if !favorite, present {
            refs.removeAll { FavoritesParser.matches($0, book: book) }
        }

        let now = Int64(Date().timeIntervalSince1970)
        let relays = Array(Set(settings.relays + [NostrClient.defaultInteropRelay]))

        func publishEncrypted(dTag: String, privateTags: [[String]]) async throws -> NostrEvent {
            let plaintext = FavoritesParser.serializeTags(privateTags)
            guard plaintext.count <= FavoritesParser.maxChunkPlaintextChars else {
                throw NSError(domain: "NostrFavorites", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "One favorite reference is too large to encrypt safely"])
            }
            let ciphertext = try await signer.nip44Encrypt(plaintext, to: pubkey)
            let unsigned = NostrEvent(
                id: nil,
                pubkey: pubkey,
                createdAt: now,
                kind: NostrKinds.favorites,
                tags: [["d", dTag]],
                content: ciphertext,
                sig: nil
            )
            let signed = try await signer.sign(unsigned)
            guard await client.publishEvent(signed, relays: relays) else {
                throw NSError(domain: "NostrFavorites", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "Relays did not accept the updated favorites"])
            }
            return signed
        }

        let header = [
            ["bookstr-collection", "2"],
            ["title", "Favorites"],
            ["updated", String(now)],
        ]
        let itemTags = FavoritesParser.compactItemTags(refs: refs, fallbackAddedAt: now)
        let completeTags = header + itemTags
        let completePlaintext = FavoritesParser.serializeTags(completeTags)
        let root: NostrEvent
        if completePlaintext.count <= FavoritesParser.maxChunkPlaintextChars {
            root = try await publishEncrypted(dTag: NostrKinds.favoritesDTag, privateTags: completeTags)
        } else {
            let chunks = FavoritesParser.splitItemTags(itemTags)
            let generation = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            let prefix = "\(NostrKinds.collectionChunkPrefix)-\(generation)"
            for (index, chunk) in chunks.enumerated() {
                _ = try await publishEncrypted(dTag: "\(prefix)-\(index)", privateTags: chunk)
            }
            root = try await publishEncrypted(
                dTag: NostrKinds.favoritesDTag,
                privateTags: header + [["bookstr-chunks", String(chunks.count), prefix]]
            )
        }
        settings.cacheNostrFavorites(pubkey: pubkey, plaintext: completePlaintext, eventId: root.id)
        return FavoritesParser.matchSharedFavorites(refs: refs, books: books)
    }

    func cachedCollections() -> [BookCollection] {
        guard let pubkey = settings.pubkeyHex else { return [] }
        return settings.cachedNostrCollections(pubkey: pubkey).collections
    }

    func pullCollections() async throws -> [BookCollection] {
        await ensureSignerReady()
        guard let pubkey = settings.pubkeyHex, settings.hasNostrIdentity else { return [] }
        let relays = Array(Set(settings.relays + [NostrClient.defaultInteropRelay]))
        guard let indexEvent = await client.fetchReplaceable(
            pubkey: pubkey,
            kind: NostrKinds.favorites,
            dTag: NostrKinds.collectionIndexDTag,
            relays: relays
        ) else { return settings.cachedNostrCollections(pubkey: pubkey).collections }
        guard settings.authMode != .nip46 || indexEvent.content.count <= FavoritesParser.maxRemoteDecryptChars else {
            throw Nip46Error.payloadTooLarge(indexEvent.content.count)
        }
        let indexPlaintext = try await decryptFromSelf(pubkey: pubkey, ciphertext: indexEvent.content)
        let directory = FavoritesParser.parseCollectionIndex(indexPlaintext)
        var collections: [BookCollection] = []
        for entry in directory.entries {
            guard let event = await client.fetchReplaceable(
                pubkey: pubkey,
                kind: NostrKinds.favorites,
                dTag: entry.id,
                relays: relays
            ) else {
                throw NSError(domain: "NostrCollections", code: 10,
                              userInfo: [NSLocalizedDescriptionKey: "Collection \(entry.title) is incomplete on the relays"])
            }
            let plaintext = try await decryptFavoritesContent(event: event, pubkey: pubkey, line: { _ in })
            guard let collection = FavoritesParser.parseCollection(
                plaintext,
                id: entry.id,
                fallbackTitle: entry.title,
                fallbackUpdatedAt: entry.updatedAt
            ) else {
                throw NSError(domain: "NostrCollections", code: 11,
                              userInfo: [NSLocalizedDescriptionKey: "Collection \(entry.title) is invalid"])
            }
            collections.append(collection)
        }
        let snapshot = CollectionSnapshot(collections: collections, tombstones: directory.tombstones)
        settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)
        return collections
    }

    func createCollection(title: String) async throws -> [BookCollection] {
        let normalized = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !normalized.isEmpty else { return cachedCollections() }
        let now = Int64(Date().timeIntervalSince1970)
        let random = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        var snapshot = collectionSnapshot()
        let collection = BookCollection(
            id: "bookstr-collection-\(random)",
            title: normalized,
            description: "",
            updatedAt: now,
            items: []
        )
        snapshot.collections.append(collection)
        try await publishCollection(collection)
        try await publishCollectionIndex(snapshot)
        cacheCollectionSnapshot(snapshot)
        return snapshot.collections
    }

    func setCollectionMembership(book: CatalogBook, collectionID: String, included: Bool) async throws -> [BookCollection] {
        var snapshot = collectionSnapshot()
        guard let index = snapshot.collections.firstIndex(where: { $0.id == collectionID }) else { return snapshot.collections }
        let now = Int64(Date().timeIntervalSince1970)
        let present = snapshot.collections[index].items.contains { FavoritesParser.matches($0, book: book) }
        if included, !present {
            snapshot.collections[index].items.append(favoriteRef(book: book, addedAt: now))
        } else if !included, present {
            snapshot.collections[index].items.removeAll { FavoritesParser.matches($0, book: book) }
        }
        snapshot.collections[index].updatedAt = now
        try await publishCollection(snapshot.collections[index])
        try await publishCollectionIndex(snapshot)
        cacheCollectionSnapshot(snapshot)
        return snapshot.collections
    }

    func renameCollection(_ id: String, title: String) async throws -> [BookCollection] {
        let normalized = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        var snapshot = collectionSnapshot()
        guard !normalized.isEmpty, let index = snapshot.collections.firstIndex(where: { $0.id == id }) else {
            return snapshot.collections
        }
        snapshot.collections[index].title = normalized
        snapshot.collections[index].updatedAt = Int64(Date().timeIntervalSince1970)
        try await publishCollection(snapshot.collections[index])
        try await publishCollectionIndex(snapshot)
        cacheCollectionSnapshot(snapshot)
        return snapshot.collections
    }

    func deleteCollection(_ id: String) async throws -> [BookCollection] {
        var snapshot = collectionSnapshot()
        guard snapshot.collections.contains(where: { $0.id == id }) else { return snapshot.collections }
        snapshot.collections.removeAll { $0.id == id }
        snapshot.tombstones.removeAll { $0.id == id }
        snapshot.tombstones.append(CollectionTombstone(id: id, deletedAt: Int64(Date().timeIntervalSince1970)))
        try await publishCollectionIndex(snapshot)
        cacheCollectionSnapshot(snapshot)
        return snapshot.collections
    }

    func moveCollectionItem(_ id: String, from offsets: IndexSet, to destination: Int) async throws -> [BookCollection] {
        var snapshot = collectionSnapshot()
        guard let index = snapshot.collections.firstIndex(where: { $0.id == id }) else { return snapshot.collections }
        snapshot.collections[index].items.move(fromOffsets: offsets, toOffset: destination)
        snapshot.collections[index].updatedAt = Int64(Date().timeIntervalSince1970)
        try await publishCollection(snapshot.collections[index])
        try await publishCollectionIndex(snapshot)
        cacheCollectionSnapshot(snapshot)
        return snapshot.collections
    }

    private func favoriteRef(book: CatalogBook, addedAt: Int64) -> SharedFavoriteRef {
        SharedFavoriteRef(
            bookstrId: book.id,
            libvaultMd5: book.libvaultMd5,
            isbn: book.isbn,
            url: book.sourceUrl ?? book.epubUrl,
            title: book.title,
            author: book.author,
            year: book.year,
            format: book.format.rawValue,
            blossomSha256: book.blossomSha256,
            blossomUrl: book.blossomSha256 == nil ? nil : book.epubUrl,
            addedAt: addedAt
        )
    }

    private func collectionSnapshot() -> CollectionSnapshot {
        guard let pubkey = settings.pubkeyHex else { return CollectionSnapshot() }
        return settings.cachedNostrCollections(pubkey: pubkey)
    }

    private func cacheCollectionSnapshot(_ snapshot: CollectionSnapshot) {
        guard let pubkey = settings.pubkeyHex else { return }
        settings.cacheNostrCollections(pubkey: pubkey, snapshot: snapshot)
    }

    private func publishCollectionIndex(_ snapshot: CollectionSnapshot) async throws {
        _ = try await publishPrivateTags(
            dTag: NostrKinds.collectionIndexDTag,
            tags: FavoritesParser.collectionIndexTags(snapshot)
        )
    }

    private func publishCollection(_ collection: BookCollection) async throws {
        let tags = FavoritesParser.collectionTags(collection)
        let header = tags.filter { $0.first != "book" }
        let items = tags.filter { $0.first == "book" }
        if FavoritesParser.serializeTags(tags).count <= FavoritesParser.maxChunkPlaintextChars {
            _ = try await publishPrivateTags(dTag: collection.id, tags: tags)
            return
        }
        let chunks = FavoritesParser.splitItemTags(items)
        let generation = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        let prefix = "\(NostrKinds.collectionChunkPrefix)-\(generation)"
        for (index, chunk) in chunks.enumerated() {
            _ = try await publishPrivateTags(dTag: "\(prefix)-\(index)", tags: chunk)
        }
        _ = try await publishPrivateTags(
            dTag: collection.id,
            tags: header + [["bookstr-chunks", String(chunks.count), prefix]]
        )
    }

    private func publishPrivateTags(dTag: String, tags: [[String]]) async throws -> NostrEvent {
        await ensureSignerReady()
        guard let pubkey = settings.pubkeyHex, let signer = signerStore.signer(from: settings) else {
            throw NSError(domain: "NostrCollections", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Connect Nostr to edit lists"])
        }
        let plaintext = FavoritesParser.serializeTags(tags)
        guard plaintext.count <= FavoritesParser.maxChunkPlaintextChars else {
            throw NSError(domain: "NostrCollections", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "One list entry is too large for the signer"])
        }
        let now = Int64(Date().timeIntervalSince1970)
        let ciphertext = try await signer.nip44Encrypt(plaintext, to: pubkey)
        let unsigned = NostrEvent(id: nil, pubkey: pubkey, createdAt: now, kind: NostrKinds.favorites,
                                  tags: [["d", dTag]], content: ciphertext, sig: nil)
        let signed = try await signer.sign(unsigned)
        let relays = Array(Set(settings.relays + [NostrClient.defaultInteropRelay]))
        guard await client.publishEvent(signed, relays: relays) else {
            throw NSError(domain: "NostrCollections", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Relays did not accept the updated list"])
        }
        return signed
    }

    func pullFavorites(seedBooks: [CatalogBook]) async -> FavoritesPullResult {
        var log: [String] = []
        func line(_ text: String) { log.append(text) }

        await ensureSignerReady()
        let auth = settings.authMode.rawValue
        let pubkey = settings.pubkeyHex
        line("auth: \(auth)")
        line("hasIdentity: \(settings.hasNostrIdentity)")
        line("pubkey: \(pubkey ?? "(none)")")
        if let pubkey, let npub = NostrIdentity.npub(fromHex: pubkey) {
            line("npub: \(npub)")
        }
        line("relays: \(settings.relays.joined(separator: ", "))")
        line("seed catalog: \(seedBooks.count)")
        line("signer wrapper: \(signerStore.signer(from: settings) == nil ? "missing" : "ready")")
        line("nip46 live session: \(await nip46Service.hasLiveSigner())")
        line("nip46 restore: \(await nip46Service.restoreStatus())")
        line("nip46 secret: \((settings.nip46ClientSecret ?? "").isEmpty ? "missing" : "present")")
        line("nip46 bunker: \(settings.nip46BunkerURL ?? "missing")")

        guard let pubkey, settings.hasNostrIdentity else {
            line("stop: no nostr identity")
            return FavoritesPullResult(favorites: SharedFavorites(), debug: log.joined(separator: "\n"))
        }

        if let cached = settings.cachedNostrFavorites(pubkey: pubkey) {
            let refs = favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(cached))
            line("cached plaintext: \(cached.count) chars, \(refs.count) refs")
        } else {
            line("cached plaintext: none")
        }

        let query = await client.fetchLatestFavorites(pubkey: pubkey, relays: settings.relays)
        line("fallback untagged query: \(query.fallbackUsed)")
        for report in query.reports {
            let tags = report.dTags.isEmpty ? "-" : report.dTags.joined(separator: ",")
            var row = "  \(report.relay): \(report.events.count) events, \(report.finished), \(report.elapsedMs)ms, d=[\(tags)]"
            if !report.notices.isEmpty {
                row += ", notice=\(report.notices.joined(separator: " | "))"
            }
            if let error = report.error {
                row += ", error=\(error)"
            }
            line(row)
        }

        guard let event = query.event else {
            line("event: none")
            if let cached = settings.cachedNostrFavorites(pubkey: pubkey) {
                let parsed = FavoritesParser.matchSharedFavorites(
                    refs: favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(cached)),
                    books: seedBooks
                )
                line("using cache: matched=\(parsed.bookIds.count) external=\(parsed.external.count)")
                return FavoritesPullResult(favorites: parsed, debug: log.joined(separator: "\n"))
            }
            line("result: empty")
            return FavoritesPullResult(favorites: SharedFavorites(), debug: log.joined(separator: "\n"))
        }

        line("event id: \(event.id ?? "(none)")")
        line("event kind: \(event.kind)")
        line("event created_at: \(event.createdAt)")
        line("event pubkey: \(event.pubkey ?? "(none)")")
        line("event d: \(event.dTag ?? "(none)")")
        line("event content: \(event.content.count) chars")
        if let eventId = event.id, eventId == settings.cachedFavoritesEventId(pubkey: pubkey),
           let cached = settings.cachedNostrFavorites(pubkey: pubkey) {
            let refs = favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(cached))
            line("decrypt: skipped, cached event \(eventId)")
            line("cached refs: \(refs.count)")
            let matched = FavoritesParser.matchSharedFavorites(refs: refs, books: seedBooks)
            line("matched catalog ids: \(matched.bookIds.count)")
            line("external: \(matched.external.count)")
            return FavoritesPullResult(favorites: matched, debug: log.joined(separator: "\n"))
        }
        if let author = event.pubkey, author.lowercased() != pubkey.lowercased() {
            line("stop: author mismatch")
            return FavoritesPullResult(
                favorites: SharedFavorites(),
                debug: log.joined(separator: "\n"),
                error: NostrSyncError.favoriteAuthorMismatch.localizedDescription
            )
        }

        do {
            let plaintext = try await decryptFavoritesContent(event: event, pubkey: pubkey, line: line)
            settings.cacheNostrFavorites(pubkey: pubkey, plaintext: plaintext, eventId: event.id)
            let rawRefs = FavoritesParser.parseSharedFavoriteTags(plaintext)
            rawRefs.forEach { favoriteMetadata.remember($0, updatedAt: event.createdAt * 1000) }
            let refs = favoriteMetadata.enrich(rawRefs)
            line("decrypt: \(lastDecryptNote)")
            line("decrypt: ok, \(plaintext.count) chars, \(refs.count) refs")
            line("plaintext: \(Self.preview(plaintext))")
            for ref in refs.prefix(12) {
                let title = ref.title ?? "(no title)"
                let md5 = ref.libvaultMd5 ?? "-"
                let sha = ref.blossomSha256.map { String($0.prefix(8)) } ?? "-"
                line("  ref \(title) md5=\(md5) blossom=\(sha) fmt=\(ref.format ?? "-")")
            }
            if refs.count > 12 {
                line("  … \(refs.count - 12) more")
            }
            let matched = FavoritesParser.matchSharedFavorites(refs: refs, books: seedBooks)
            line("matched catalog ids: \(matched.bookIds.count)")
            line("external: \(matched.external.count)")
            return FavoritesPullResult(favorites: matched, debug: log.joined(separator: "\n"))
        } catch {
            line("decrypt: \(lastDecryptNote)")
            line("decrypt: FAIL \(error.localizedDescription)")
            if settings.authMode == .nip46 {
                await nip46Service.reconnect(from: settings)
                line("nip46: reconnected after decrypt fail")
            }
            if let cached = settings.cachedNostrFavorites(pubkey: pubkey) {
                let parsed = FavoritesParser.matchSharedFavorites(
                    refs: favoriteMetadata.enrich(FavoritesParser.parseSharedFavoriteTags(cached)),
                    books: seedBooks
                )
                line("using cache after decrypt fail: matched=\(parsed.bookIds.count) external=\(parsed.external.count)")
                return FavoritesPullResult(
                    favorites: parsed,
                    debug: log.joined(separator: "\n"),
                    error: "Decrypt: \(error.localizedDescription)"
                )
            }
            return FavoritesPullResult(
                favorites: SharedFavorites(),
                debug: log.joined(separator: "\n"),
                error: "Decrypt: \(error.localizedDescription)"
            )
        }
    }

    private static func preview(_ text: String) -> String {
        let collapsed = text.replacingOccurrences(of: "\n", with: " ")
        if collapsed.count <= 240 { return collapsed }
        return String(collapsed.prefix(240)) + "…"
    }

    private func decryptFavoritesContent(event: NostrEvent, pubkey: String, line: (String) -> Void) async throws -> String {
        if settings.authMode == .nip46, event.content.count > FavoritesParser.maxRemoteDecryptChars {
            line("decrypt: skipped, \(event.content.count) chars exceeds Amber NIP-46 limit \(FavoritesParser.maxRemoteDecryptChars)")
            throw Nip46Error.payloadTooLarge(event.content.count)
        }
        line("decrypt: sending \(event.content.count) chars to Amber (timeout \(Int(Nip46Service.requestTimeout))s)")
        let plaintext = try await decryptFromSelf(pubkey: pubkey, ciphertext: event.content)
        guard let manifest = FavoritesParser.chunkManifest(from: plaintext) else {
            return plaintext
        }
        guard let rootData = plaintext.data(using: .utf8),
              let rootTags = try? JSONSerialization.jsonObject(with: rootData) as? [Any] else {
            throw NSError(domain: "NostrFavorites", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Favorite root is invalid"])
        }
        line("chunks: \(manifest.count) prefix=\(manifest.prefix)")
        var tags = rootTags.filter { item in
            guard let values = item as? [Any], let name = values.first as? String else { return true }
            return name != "bookstr-chunks" && name != "libvault-chunks"
        }
        for index in 0..<manifest.count {
            let dTag = NostrKinds.favoritesChunkDTag(prefix: manifest.prefix, index: index)
            guard let chunkEvent = await client.fetchReplaceable(
                pubkey: pubkey,
                kind: NostrKinds.favorites,
                dTag: dTag,
                relays: settings.relays
            ) else {
                line("chunk \(index): missing")
                throw NSError(domain: "NostrFavorites", code: 5,
                              userInfo: [NSLocalizedDescriptionKey: "Favorite update is incomplete: chunk \(index + 1) of \(manifest.count) is missing"])
            }
            if settings.authMode == .nip46, chunkEvent.content.count > FavoritesParser.maxRemoteDecryptChars {
                line("chunk \(index): skipped, \(chunkEvent.content.count) chars too large for Amber")
                throw Nip46Error.payloadTooLarge(chunkEvent.content.count)
            }
            line("chunk \(index): \(chunkEvent.content.count) chars")
            let chunkPlain = try await decryptFromSelf(pubkey: pubkey, ciphertext: chunkEvent.content)
            guard let data = chunkPlain.data(using: .utf8),
                  let array = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
                throw NSError(domain: "NostrFavorites", code: 6,
                              userInfo: [NSLocalizedDescriptionKey: "Favorite chunk \(index + 1) is invalid"])
            }
            tags.append(contentsOf: array)
        }
        let merged = (try? JSONSerialization.data(withJSONObject: tags)).flatMap { String(data: $0, encoding: .utf8) }
        return merged ?? plaintext
    }

    @discardableResult
    func pullVocabulary(force: Bool = false) async throws -> Int {
        try await pullApplicationData(force: force).vocabularyMerged
    }

    @discardableResult
    func pullApplicationData(force: Bool = false) async throws -> (vocabularyMerged: Int, progressMerged: Int) {
        await ensureSignerReady()
        guard let pubkey = settings.pubkeyHex, settings.hasNostrIdentity else {
            return (0, 0)
        }
        if !force, let last = settings.lastApplicationDataSync, Date().timeIntervalSince(last) < 120 {
            return (0, 0)
        }
        let events = await client.fetchApplicationData(pubkey: pubkey, relays: settings.relays)
        var vocabularyMerged = 0
        var progressMerged = 0
        for event in events {
            guard let dTag = event.dTag else { continue }
            if dTag.hasPrefix(NostrKinds.vocabularyPrefix) {
                let syncId = String(dTag.dropFirst(NostrKinds.vocabularyPrefix.count))
                if let local = vocabulary.word(syncId: syncId), local.lastSeenAt >= event.createdAt * 1000 {
                    continue
                }
                guard let plaintext = try? await decryptFromSelf(pubkey: pubkey, ciphertext: event.content),
                      let data = plaintext.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let word = VocabularyRepository.parseRemote(json)
                else { continue }
                if vocabulary.mergeRemote(word) {
                    vocabularyMerged += 1
                }
            } else if dTag.hasPrefix("app.bookstr.progress.") {
                let bookId = String(dTag.dropFirst("app.bookstr.progress.".count))
                guard let parsed = NostrClient.parseProgressContent(event.content, fallbackBookId: bookId) else { continue }
                favoriteMetadata.rememberProgress(
                    bookId: parsed.bookId, title: parsed.title, author: parsed.author,
                    updatedAt: parsed.updatedAt ?? event.createdAt * 1000,
                    rights: NostrClient.parseProgressRights(event.content)
                )
                if progress.mergeRemote(
                    bookId: parsed.bookId,
                    progression: parsed.progression,
                    cfi: parsed.cfi,
                    updatedAt: parsed.updatedAt ?? event.createdAt * 1000
                ) {
                    progressMerged += 1
                }
            }
        }
        if vocabularyMerged > 0 {
            vocabulary.persist()
            await MainActor.run {
                NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
            }
        }
        settings.lastApplicationDataSync = Date()
        return (vocabularyMerged, progressMerged)
    }

    private func decryptFromSelf(pubkey: String, ciphertext: String) async throws -> String {
        do {
            let plaintext = try await decryptOnce(pubkey: pubkey, ciphertext: ciphertext)
            lastDecryptNote = "ok (\(ciphertext.count) chars)"
            return plaintext
        } catch {
            lastDecryptNote = "FAIL \(error.localizedDescription) (\(ciphertext.count) chars)"
            throw mappedDecryptError(error)
        }
    }

    private func decryptOnce(pubkey: String, ciphertext: String) async throws -> String {
        guard let signer = signerStore.signer(from: settings) else {
            throw Nip46Error.notConnected
        }
        return try await signer.nip44Decrypt(ciphertext, from: pubkey)
    }

    private func mappedDecryptError(_ error: Error) -> Error {
        let text = error.localizedDescription
        if text.localizedCaseInsensitiveContains("did not respond in time") {
            return Nip46Error.timedOut
        }
        return error
    }
}
