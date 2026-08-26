import XCTest
@testable import BookstrIOS

final class ModelsTests: XCTestCase {
    func testSnippetISBNNormalizationUsesNIP73Form() {
        XCTAssertEqual(NostrSyncService.normalizedISBN("978-0-7653-8203-0"), "9780765382030")
        XCTAssertEqual(NostrSyncService.normalizedISBN("0-306-40615-2"), "0306406152")
        XCTAssertNil(NostrSyncService.normalizedISBN("not-an-isbn"))
    }
    func testBookFormatFallsBackToPdfHintInUrl() {
        XCTAssertEqual(BookFormat.from(format: nil, url: "https://example.org/book.PDF"), .pdf)
        XCTAssertEqual(BookFormat.from(format: "   ", url: "library/notes.pdf?download=1"), .pdf)
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/notes.txt"), .epub)
    }

    func testBookSearchResultAsCatalogBookNilWhenDownloadUrlMissing() {
        let result = BookSearchResult(
            id: "r1",
            source: "open",
            title: "Title",
            author: "Author",
            year: "2025",
            publisher: nil,
            language: nil,
            format: nil,
            downloadUrl: nil,
            coverUrl: nil,
            rating: 0,
            editionCount: 1
        )

        XCTAssertNil(result.asCatalogBook())
    }

    func testBookFormatFallsBackToPdfWhenUrlContainsPdfInQuery() {
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/book?download=story.PDF"), .pdf)
    }

    func testBookSearchResultAsFavoriteBookPreservesDownloadUrlAndFormat() {
        let result = BookSearchResult(
            id: "r6",
            source: "open",
            title: "Title",
            author: "Author",
            year: nil,
            publisher: nil,
            language: nil,
            format: .pdf,
            downloadUrl: "https://example.org/book.pdf",
            coverUrl: "https://example.org/cover.png",
            rating: 0,
            editionCount: 1
        )

        let book = result.asFavoriteBook()
        XCTAssertEqual(book.format, .pdf)
        XCTAssertEqual(book.epubUrl, "https://example.org/book.pdf")
        XCTAssertEqual(book.sourceUrl, "https://example.org/book.pdf")
        XCTAssertEqual(book.coverUrl, "https://example.org/cover.png")
    }

    func testBookSearchResultAsCatalogBookAllowsEmptyUrlButStillBuildsCatalogEntry() {
        let result = BookSearchResult(
            id: "r7",
            source: "open",
            title: "Title",
            author: "Author",
            year: "2025",
            publisher: nil,
            language: nil,
            format: .epub,
            downloadUrl: "",
            coverUrl: nil,
            rating: 0,
            editionCount: 1
        )
        let book = result.asCatalogBook()
        XCTAssertNotNil(book)
        XCTAssertEqual(book?.epubUrl, "")
        XCTAssertEqual(book?.sourceUrl, "")
        XCTAssertFalse(result.isReadable)
    }

    func testBookSearchResultAsCatalogBookNilWhenFormatMissing() {
        let result = BookSearchResult(
            id: "r4",
            source: "open",
            title: "Formatless",
            author: "Author",
            year: nil,
            publisher: nil,
            language: nil,
            format: nil,
            downloadUrl: "https://example.org/book.epub",
            coverUrl: nil,
            rating: 0,
            editionCount: 1
        )

        XCTAssertNil(result.asCatalogBook())
    }

    func testBookSearchResultAsCatalogBookUsesUrlAsSource() {
        let result = BookSearchResult(
            id: "r2",
            source: "open",
            title: "Title",
            author: "Author",
            year: "2025",
            publisher: nil,
            language: nil,
            format: .epub,
            downloadUrl: "https://example.org/book.epub",
            coverUrl: "https://example.org/cover.png",
            rating: 0,
            editionCount: 1
        )

        let book = result.asCatalogBook()
        XCTAssertNotNil(book)
        XCTAssertEqual(book?.sourceUrl, "https://example.org/book.epub")
    }

    func testBookSearchResultAsFavoriteBookDefaultsToEpub() {
        let result = BookSearchResult(
            id: "r3",
            source: "open",
            title: "Title",
            author: "Author",
            year: nil,
            publisher: nil,
            language: nil,
            format: nil,
            downloadUrl: nil,
            coverUrl: nil,
            rating: 1,
            editionCount: 1
        )

        let book = result.asFavoriteBook()
        XCTAssertEqual(book.format, .epub)
        XCTAssertEqual(book.epubUrl, "")
    }

