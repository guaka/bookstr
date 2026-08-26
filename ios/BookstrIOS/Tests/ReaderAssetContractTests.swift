import XCTest
import PDFKit
import WebKit
@testable import BookstrIOS

final class ReaderAssetContractTests: XCTestCase {
    func testSpeechPlaybackQueueYieldsEveryChunkOnceInOrder() {
        var queue = SpeechPlaybackQueue()
        let chunks = [
            SpeechQueueChunk(text: "First.", offset: 0, pauseSeconds: 0),
            SpeechQueueChunk(text: "Second.", offset: 7, pauseSeconds: 0.18),
            SpeechQueueChunk(text: "Third.", offset: 15, pauseSeconds: 0.32),
        ]

        queue.beginRequest(id: "current")
        XCTAssertTrue(queue.accept(requestID: "current", chunks: chunks))
        XCTAssertFalse(queue.hasPendingRequest)
        XCTAssertEqual(queue.next(), chunks[0])
        XCTAssertEqual(queue.next(), chunks[1])
        XCTAssertEqual(queue.next(), chunks[2])
        XCTAssertNil(queue.next(), "A completed narration must not restart from the first chunk")
        XCTAssertTrue(queue.isEmpty)
    }

    func testSpeechPlaybackQueueRejectsStaleWebViewResponse() {
        var queue = SpeechPlaybackQueue()
        let stale = [SpeechQueueChunk(text: "Old narration", offset: 0, pauseSeconds: 0)]
        let current = [SpeechQueueChunk(text: "Current narration", offset: 20, pauseSeconds: 0)]

        queue.beginRequest(id: "old")
        queue.beginRequest(id: "current")

        XCTAssertFalse(queue.accept(requestID: "old", chunks: stale))
        XCTAssertTrue(queue.hasPendingRequest)
        XCTAssertTrue(queue.accept(requestID: "current", chunks: current))
        XCTAssertEqual(queue.next(), current[0])
        XCTAssertNil(queue.next())
    }

    func testSpeechPlaybackQueueRejectsDuplicateResponse() {
        var queue = SpeechPlaybackQueue()
        let chunks = [SpeechQueueChunk(text: "Only once", offset: 0, pauseSeconds: 0)]

        queue.beginRequest(id: "request")
        XCTAssertTrue(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertFalse(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertEqual(queue.next(), chunks[0])
        XCTAssertNil(queue.next())
    }

    func testSpeechPlaybackQueueCancellationRejectsDelayedResponseAndClearsAudio() {
        var queue = SpeechPlaybackQueue()
        let chunks = [SpeechQueueChunk(text: "Do not play", offset: 0, pauseSeconds: 0)]

        queue.beginRequest(id: "request")
        queue.cancel()

        XCTAssertFalse(queue.hasPendingRequest)
        XCTAssertTrue(queue.isEmpty)
        XCTAssertFalse(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertNil(queue.next())
    }

    func testSpeechBridgeCarriesRequestIdentityBackToNativeCode() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.requestSpeechText = function(notifyNative, requestID)"))
        XCTAssertTrue(html.contains("requestID: requestID || null"))
    }

    func testAllEPUBRuntimeAssetsAreBundledInTheApplication() throws {
        let reader = try bundledAsset(named: "reader", extension: "html")
        let epub = try bundledAsset(named: "epub.min", extension: "js")
        let zip = try bundledAsset(named: "jszip.min", extension: "js")

        XCTAssertGreaterThan(reader.count, 20_000)
        XCTAssertGreaterThan(epub.count, 100_000)
        XCTAssertGreaterThan(zip.count, 50_000)
    }

    func testIOSReaderUsesOneContinuousScrollableDocument() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("manager: \"continuous\""))
        XCTAssertTrue(html.contains("flow: \"scrolled-doc\""))
        XCTAssertFalse(html.contains("manager: nativePaginated"))
        XCTAssertFalse(html.contains("flow: nativePaginated"))
    }

