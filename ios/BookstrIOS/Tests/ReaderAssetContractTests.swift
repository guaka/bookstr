import XCTest

final class ReaderAssetContractTests: XCTestCase {
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