    func testBookSearchResultIsReadableTreatsWhitespaceAsReadable() {
        let result = BookSearchResult(
            id: "r5",
            source: "open",
            title: "Whitespace URL",
            author: "Author",
            year: nil,
            publisher: nil,
            language: nil,
            format: .pdf,
            downloadUrl: "   ",
            coverUrl: nil,
            rating: 0,
            editionCount: 1
        )

        XCTAssertTrue(result.isReadable)
    }

    func testVocabularyWordUsesIdFromKey() {
        let word = VocabularyWord(
            key: "word-key",
            word: "Hello",
            language: "en",
            syncId: "sync",
            bookId: "book",
            bookTitle: "Book",
            cfi: "epubcfi",
            contextSentence: "A greeting",
            partOfSpeech: "noun",
            definitions: ["def"],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 1,
            lastSeenAt: 2,
            deleted: false
        )

        XCTAssertEqual(word.id, "word-key")
    }

    func testReaderSessionHasCodableRoundTrip() throws {
        let session = ReaderSession(
            bookId: "b1",
            bookTitle: "Book",
            format: .epub,
            author: "Me",
            year: "2025",
            locator: "{}",
            pageIndex: 3,
            pageOffset: 7
        )
        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(ReaderSession.self, from: data)

        XCTAssertEqual(decoded.bookId, session.bookId)
        XCTAssertEqual(decoded.bookTitle, session.bookTitle)
        XCTAssertEqual(decoded.format, session.format)
        XCTAssertEqual(decoded.author, session.author)
        XCTAssertEqual(decoded.year, session.year)
        XCTAssertEqual(decoded.locator, session.locator)
        XCTAssertEqual(decoded.pageIndex, session.pageIndex)
        XCTAssertEqual(decoded.pageOffset, session.pageOffset)
    }

    func testReaderSessionClampsNegativePageValuesToZero() {
        let session = ReaderSession(
            bookId: "b2",
            bookTitle: "Book",
            format: .epub,
            pageIndex: -9,
            pageOffset: -4
        )

        XCTAssertEqual(session.pageIndex, 0)
        XCTAssertEqual(session.pageOffset, 0)
    }

    func testBookFormatFromUnknownValueDefaultsToEpubWhenNoPdfHintInUrl() {
        XCTAssertEqual(BookFormat.from(format: "mobi", url: "https://example.org/read.bin"), .epub)
    }

    func testBookFormatFromUnknownValueIgnoresPdfHintInQueryAndFragment() {
        XCTAssertEqual(
            BookFormat.from(
                format: "mobi",
                url: "https://example.org/library/notes?download=story.pdf#download=file.epub"
            ),
            .epub
        )
    }

    func testBookFormatFromWhitespaceFormatValueFallsBackToUrlHint() {
        XCTAssertEqual(
            BookFormat.from(format: "  EPub  ", url: "https://example.org/read.bin"),
            .epub
        )
        XCTAssertEqual(BookFormat.from(format: "  pdf  ", url: "https://example.org/read.bin"), .pdf)
    }

    func testBookSearchResultIsReadableFalseWhenDownloadUrlBlank() {
        let result = BookSearchResult(
            id: "r8",
            source: "open",
            title: "Blank",
            author: "Author",
            year: nil,
            publisher: nil,
            language: nil,
            format: .epub,
            downloadUrl: "",
            coverUrl: nil,
            rating: 0,
            editionCount: 1
        )

        XCTAssertFalse(result.isReadable)
    }

    func testBookSearchResultAsCatalogBookPreservesQueryInUrlAndMetadata() {
        let result = BookSearchResult(
            id: "r9",
            source: "open",
            title: "Title",
            author: "Author",
            year: "2026",
            publisher: nil,
            language: nil,
            format: .pdf,
            downloadUrl: "https://example.org/read.pdf?download=1#open",
            coverUrl: "https://example.org/cover.png",
            rating: 0,
            editionCount: 1
        )

        let book = result.asCatalogBook()
        XCTAssertNotNil(book)
        XCTAssertEqual(book?.epubUrl, "https://example.org/read.pdf?download=1#open")
        XCTAssertEqual(book?.sourceUrl, "https://example.org/read.pdf?download=1#open")
        XCTAssertEqual(book?.year, "2026")
    }
}
