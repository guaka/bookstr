import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ReaderPlaybackSessionTests: XCTestCase {
    func testRetentionIsFalseWhenEverySignalIsIdle() {
        XCTAssertFalse(
            ReaderSpeechRetention.isRetained(
                speaking: false,
                systemSpeaking: false,
                systemPaused: false,
                neuralPlaying: false,
                neuralPaused: false,
                pendingRequest: false
            )
        )
    }

    func testRetentionIsTrueForEachActiveSignal() {
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: true, systemSpeaking: false, systemPaused: false,
            neuralPlaying: false, neuralPaused: false
        ))
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: true, systemPaused: false,
            neuralPlaying: false, neuralPaused: false
        ))
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: false, systemPaused: true,
            neuralPlaying: false, neuralPaused: false
        ))
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: false, systemPaused: false,
            neuralPlaying: true, neuralPaused: false
        ))
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: false, systemPaused: false,
            neuralPlaying: false, neuralPaused: true
        ))
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: false, systemPaused: false,
            neuralPlaying: false, neuralPaused: false, pendingRequest: true
        ))
    }

    func testPresentShowsReaderAndCloseWithoutSpeechTearsItDown() {
        let session = ReaderPlaybackSession()
        let book = Self.book("alice")

        session.present(book: book, preparedURL: URL(string: "file:///tmp/alice.epub"), initialLocator: "epubcfi(/6/2)")

        XCTAssertEqual(session.item?.book.id, "alice")
        XCTAssertEqual(session.item?.preparedURL, URL(string: "file:///tmp/alice.epub"))
        XCTAssertEqual(session.item?.initialLocator, "epubcfi(/6/2)")
        XCTAssertTrue(session.isVisible)
        XCTAssertEqual(session.presentationNonce, 1)
        XCTAssertFalse(session.showsBackgroundSpeechControl)

        session.requestClose()

        XCTAssertNil(session.item)
        XCTAssertFalse(session.isVisible)
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.isSpeechPlaying)
    }

    func testCloseWhileSpeechRetainedHidesReaderAndShowsHeaderControl() {
        let session = ReaderPlaybackSession()
        let book = Self.book("alice")
        session.present(book: book)
        session.updateSpeechState(retained: true, playing: true)

        XCTAssertTrue(session.isVisible)
        XCTAssertFalse(session.showsBackgroundSpeechControl)

        session.requestClose()

        XCTAssertEqual(session.item?.book.id, "alice")
        XCTAssertFalse(session.isVisible)
        XCTAssertTrue(session.speechRetained)
        XCTAssertTrue(session.isSpeechPlaying)
        XCTAssertTrue(session.showsBackgroundSpeechControl)
    }

    func testPausedRetentionKeepsHiddenReaderWithoutAPlayingIcon() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()
        session.updateSpeechState(retained: true, playing: false)

        XCTAssertFalse(session.isVisible)
        XCTAssertTrue(session.speechRetained)
        XCTAssertFalse(session.isSpeechPlaying)
        XCTAssertTrue(session.showsBackgroundSpeechControl)
        XCTAssertEqual(session.item?.book.id, "alice")
    }

    func testSpeechEndingWhileHiddenClearsTheReader() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()

        session.updateSpeechState(retained: false, playing: false)

        XCTAssertNil(session.item)
        XCTAssertFalse(session.isVisible)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.isSpeechPlaying)
    }

    func testSpeechEndingWhileVisibleKeepsTheReaderOpen() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)

        session.updateSpeechState(retained: false, playing: false)

        XCTAssertEqual(session.item?.book.id, "alice")
        XCTAssertTrue(session.isVisible)
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
    }

    func testPresentingTheSameBookWhileRetainedReopensWithoutRemounting() {
        let session = ReaderPlaybackSession()
        let book = Self.book("alice")
        session.present(book: book, initialLocator: "start")
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()
        let nonce = session.presentationNonce

        session.present(book: book, initialLocator: "word-cfi")

        XCTAssertTrue(session.isVisible)
        XCTAssertEqual(session.presentationNonce, nonce)
        XCTAssertEqual(session.item?.initialLocator, "start")
        XCTAssertTrue(session.speechRetained)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
    }

    func testPresentingADifferentBookReplacesTheRetainedReader() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()
        let nonce = session.presentationNonce

        session.present(book: Self.book("other"), highlightLocator: "mark")

        XCTAssertEqual(session.item?.book.id, "other")
        XCTAssertEqual(session.item?.highlightLocator, "mark")
        XCTAssertTrue(session.isVisible)
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.isSpeechPlaying)
        XCTAssertEqual(session.presentationNonce, nonce + 1)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
    }

    func testPresentingTheSameBookWithANewLocatorRemountsWhenSpeechIsIdle() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"), initialLocator: "start")
        let nonce = session.presentationNonce

        session.present(book: Self.book("alice"), initialLocator: "word-cfi", highlightLocator: "word-cfi")

        XCTAssertEqual(session.item?.initialLocator, "word-cfi")
        XCTAssertEqual(session.item?.highlightLocator, "word-cfi")
        XCTAssertEqual(session.presentationNonce, nonce + 1)
        XCTAssertTrue(session.isVisible)
    }

    func testPresentingTheSameItemAgainDoesNotRemount() {
        let session = ReaderPlaybackSession()
        let book = Self.book("alice")
        session.present(book: book, initialLocator: "start")
        let nonce = session.presentationNonce

        session.present(book: book, initialLocator: "start")

        XCTAssertEqual(session.presentationNonce, nonce)
        XCTAssertTrue(session.isVisible)
    }

    func testToggleSpeechIncrementsTokenAndPostsNotification() {
        let session = ReaderPlaybackSession()
        let observed = expectation(description: "speech toggle notification")
        observed.expectedFulfillmentCount = 2
        let observer = NotificationCenter.default.addObserver(
            forName: ReaderPlaybackSession.toggleSpeechNotification,
            object: session,
            queue: nil
        ) { _ in
            observed.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        session.toggleSpeech()
        session.toggleSpeech()

        XCTAssertEqual(session.speechToggleToken, 2)
        wait(for: [observed], timeout: 1)
    }

    private static func book(_ id: String) -> CatalogBook {
        CatalogBook(
            id: id,
            title: "Alice",
            author: "Carroll",
            epubUrl: "https://example.org/\(id).epub",
            coverUrl: nil,
            sourceUrl: nil,
            isbn: nil,
            libvaultMd5: nil,
            format: .epub,
            blossomSha256: nil,
            year: nil
        )
    }
}
