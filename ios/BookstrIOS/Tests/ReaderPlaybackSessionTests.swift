import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class ReaderPlaybackSessionTests: XCTestCase {
    func testCarPlaySelectionUsesLocalFileAndConsumesAutoplayOnce() {
        let session = ReaderPlaybackSession()
        let book = CatalogBook(id: "book", title: "Title", author: "Author",
                               epubUrl: "", coverUrl: nil, sourceUrl: nil, isbn: nil,
                               libvaultMd5: nil, format: .epub, year: nil)
        let url = URL(fileURLWithPath: "/tmp/book.epub")
        session.presentForCarPlay(book: book, localURL: url, locator: "epubcfi(/6/2)")
        XCTAssertFalse(session.isVisible)
        XCTAssertTrue(session.isCarPlayPlayback)
        XCTAssertEqual(session.item?.preparedURL, url)
        XCTAssertEqual(session.item?.initialLocator, "epubcfi(/6/2)")
        XCTAssertTrue(session.consumeCarPlayAutoplay(for: book.id))
        XCTAssertFalse(session.consumeCarPlayAutoplay(for: book.id))
        session.present(book: book)
        XCTAssertFalse(session.isCarPlayPlayback)
    }

    func testDynamicIslandPortraitChromeUsesTopSafeArea() {
        let metrics = ReaderChromeMetrics(
            width: 393, height: 852,
            safeTop: 59, safeLeading: 0, safeBottom: 34, safeTrailing: 0,
            orientation: .portrait
        )

        XCTAssertEqual(metrics.dynamicIslandEdge, .top)
        XCTAssertEqual(metrics.headerHeight, 55)
        XCTAssertEqual(metrics.contentTopInset, 55)
        XCTAssertEqual(metrics.islandTopInset, 8)
        XCTAssertEqual(metrics.clockTopPadding, 0)
        XCTAssertEqual(metrics.progressHeight, 42)
        XCTAssertEqual(metrics.bottomCornerRadius, 46)
        XCTAssertEqual(metrics.activationZoneHeight, 86)
    }

    func testNonIslandPortraitChromeKeepsContinuousHeader() {
        let metrics = ReaderChromeMetrics(
            width: 375, height: 667,
            safeTop: 20, safeLeading: 0, safeBottom: 0, safeTrailing: 0,
            orientation: .portrait
        )

        XCTAssertEqual(metrics.dynamicIslandEdge, .none)
        XCTAssertEqual(metrics.headerHeight, 64)
        XCTAssertEqual(metrics.bottomCornerRadius, 0)
        XCTAssertEqual(metrics.progressHeight, 18)
        XCTAssertEqual(metrics.activationZoneHeight, 58)
    }

    func testDynamicIslandMovesToCorrectLandscapeEdge() {
        let left = ReaderChromeMetrics(
            width: 852, height: 393,
            safeTop: 0, safeLeading: 59, safeBottom: 21, safeTrailing: 59,
            orientation: .landscapeLeft
        )
        let right = ReaderChromeMetrics(
            width: 852, height: 393,
            safeTop: 0, safeLeading: 59, safeBottom: 21, safeTrailing: 59,
            orientation: .landscapeRight
        )

        XCTAssertEqual(left.dynamicIslandEdge, .leading)
        XCTAssertEqual(right.dynamicIslandEdge, .trailing)
        XCTAssertEqual(left.headerHeight, 48)
        XCTAssertEqual(left.horizontalControlInset, 65)
        XCTAssertEqual(left.progressHeight, 29)
        XCTAssertEqual(left.bottomCornerRadius, 50.15, accuracy: 0.001)
        XCTAssertEqual(left.activationZoneHeight, 73)
    }

    func testPausedSpeechExpiresAtFiveMinutes() {
        let pausedAt = Date(timeIntervalSince1970: 1_000)
        XCTAssertFalse(ReaderSpeechPausePolicy.shouldExpire(
            pausedAt: pausedAt,
            now: pausedAt.addingTimeInterval(299.999)
        ))
        XCTAssertTrue(ReaderSpeechPausePolicy.shouldExpire(
            pausedAt: pausedAt,
            now: pausedAt.addingTimeInterval(300)
        ))
        XCTAssertEqual(ReaderSpeechPausePolicy.expiration, 300)
    }

    @MainActor
    func testButtonIslandVisibilityResetsAndExpiresIndependentlyOfReaderLayout() async throws {
        let visibility = ReaderChromeVisibilityController(dismissalDelay: .milliseconds(20))

        visibility.reveal()
        XCTAssertTrue(visibility.isButtonIslandVisible)
        try await Task.sleep(for: .milliseconds(10))
        visibility.scheduleDismissal()
        try await Task.sleep(for: .milliseconds(15))
        XCTAssertTrue(visibility.isButtonIslandVisible, "interaction should reset the dismissal timer")
        try await Task.sleep(for: .milliseconds(15))
        XCTAssertFalse(visibility.isButtonIslandVisible)

        visibility.reveal()
        visibility.hide()
        XCTAssertFalse(visibility.isButtonIslandVisible)
    }

    func testLegacyReaderSessionUsesNewestAvailableComicProgress() throws {
        let legacyJSON = """
        {"bookId":"old-epub","bookTitle":"Old","format":"epub","pageIndex":0,"pageOffset":0}
        """
        let session = try JSONDecoder().decode(ReaderSession.self, from: Data(legacyJSON.utf8))
        let selected = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: [
                BookProgress(bookId: "comic", progression: 0.4, cfi: "comic:3:10", updatedAt: 200),
                BookProgress(bookId: "old-epub", progression: 0.2, cfi: "epubcfi(/6/2)", updatedAt: 100),
            ],
            availableBookIDs: ["old-epub", "comic"]
        )

        XCTAssertNil(session.updatedAt)
        XCTAssertEqual(selected?.bookId, "comic")
    }

    func testTimestampedReaderSessionOutranksOlderProgress() {
        let session = ReaderSession(
            bookId: "comic", bookTitle: "Comic", format: .cbr,
            locator: "comic:4:10", updatedAt: 300
        )
        let selected = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: [BookProgress(bookId: "old-epub", progression: 0.2, cfi: "epubcfi(/6/2)", updatedAt: 200)],
            availableBookIDs: ["old-epub", "comic"]
        )

        XCTAssertNil(selected)
    }

    func testLaunchTimeEPUBWriteRecoversInterruptedComic() {
        let session = ReaderSession(
            bookId: "epub", bookTitle: "EPUB", format: .epub,
            locator: "epubcfi(/6/2)", updatedAt: 1_000_004
        )
        let selected = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: [
                BookProgress(bookId: "comic", progression: 0.2, cfi: "comic:2:96", updatedAt: 969_000),
                BookProgress(bookId: "epub", progression: 0.8, cfi: "epubcfi(/6/2)", updatedAt: 1_000_000),
            ],
            availableBookIDs: ["epub", "comic"]
        )

        XCTAssertEqual(selected?.bookId, "comic")
    }

    func testLaunchRecoveryDoesNotSelectLongAbandonedProgress() {
        let session = ReaderSession(
            bookId: "epub", bookTitle: "EPUB", format: .epub,
            locator: "epubcfi(/6/2)", updatedAt: 1_000_004
        )
        let selected = ReaderContinuationSelection.preferredLocalProgress(
            than: session,
            progress: [
                BookProgress(bookId: "epub", progression: 0.8, cfi: "epubcfi(/6/2)", updatedAt: 1_000_000),
                BookProgress(bookId: "comic", progression: 0.2, cfi: "comic:2:96", updatedAt: 900_000),
            ],
            availableBookIDs: ["epub", "comic"]
        )

        XCTAssertNil(selected)
    }

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
        XCTAssertTrue(ReaderSpeechRetention.isRetained(
            speaking: false, systemSpeaking: false, systemPaused: false,
            neuralPlaying: false, neuralPaused: false, preparing: true
        ))
    }

    func testPresentShowsReaderAndCloseKeepsWarmCache() {
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

        XCTAssertEqual(session.item?.book.id, "alice")
        XCTAssertFalse(session.isVisible)
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.isSpeechPlaying)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
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

    func testSpeechEndingWhileHiddenKeepsWarmCache() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()

        session.updateSpeechState(retained: false, playing: false)

        XCTAssertEqual(session.item?.book.id, "alice")
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

    func testPresentingTheSameBookWhileWarmReopensWithoutRemounting() {
        let session = ReaderPlaybackSession()
        let book = Self.book("alice")
        session.present(book: book, preparedURL: URL(string: "file:///tmp/alice.epub"), initialLocator: "start")
        session.requestClose()
        let nonce = session.presentationNonce

        session.present(book: book, preparedURL: URL(string: "file:///tmp/alice-alt.epub"))

        XCTAssertTrue(session.isVisible)
        XCTAssertEqual(session.presentationNonce, nonce)
        XCTAssertEqual(session.item?.initialLocator, "start")
        XCTAssertEqual(session.item?.preparedURL, URL(string: "file:///tmp/alice-alt.epub"))
        XCTAssertFalse(session.speechRetained)
        XCTAssertFalse(session.showsBackgroundSpeechControl)
    }

    func testPresentingADifferentBookReplacesTheRetainedReader() {
        let session = ReaderPlaybackSession()
        session.present(book: Self.book("alice"))
        session.updateSpeechState(retained: true, playing: true)
        session.requestClose()
        let nonce = session.presentationNonce

        session.present(book: Self.book("other"), highlightLocator: "mark", highlightKind: .mark)

        XCTAssertEqual(session.item?.book.id, "other")
        XCTAssertEqual(session.item?.highlightLocator, "mark")
        XCTAssertEqual(session.item?.highlightKind, .mark)
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

        session.present(
            book: Self.book("alice"),
            initialLocator: "word-cfi",
            highlightLocator: "word-cfi",
            highlightKind: .word
        )

        XCTAssertEqual(session.item?.initialLocator, "word-cfi")
        XCTAssertEqual(session.item?.highlightLocator, "word-cfi")
        XCTAssertEqual(session.item?.highlightKind, .word)
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

    func testToggleSpeechIncrementsTypedRequestToken() {
        let session = ReaderPlaybackSession()

        session.toggleSpeech()
        session.toggleSpeech()

        XCTAssertEqual(session.speechToggleToken, 2)
    }

    func testProgressRecorderBuildsFormatSpecificSessions() {
        let book = Self.book("reader-progress")

        let comic = ReaderProgressRecorder.session(
            book: book,
            format: .cbz,
            locator: "comic:12:30"
        )
        let pdf = ReaderProgressRecorder.session(
            book: book,
            format: .pdf,
            locator: "page:7"
        )
        let invalid = ReaderProgressRecorder.session(
            book: book,
            format: .cbz,
            locator: "epubcfi(/6/2)"
        )

        XCTAssertEqual(comic.pageIndex, 12)
        XCTAssertEqual(pdf.pageIndex, 7)
        XCTAssertEqual(invalid.pageIndex, 0)
    }

    func testProgressRecorderUsesPublicationRightsOverride() {
        var book = Self.book("reader-rights")
        book.rightsStatus = RightsStatus.unknown.rawValue
        let rights = BookRights(
            status: .openLicense,
            license: "CC BY 4.0",
            licenseURL: "https://creativecommons.org/licenses/by/4.0/",
            source: "EPUB package"
        )

        let session = ReaderProgressRecorder.session(
            book: book,
            format: .epub,
            locator: "epubcfi(/6/2)",
            rights: rights
        )

        XCTAssertEqual(session.rightsStatus, RightsStatus.openLicense.rawValue)
        XCTAssertEqual(session.license, "CC BY 4.0")
        XCTAssertEqual(session.rightsSource, "EPUB package")
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
            year: nil
        )
    }
}
