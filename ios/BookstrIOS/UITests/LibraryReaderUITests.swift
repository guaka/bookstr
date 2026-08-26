import XCTest

final class LibraryReaderUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing-library-fixtures"]
        app.launch()
        let libraryTab = app.tabBars.buttons["Library"]
        XCTAssertTrue(libraryTab.waitForExistence(timeout: 8))
        libraryTab.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 8))
    }

    func testLibraryOpensEPUBWithVisibleChapterTextThenPDFWithRenderedPage() throws {
        let (back, _) = openEPUB()
        attachScreenshot(named: "epub-visible")

        back.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))

        let pdf = app.buttons["library-book-ui-test-alice-pdf"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 5))
        pdf.tap()

        let pdfReader = app.descendants(matching: .any)["pdf-reader"]
        XCTAssertTrue(pdfReader.waitForExistence(timeout: 10))
        XCTAssertEqual(pdfReader.value as? String, "1 rendered pages")
        attachScreenshot(named: "pdf-visible")
    }

    func testEPUBSupportsLeftRightPagingAndUpDownScrolling() throws {
        let (_, chapter) = openEPUB()
        let initialY = chapter.frame.minY

        app.swipeLeft()
        XCTAssertTrue(waitForY(chapter, below: initialY - 80), "Swiping left did not advance the EPUB")
        let afterLeftY = chapter.frame.minY

        app.swipeRight()
        XCTAssertTrue(waitForY(chapter, above: afterLeftY + 80), "Swiping right did not return to the previous EPUB page")
        let beforeUpY = chapter.frame.minY

        app.swipeUp()
        XCTAssertTrue(waitForY(chapter, below: beforeUpY - 80), "Swiping up did not scroll the EPUB")
        let afterUpY = chapter.frame.minY

        app.swipeDown()
        XCTAssertTrue(waitForY(chapter, above: afterUpY + 80), "Swiping down did not scroll back through the EPUB")
        attachScreenshot(named: "epub-navigation-restored")
    }

    func testEPUBRepeatedHorizontalPagingKeepsAdvancingAndCanReverse() throws {
        let (_, chapter) = openEPUB()
        let initialY = chapter.frame.minY

        app.swipeLeft()
        XCTAssertTrue(waitForY(chapter, below: initialY - 80), "First left swipe did not advance")
        let firstPageY = chapter.frame.minY

        app.swipeLeft()
        XCTAssertTrue(waitForY(chapter, below: firstPageY - 80), "Second left swipe stayed on the same page")
        let secondPageY = chapter.frame.minY

        app.swipeRight()
        XCTAssertTrue(waitForY(chapter, above: secondPageY + 80), "First right swipe did not reverse one page")
        let reversedOnceY = chapter.frame.minY

        app.swipeRight()
        XCTAssertTrue(waitForY(chapter, above: reversedOnceY + 80), "Second right swipe did not reverse again")
        XCTAssertGreaterThan(chapter.frame.minY, initialY - 80, "Paging back did not return near the beginning")
    }

    func testEPUBCanBeClosedReopenedAndNavigatedAgain() throws {
        let (back, chapter) = openEPUB()
        let initialY = chapter.frame.minY
        app.swipeUp()
        XCTAssertTrue(waitForY(chapter, below: initialY - 80), "Initial reader did not scroll")

        back.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))

        let (_, reopenedChapter) = openEPUB()
        let reopenedY = reopenedChapter.frame.minY
        app.swipeLeft()
        XCTAssertTrue(
            waitForY(reopenedChapter, below: reopenedY - 80),
            "Reopened EPUB stayed on the same page after a left swipe"
        )
    }

    func testReaderHeadersExposeMetadataContentsSearchClockAndProgress() throws {
        let (back, _) = openEPUB()

        XCTAssertTrue(app.buttons["reader-search"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["reader-clock"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["reader-progress-epub"].waitForExistence(timeout: 4))
        XCTAssertFalse(app.buttons["reader-font-larger"].exists)
        XCTAssertFalse(app.buttons["reader-font-smaller"].exists)
        let contents = app.buttons["reader-contents"]
        XCTAssertTrue(contents.waitForExistence(timeout: 4))
        contents.tap()
        XCTAssertTrue(app.navigationBars["Contents"].waitForExistence(timeout: 4))
        app.buttons["Done"].tap()

        back.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))

        let (pdfBack, _) = openPDF()
        XCTAssertTrue(app.buttons["reader-search"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["Alice PDF Fixture"].exists)
        XCTAssertTrue(app.staticTexts["Lewis Carroll · 1865"].exists)
        let pdfClock = app.descendants(matching: .any)["reader-clock"]
        XCTAssertTrue(pdfClock.waitForExistence(timeout: 4))
        XCTAssertTrue(
            NSPredicate(format: "SELF MATCHES %@", #"\d{2}:\d{2}  PDF"#)
                .evaluate(with: pdfClock.label),
            "PDF clock was not in 24-hour HH:mm format: \(pdfClock.label)"
        )
        XCTAssertTrue(app.descendants(matching: .any)["reader-progress-pdf"].waitForExistence(timeout: 4))
        pdfBack.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    }

    func testEPUBSearchFindsAndOpensAResult() throws {
        _ = openEPUB()
        app.buttons["reader-search"].tap()
        let query = app.textFields["reader-search-query"]
        XCTAssertTrue(query.waitForExistence(timeout: 4))
        query.tap()
        query.typeText("final page marker")
        app.buttons["reader-search-submit"].tap()

        let result = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "reader-search-result-epub-")
        ).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 12), "EPUB search returned no result")
        result.tap()
        XCTAssertTrue(waitForDisappearance(query, timeout: 4))
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "final page marker")
        ).firstMatch.waitForExistence(timeout: 8))
    }

    func testPDFSearchFindsAndOpensAResult() throws {
        _ = openPDF()
        app.buttons["reader-search"].tap()
        let query = app.textFields["reader-search-query"]
        XCTAssertTrue(query.waitForExistence(timeout: 4))
        query.tap()
        query.typeText("Wonderland")
        app.buttons["reader-search-submit"].tap()

        let result = app.buttons["reader-search-result-pdf-0"]
        XCTAssertTrue(result.waitForExistence(timeout: 8), "PDF search returned no result")
        result.tap()
        XCTAssertTrue(waitForDisappearance(query, timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["pdf-reader"].exists)
    }

    func testPDFCanBeClosedAndReopened() throws {
        let (pdfBack, pdfReader) = openPDF()
        XCTAssertTrue(pdfReader.waitForExistence(timeout: 8), "Opened PDF did not expose rendered content")
        XCTAssertEqual(pdfReader.value as? String, "1 rendered pages")

        pdfBack.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))

        let (secondPdfBack, secondPdfReader) = openPDF()
        XCTAssertTrue(secondPdfReader.waitForExistence(timeout: 8))
        secondPdfBack.tap()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    }

    private func openEPUB() -> (back: XCUIElement, chapter: XCUIElement) {
        let epub = app.buttons["library-book-ui-test-alice-epub"]
        XCTAssertTrue(epub.waitForExistence(timeout: 5))
        epub.tap()

        let back = app.buttons["reader-back"]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "EPUB reader was not presented")
        let chapter = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Down the Rabbit-Hole")
        ).firstMatch
        XCTAssertTrue(chapter.waitForExistence(timeout: 12), "EPUB opened but did not expose visible chapter text")
        return (back, chapter)
    }

    private func openPDF() -> (back: XCUIElement, reader: XCUIElement) {
        let pdf = app.buttons["library-book-ui-test-alice-pdf"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 5))
        pdf.tap()

        let back = app.buttons["reader-back"]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "PDF reader was not presented")
        let reader = app.descendants(matching: .any)["pdf-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 10), "PDF rendered view did not appear")
        return (back, reader)
    }

    private func waitForY(_ element: XCUIElement, below maximum: CGFloat) -> Bool {
        waitForY(element) { $0 < maximum }
    }

    private func waitForY(_ element: XCUIElement, above minimum: CGFloat) -> Bool {
        waitForY(element) { $0 > minimum }
    }

    private func waitForY(_ element: XCUIElement, condition: @escaping (CGFloat) -> Bool) -> Bool {
        let predicate = NSPredicate { _, _ in element.exists && condition(element.frame.minY) }
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: 4) == .completed
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let predicate = NSPredicate(format: "exists == false")
        return XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: element)],
            timeout: timeout
        ) == .completed
    }

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
