import XCTest
@testable import BookstrIOS

final class CatalogRepositoryDownloadedCoverageTests: XCTestCase {
    private func withRepository(_ test: (JSONFileStore, CatalogRepository) -> Void) {
        let subdirectory = "bookstr-test-" + UUID().uuidString
        let store = JSONFileStore(subdirectory: subdirectory)
        let settings = SettingsRepository(defaults: UserDefaults(suiteName: "bookstr-tests-" + UUID().uuidString)!)
        let signerStore = SignerStore(nip46Service: Nip46Service())
        let repository = CatalogRepository(
            fileStore: store,
            settings: settings,
            signerStore: signerStore,
            nip46Service: Nip46Service()
        )

        test(store, repository)
    }

    func testDownloadedBooksReusesRememberedMetadataAndUpdatesFormatToMatchFile() {
        withRepository { store, repository in
            let bookId = "BOOK-REMEMBERED"
            let rememberedBook = CatalogBook(
                id: bookId,
                title: "Remembered title",
                author: "Remembered author",
                epubUrl: "https://books-api.guaka.org/download/legacy.epub",
                coverUrl: nil,
                sourceUrl: "https://books-api.guaka.org/download/legacy.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )
            store.save("downloaded-books.json", value: [rememberedBook])

            let epubFile = store.bookFileURL(bookId: bookId, format: .epub)
            FileManager.default.createFile(atPath: epubFile.path, contents: Data("epub bytes".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(bookId.lowercased(), books[0].id)
            XCTAssertEqual(.epub, books[0].format)
            XCTAssertEqual("Remembered title", books[0].title)
        }
    }

    func testDownloadedBooksBuildsFromExternalFavoriteWhenThereIsNoRememberedEntry() {
        withRepository { store, repository in
            let favoriteHash = "a".repeating(64)
            let file = store.bookFileURL(bookId: favoriteHash, format: .pdf)
            FileManager.default.createFile(atPath: file.path, contents: Data("pdf bytes".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "legacy-key",
                    title: "Remote favorite title",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "pdf",
                    blossomSha256: favoriteHash,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(favoriteHash, books[0].id)
            XCTAssertEqual("Remote favorite title", books[0].title)
            XCTAssertEqual(.pdf, books[0].format)
            XCTAssertEqual("Unknown", books[0].author)
        }
    }

    func testDownloadedBooksFallsBackToDownloadedMetadataWhenNoMetadataExists() {
        withRepository { store, repository in
            let fallbackId = "b".repeating(64)
            let fallback = store.bookFileURL(bookId: fallbackId, format: .epub)
            FileManager.default.createFile(atPath: fallback.path, contents: Data("legacy bytes".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(fallbackId, books[0].id)
            XCTAssertEqual("Downloaded EPUB", books[0].title)
            XCTAssertEqual("Unknown", books[0].author)
            XCTAssertEqual(.epub, books[0].format)
        }
    }

    func testDownloadedBooksSkipsInvalidSHA256IdentifiersFromUnknownFiles() {
        withRepository { store, repository in
            let invalidId = "not-hex-id"
            let validId = "c".repeating(64)
            let invalidFile = store.bookFileURL(bookId: invalidId, format: .pdf)
            let validFile = store.bookFileURL(bookId: validId, format: .epub)
            FileManager.default.createFile(atPath: invalidFile.path, contents: Data("ignored bytes".utf8))
            FileManager.default.createFile(atPath: validFile.path, contents: Data("valid bytes".utf8))

            let books = repository.downloadedBooks()
            XCTAssertEqual(1, books.count)
            XCTAssertEqual(validId, books[0].id)
        }
    }

    func testDownloadedBooksSortsByTitleBeforeReturningLibraryResults() {
        withRepository { store, repository in
            let first = CatalogBook(
                id: "c".repeating(64),
                title: "Zulu",
                author: "Alice",
                epubUrl: "https://example.org/zulu",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )
            let second = CatalogBook(
                id: "a".repeating(64),
                title: "Alpha",
                author: "Bob",
                epubUrl: "https://example.org/alpha",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )
            store.save("downloaded-books.json", value: [first, second])
            FileManager.default.createFile(atPath: store.bookFileURL(bookId: first.id, format: .epub).path, contents: Data("z".utf8))
            FileManager.default.createFile(atPath: store.bookFileURL(bookId: second.id, format: .pdf).path, contents: Data("a".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(["Alpha", "Zulu"], books.map(\.title))
            XCTAssertEqual(Set([first.id.lowercased(), second.id.lowercased()]), Set(books.map(\.id)))
        }
    }

    func testDownloadedBooksIgnoresUnsupportedFileExtensions() {
        withRepository { store, repository in
            let base = store.bookFileURL(bookId: "d".repeating(64), format: .epub).deletingPathExtension()
            let unsupported = base.appendingPathExtension("txt")
            FileManager.default.createFile(atPath: unsupported.path, contents: Data("ignore".utf8))

            let books = repository.downloadedBooks()
            XCTAssertTrue(books.isEmpty)
        }
    }

    func testDownloadedBooksSkipsRememberedMetadataWithoutLocalFiles() {
        withRepository { store, repository in
            let staleId = "d".repeating(64)
            let staleBook = CatalogBook(
                id: staleId,
                title: "Stale remembered",
                author: "Cached Author",
                epubUrl: "https://books-api.guaka.org/download/legacy.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )
            store.save("downloaded-books.json", value: [staleBook])

            let books = repository.downloadedBooks()
            XCTAssertTrue(books.isEmpty)
        }
    }

    func testDownloadedBooksNormalizesUppercaseFileIdentityFromExistingFiles() {
        withRepository { store, repository in
            let upperCaseId = "a".repeating(64).uppercased()
            let file = store.bookFileURL(bookId: upperCaseId, format: .epub)
            FileManager.default.createFile(atPath: file.path, contents: Data("bytes".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(upperCaseId.lowercased(), books[0].id)
            XCTAssertEqual(.epub, books[0].format)
        }
    }

    func testDownloadedBooksPrefersRememberedMetadataWhenExternalFavoriteConflicts() {
        withRepository { store, repository in
            let id = "e".repeating(64)
            let remembered = CatalogBook(
                id: id,
                title: "Remembered title",
                author: "Remembered author",
                epubUrl: "https://books-api.guaka.org/download/legacy.epub",
                coverUrl: nil,
                sourceUrl: "https://books-api.guaka.org/download/legacy.epub",
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: "2024"
            )
            store.save("downloaded-books.json", value: [remembered])
            let file = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: file.path, contents: Data("bytes".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "conflict-key",
                    title: "External title",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "pdf",
                    blossomSha256: id,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual("Remembered title", books[0].title)
            XCTAssertEqual("Remembered author", books[0].author)
        }
    }

    func testDownloadedBooksUsesFirstFavoriteWhenDuplicateSHA256EntriesAreProvided() {
        withRepository { store, repository in
            let id = "u".repeating(64)
            let file = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: file.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "legacy-key",
                    title: "First favorite",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "pdf",
                    blossomSha256: id,
                    blossomUrl: nil
                ),
                ExternalFavorite(
                    key: "legacy-key-2",
                    title: "Second favorite",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: id,
                    blossomUrl: nil
                ),
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual("First favorite", books[0].title)
        }
    }

    func testDownloadedBooksAcceptsUppercaseFileExtensionsFromDiscoveredFiles() {
        withRepository { store, repository in
            let id = "v".repeating(64)
            let lower = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: lower.path, contents: Data("reader".utf8))
            let upper = lower.deletingPathExtension().appendingPathExtension("EPUB")
            try? FileManager.default.moveItem(at: lower, to: upper)

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(.epub, books[0].format)
            XCTAssertEqual(id, books[0].id)
            XCTAssertEqual("Downloaded EPUB", books[0].title)
        }
    }

    func testDownloadedBooksIgnoresExternalFavoriteWithoutValidShaFromUnknownFile() {
        withRepository { store, repository in
            let validId = "f".repeating(64)
            let validFile = store.bookFileURL(bookId: validId, format: .epub)
            FileManager.default.createFile(atPath: validFile.path, contents: Data("bytes".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "invalid",
                    title: "Ignored favorite",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: "not-a-sha",
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual("Downloaded EPUB", books[0].title)
            XCTAssertEqual(.epub, books[0].format)
        }
    }

    func testDownloadedBooksBuildsFromMetadataAndSkipsUnknownHexFormat() {
        withRepository { store, repository in
            let invalidHexFavorite = "f".repeating(63)
            let knownId = "g".repeating(64)
            let validFile = store.bookFileURL(bookId: knownId, format: .pdf)
            FileManager.default.createFile(atPath: validFile.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "broken",
                    title: "Bad hex",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "pdf",
                    blossomSha256: invalidHexFavorite,
                    blossomUrl: nil
                ),
                ExternalFavorite(
                    key: "known",
                    title: "Known remote title",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: knownId,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual("Known remote title", books[0].title)
            XCTAssertEqual(.pdf, books[0].format)
            XCTAssertEqual(knownId, books[0].id)
        }
    }

    func testDownloadedBooksPreservesRememberedFormatWhenMatchingFileFormatExists() {
        withRepository { store, repository in
            let id = "h".repeating(64)
            let rememberedBook = CatalogBook(
                id: id,
                title: "Remembers format",
                author: "Reader",
                epubUrl: "https://books-api.guaka.org/api/books/2/download",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )
            store.save("downloaded-books.json", value: [rememberedBook])
            FileManager.default.createFile(atPath: store.bookFileURL(bookId: id, format: .epub).path, contents: Data("epub".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(id, books[0].id)
            XCTAssertEqual(.epub, books[0].format)
            XCTAssertEqual("Remembers format", books[0].title)
        }
    }

    func testDownloadedBooksAcceptsUppercaseBlossomIdentityFromExternalFavorite() {
        withRepository { store, repository in
            let upperHex = "f".repeating(64).uppercased()
            let normalizedHex = upperHex.lowercased()
            let file = store.bookFileURL(bookId: normalizedHex, format: .pdf)
            FileManager.default.createFile(atPath: file.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "legacy-key",
                    title: "Uppercase source title",
                    author: nil,
                    year: nil,
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: upperHex,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(normalizedHex, books[0].id)
            XCTAssertEqual(normalizedHex, books[0].blossomSha256)
            XCTAssertEqual("Uppercase source title", books[0].title)
        }
    }

    func testDownloadedBooksPreservesRememberedFormatWhenUppercaseExtensionMatches() {
        withRepository { store, repository in
            let id = "w".repeating(64)
            let rememberedBook = CatalogBook(
                id: id,
                title: "Remembered epub",
                author: "Reader",
                epubUrl: "https://books-api.guaka.org/api/books/3/download",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: "2024"
            )
            store.save("downloaded-books.json", value: [rememberedBook])
            let lower = store.bookFileURL(bookId: id, format: .pdf)
            let uppercase = lower.deletingPathExtension().appendingPathExtension("PDF")
            FileManager.default.createFile(atPath: lower.path, contents: Data("reader".utf8))
            try? FileManager.default.moveItem(at: lower, to: uppercase)

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(id, books[0].id)
            XCTAssertEqual("Remembered epub", books[0].title)
            XCTAssertEqual(.pdf, books[0].format)
        }
    }

    func testDownloadedBooksSkipsMalformedRememberedMetadataAndFallsBackToDiscoveredDownload() {
        withRepository { store, repository in
            let id = "i".repeating(64)
            store.save("downloaded-books.json", value: ["legacy": "bad-metadata"])
            let file = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: file.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks()

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(id, books[0].id)
            XCTAssertEqual("Downloaded EPUB", books[0].title)
        }
    }

    func testDownloadedBooksFallsBackToKeyWhenBlossomSha256IsInvalid() {
        withRepository { store, repository in
            let invalidBlossom = String(repeating: "g", count: 40)
            let key = "legacy-key-id"
            let bookFile = store.bookFileURL(bookId: key, format: .epub)
            FileManager.default.createFile(atPath: bookFile.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: key,
                    title: "Libvault fallback",
                    author: "Reader",
                    year: nil,
                    url: "https://example.org/reader.epub",
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: invalidBlossom,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(key, books[0].id)
            XCTAssertNil(books[0].blossomSha256)
            XCTAssertEqual("Libvault fallback", books[0].title)
            XCTAssertEqual(.epub, books[0].format)
        }
    }

    func testDownloadedBooksIgnoresMd5FavoritesWithoutBlossomSha256WhenNoRememberedMetadataExists() {
        withRepository { store, repository in
            let md5 = "f".repeating(32)
            let file = store.bookFileURL(bookId: md5, format: .epub)
            FileManager.default.createFile(atPath: file.path, contents: Data("reader".utf8))

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: md5,
                    title: "Legacy favorite title",
                    author: "Legacy author",
                    year: nil,
                    url: "https://example.org/reader.epub",
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "epub",
                    blossomSha256: nil,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(md5, books[0].id)
            XCTAssertEqual("Downloaded EPUB", books[0].title)
        }
    }
}
