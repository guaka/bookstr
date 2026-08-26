import XCTest
import PDFKit
import UIKit
@testable import BookstrIOS

final class CatalogRepositoryDownloadedCoverageExtraTests: XCTestCase {
    private func withRepository(_ test: (JSONFileStore, CatalogRepository) -> Void) {
        let subdirectory = "bookstr-test-extra-" + UUID().uuidString
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

    func testDownloadedBooksSkipsUppercaseUnsupportedExtensions() {
        withRepository { store, repository in
            let id = "x".repeating(64)
            let base = store.bookFileURL(bookId: id, format: .epub)
            let unsupported = base.deletingPathExtension().appendingPathExtension("TXT")
            FileManager.default.createFile(atPath: unsupported.path, contents: Data("unsupported".utf8))

            let books = repository.downloadedBooks()
            XCTAssertTrue(books.isEmpty)
        }
    }

    func testDownloadedBooksFallsBackToExternalFavoriteWhenRememberedMetadataIsMalformed() {
        withRepository { store, repository in
            let id = "y".repeating(64)
            let validFile = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: validFile.path, contents: Data("epub bytes".utf8))
            store.save("downloaded-books.json", value: ["legacy": "bad-metadata"])

            let books = repository.downloadedBooks(externalFavorites: [
                ExternalFavorite(
                    key: "fallback-key",
                    title: "Recovered favorite",
                    author: "Recovered author",
                    year: "2026",
                    url: nil,
                    isbn: nil,
                    libvaultMd5: nil,
                    format: "pdf",
                    blossomSha256: id,
                    blossomUrl: nil
                )
            ])

            XCTAssertEqual(1, books.count)
            XCTAssertEqual(id, books[0].id)
            XCTAssertEqual("Recovered favorite", books[0].title)
            XCTAssertEqual("Recovered author", books[0].author)
            XCTAssertEqual(.epub, books[0].format)
        }
    }