    func testFirstSpineItemIsNotAutomaticallyForcedIntoCoverLayout() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("href.includes(\"cover\")"))
        XCTAssertTrue(html.contains("properties.includes(\"cover\")"))
        XCTAssertFalse(html.contains("section.index === 0 || href.includes(\"cover\")"))
    }

    func testPageCommandsMoveTheViewportInOppositeDirections() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.nextPage = function() {\n      moveViewportPage(1);"))
        XCTAssertTrue(html.contains("window.prevPage = function() {\n      moveViewportPage(-1);"))
        XCTAssertTrue(html.contains("container.scrollBy({ top: direction * distance, behavior: \"auto\" })"))
    }

    func testPageMovementFallsBackToTheNextSpineSectionOnlyWhenScrollingDidNotMove() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("Math.abs(container.scrollTop - before) > 2"))
        XCTAssertTrue(html.contains("direction > 0 ? rendition.next() : rendition.prev()"))
        XCTAssertTrue(html.contains("if (direction < 0 && container && container.scrollTop <= 2) return"))
    }

    func testReaderForwardsKnownWordTapToNativeBridge() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("installKnownWordNavigation(contentDocument);"))
        XCTAssertTrue(html.contains("AndroidBridge.onKnownWordTapped(normalized);"))
    }

    func testReaderUsesPinchToResizeFontLikeAndroid() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("let pinchStartDistance = 0;"))
        XCTAssertTrue(html.contains("const ratio = distance / pinchStartDistance;"))
        XCTAssertTrue(html.contains("const dampedRatio = 1 + (ratio - 1) * 0.35;"))
        XCTAssertTrue(html.contains("const next = Math.max(75, Math.min(180, Math.round(pinchStartFontPercent * dampedRatio)));"))
    }

    func testReaderSwipeNavigationDetectsPinchGesture() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("gestureAxis = \"pinch\";"))
        XCTAssertTrue(html.contains("pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);"))
        XCTAssertTrue(html.contains("pinchStartFontPercent = readerFontPercent;"))
        XCTAssertTrue(html.contains("gestureAxis = null;"))
    }

    func testReaderSwipeNavigationResetsPinchStateOnEndAndCancel() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (gestureAxis === \"pinch\") {"))
        XCTAssertTrue(html.contains("if (event.touches.length < 2) {"))
        XCTAssertTrue(html.contains("gestureAxis = null;"))
        XCTAssertTrue(html.contains("pinchStartDistance = 0;"))
        XCTAssertTrue(html.contains("pinchAnchor = null;"))
        XCTAssertTrue(html.contains("target.addEventListener(\"touchcancel\""))
    }

    func testReaderSwipeNavigationUsesHorizontalSwipeThresholds() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (!gestureAxis && Math.max(absX, absY) > 8) {"))
        XCTAssertTrue(html.contains("else if (absX > 14 && absX > absY * 1.35) gestureAxis = \"horizontal\";"))
        XCTAssertTrue(html.contains("if (gestureAxis !== \"horizontal\" || Math.abs(dx) < 72) {"))
        XCTAssertTrue(html.contains("if (dx < 0) nextPage(); else prevPage();"))
    }

    func testReaderDoesNotDisableNativePinchByForcingTouchActionPanYInScript() throws {
        let html = try bundledReaderHTML()

        XCTAssertFalse(html.contains("target.documentElement.style.touchAction = \"pan-y\""))
        XCTAssertFalse(html.contains("target.body.style.touchAction = \"pan-y\""))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("target.addEventListener(\"touchend\", function(event)"))
    }

    func testReaderZoomAPICapsFontPercentRange() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.adjustReaderFont = function(delta) {"))
        XCTAssertTrue(html.contains("readerFontPercent = Math.max(75, Math.min(180, readerFontPercent + Number(delta || 0)));"))
        XCTAssertTrue(html.contains("localStorage.setItem(\"bookstr-reader-font-percent\", String(readerFontPercent));"))
    }

    func testReaderExposesNativePinchBridgeForWKWebView() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.beginNativeFontPinch = function() {"))
        XCTAssertTrue(html.contains("window.updateNativeFontPinch = function(scale) {"))
        XCTAssertTrue(html.contains("Math.round(nativePinchStartFontPercent * dampedRatio)"))
        XCTAssertTrue(html.contains("window.endNativeFontPinch = function() {"))
    }

    func testKnownWordSetIsBuiltFromInputJSON() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.setKnownWords = function(wordsJson) {"))
        XCTAssertTrue(html.contains("knownWordSet = new Set(words.map(function(word) {"))
        XCTAssertTrue(html.contains("return String(word || \"\").normalize(\"NFC\").toLocaleLowerCase();"))
        XCTAssertTrue(html.contains("if (rendition && rendition.getContents) {"))
    }

    func testKnownWordNavigationIsGuardedAndCapturesClicks() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("function installKnownWordNavigation(contentDocument) {"))
        XCTAssertTrue(html.contains("if (contentDocument.__bookstrKnownWordNavigation) return;"))
        XCTAssertTrue(html.contains("contentDocument.addEventListener(\"click\", function(event)"))
        XCTAssertTrue(html.contains("}, true);"))
    }

    func testKnownWordTapRequiresExactKnownWordMatchInContent() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (knownWordSet.has(normalized) && window.AndroidBridge) {"))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("event.stopPropagation();"))
        XCTAssertTrue(html.contains("AndroidBridge.onKnownWordTapped(normalized);"))
    }

    func testDictionaryRequiresAnExplicitAddToWordsAction() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("id=\"dictionary-save\""))
        XCTAssertTrue(html.contains("aria-label=\"Add to Words\""))
        XCTAssertTrue(html.contains("function saveActiveDictionaryWord() {"))
        XCTAssertTrue(html.contains("AndroidBridge.onWordSelected(JSON.stringify(activeDictionary));"))
        XCTAssertTrue(html.contains("knownWordSet.add(normalized);"))
        XCTAssertTrue(html.contains("button.textContent = saved ? \"✓\" : \"＋\";"))
    }

    func testReaderReportsSelectedPassagesForSnippetActions() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("AndroidBridge.onTextSelected(JSON.stringify({"))
        XCTAssertTrue(html.contains("text: cleanDictionaryText(selection).slice(0, 2000)"))
        XCTAssertTrue(html.contains("contextSentence: selectionContext(selectedRange)"))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("event.stopPropagation();"))
    }

    @MainActor
    func testReaderViewsSuppressNativeEditActions() {
        let webView = BookstrReaderWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let pdfView = VocabularyPDFView()

        XCTAssertFalse(webView.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
        XCTAssertFalse(pdfView.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
    }

    @MainActor
    func testPDFProgressTracksCurrentAndFurthestPage() {
        let controller = PDFReaderController()

        controller.updatePage(index: 1, count: 3)
        XCTAssertEqual(controller.progression, 0.5, accuracy: 0.000_001)
        XCTAssertEqual(controller.furthestProgression, 0.5, accuracy: 0.000_001)

        controller.updatePage(index: 0, count: 3)
        XCTAssertEqual(controller.progression, 0, accuracy: 0.000_001)
        XCTAssertEqual(controller.furthestProgression, 0.5, accuracy: 0.000_001)
    }

    func testReaderClockAlwaysUses24HourTime() throws {
        let date = try XCTUnwrap(Calendar.current.date(from: DateComponents(
            year: 2026, month: 1, day: 15, hour: 13, minute: 7
        )))
        XCTAssertEqual(ReaderClockLabel.formattedTime(date), "13:07")
    }

    func testReaderSearchesEverySpineSectionAndCanOpenAResult() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.searchBook = async function(query) {"))
        XCTAssertTrue(html.contains("const sections = (book.spine && book.spine.spineItems) || [];"))
        XCTAssertTrue(html.contains("const matches = section.find(needle) || [];"))
        XCTAssertTrue(html.contains("AndroidBridge.onSearchResults(JSON.stringify(results));"))
        XCTAssertTrue(html.contains("window.displaySearchResult = function(cfi) {"))
    }

    func testReaderReportsWhetherARealTableOfContentsExists() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("collect(navigation && navigation.toc);"))
        XCTAssertTrue(html.contains("hasToc: labels.size > 0"))
    }

    private func bundledReaderHTML() throws -> String {
        try bundledAsset(named: "reader", extension: "html")
    }

    private func bundledAsset(named name: String, extension fileExtension: String) throws -> String {
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: name, withExtension: fileExtension),
            "Missing bundled reader asset: \(name).\(fileExtension)"
        )
        return try String(contentsOf: url, encoding: .utf8)
    }
}