    func testLocalPublicationCorrectsFormatToDetectedEpubFromPdfBookReference() {
        withRepository { store, repository in
            let id = "x".repeating(64)
            let malformed = CatalogBook(
                id: id,
                title: "Requested as PDF",
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

            let epubFile = store.bookFileURL(bookId: id, format: .epub)
            let marker = "PK\x03\x04...".data(using: .utf8)!
            let container = "META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: marker + container)

            let local = repository.localPublication(for: malformed)
            XCTAssertNotNil(local)
            XCTAssertEqual(id, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationRejectsCorruptEpubWithoutContainerXml() {
        withRepository { store, repository in
            let id = "z".repeating(64)
            let book = CatalogBook(
                id: id,
                title: "Corrupt",
                author: "Reader",
                epubUrl: "https://example.org/corrupt.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: id, format: .epub)
            FileManager.default.createFile(atPath: epubFile.path, contents: "PK\x03\x04only-zip-header".data(using: .utf8))

            let local = repository.localPublication(for: book)
            XCTAssertNil(local)
        }
    }

    func testLocalPublicationFindsLowercasedIdentityCandidateFromUppercaseId() {
        withRepository { store, repository in
            let lowerId = "k".repeating(64)
            let requested = CatalogBook(
                id: lowerId.uppercased(),
                title: "Case test",
                author: "Reader",
                epubUrl: "https://example.org/case.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: lowerId, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(lowerId, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationMatchesAlternateBlossomSha256IdentityCandidate() {
        withRepository { store, repository in
            let id = "requested-id"
            let altSha = "y".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Alias test",
                author: "Reader",
                epubUrl: "https://example.org/alias.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: altSha,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: altSha, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(altSha, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationMatchesIdentityCandidatesFromEmptyBookId() {
        withRepository { store, repository in
            let altSha = "z".repeating(64)
            let requested = CatalogBook(
                id: "   ",
                title: "Blank id book",
                author: "Reader",
                epubUrl: "https://example.org/blank-id.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: altSha,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: altSha, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(altSha, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationUsesLibvaultMd5FallbackWhenPrimaryIdIsInvalid() {
        withRepository { store, repository in
            let md5 = "k".repeating(32)
            let requested = CatalogBook(
                id: "",
                title: "MD5 fallback",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: md5,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: md5, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(md5, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationSkipsCorruptPrimaryCandidateAndFallsBackToValidMD5Identity() {
        withRepository { store, repository in
            let requestedId = "not-a-valid-candidate"
            let md5 = "m".repeating(32)
            let requested = CatalogBook(
                id: requestedId,
                title: "Corrupt then fallback",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: md5,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let corruptFile = store.bookFileURL(bookId: requestedId, format: .epub)
            let validFile = store.bookFileURL(bookId: md5, format: .epub)
            FileManager.default.createFile(atPath: corruptFile.path, contents: Data("bad-payload".utf8))
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: validFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(md5, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationTrimsCandidateIdentityFromRequestedBookMetadata() {
        withRepository { store, repository in
            let requestedId = " ".repeating(2) + ("t".repeating(64).uppercased()) + " \n"
            let normalizedId = "t".repeating(64)
            let requested = CatalogBook(
                id: requestedId,
                title: "Whitespace candidate",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: normalizedId, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(normalizedId, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationSkipsInvalidPdfWhenNoFallbackCandidateExists() {
        withRepository { store, repository in
            let id = "z".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Invalid pdf",
                author: "Reader",
                epubUrl: "https://example.org/book.pdf",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .pdf,
                blossomSha256: nil,
                year: nil
            )

            let pdfFile = store.bookFileURL(bookId: id, format: .pdf)
            FileManager.default.createFile(atPath: pdfFile.path, contents: Data("not a pdf".utf8))

            let local = repository.localPublication(for: requested)
            XCTAssertNil(local)
        }
    }

    func testLocalPublicationSkipsWhenNoUsableIdentityCandidatesExist() {
        withRepository { store, repository in
            let requested = CatalogBook(
                id: "   ",
                title: "Blank identity",
                author: "Reader",
                epubUrl: "https://example.org/blank-id.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let lowerId = "x".repeating(64)
            let epubFile = store.bookFileURL(bookId: lowerId, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNil(local)
        }
    }

    func testLocalPublicationCorrectsFormatFromPdfToPdfWhenRequestedFormatIsWrong() {
        withRepository { store, repository in
            let id = "y".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Requested PDF",
                author: "Reader",
                epubUrl: "https://example.org/request.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let pdfFile = store.bookFileURL(bookId: id, format: .pdf)
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 200, height: 200))
            try? renderer.writePDF(to: pdfFile) { context in
                context.beginPage()
                "Test PDF".draw(at: CGPoint(x: 20, y: 20), withAttributes: [.font: UIFont.systemFont(ofSize: 12)])
            }

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(id, local?.book.id)
            XCTAssertEqual(.pdf, local?.book.format)
        }
    }

    func testLocalPublicationFallsBackToLibvaultMd5WhenPrimaryIdAndBlossomShaAreMissingOrBlank() {
        withRepository { store, repository in
            let md5 = "z".repeating(32)
            let requested = CatalogBook(
                id: "",
                title: "Md5 fallback",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: md5,
                format: .epub,
                blossomSha256: "   ",
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: md5, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: epubFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(md5, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationPicksPrimaryIdBeforeLibvaultMd5WhenBothFilesExist() {
        withRepository { store, repository in
            let id = "a".repeating(64)
            let md5 = "m".repeating(32)
            let requested = CatalogBook(
                id: id,
                title: "Prefer id",
                author: "Reader",
                epubUrl: "https://example.org/book.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: md5,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let md5File = store.bookFileURL(bookId: md5, format: .epub)
            let idFile = store.bookFileURL(bookId: id, format: .epub)
            let payload = "PK\x03\x04...META-INF/container.xml".data(using: .utf8)!
            FileManager.default.createFile(atPath: md5File.path, contents: payload)
            FileManager.default.createFile(atPath: idFile.path, contents: payload)

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(id, local?.book.id)
            XCTAssertEqual(.epub, local?.book.format)
        }
    }

    func testLocalPublicationFallsBackToAlternateFormatWhenPrimaryFileIsInvalid() {
        withRepository { store, repository in
            let id = "b".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Primary invalid",
                author: "Reader",
                epubUrl: "https://example.org/request.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: id, format: .epub)
            let pdfFile = store.bookFileURL(bookId: id, format: .pdf)
            FileManager.default.createFile(atPath: epubFile.path, contents: Data("not-a-zip".utf8))

            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 150, height: 150))
            try? renderer.writePDF(to: pdfFile) { context in
                context.beginPage()
                "PDF fallback".draw(at: CGPoint(x: 12, y: 20), withAttributes: [.font: UIFont.systemFont(ofSize: 12)])
            }

            let local = repository.localPublication(for: requested)
            XCTAssertNotNil(local)
            XCTAssertEqual(id, local?.book.id)
            XCTAssertEqual(.pdf, local?.book.format)
        }
    }

    func testLocalPublicationReturnsNilWhenAllCandidateFilesAreUnreadable() {
        withRepository { store, repository in
            let id = "c".repeating(64)
            let requested = CatalogBook(
                id: id,
                title: "Unreadable",
                author: "Reader",
                epubUrl: "https://example.org/request.epub",
                coverUrl: nil,
                sourceUrl: nil,
                isbn: nil,
                libvaultMd5: nil,
                format: .epub,
                blossomSha256: nil,
                year: nil
            )

            let epubFile = store.bookFileURL(bookId: id, format: .epub)
            let pdfFile = store.bookFileURL(bookId: id, format: .pdf)
            FileManager.default.createFile(atPath: epubFile.path, contents: Data("not-a-zip".utf8))
            FileManager.default.createFile(atPath: pdfFile.path, contents: Data("not-a-pdf".utf8))

            let local = repository.localPublication(for: requested)
            XCTAssertNil(local)
        }
    }
}
