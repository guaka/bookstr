import XCTest

final class LibraryReaderUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing-library-fixtures"]
        app.launch()
        let library = app.tabBars.buttons["Library"]
        XCTAssertTrue(library.waitForExistence(timeout: 12))
        library.tap()
        XCTAssertTrue(library.isSelected)
    }

    func testEPUBNavigationSearchAndPDFRenderingJourney() throws {
        let (back, chapter) = openEPUB()
        let initialY = chapter.frame.minY

        app.swipeLeft()
        XCTAssertTrue(waitForY(chapter, below: initialY - 80), "Swiping left did not advance the EPUB")
        let afterLeftY = chapter.frame.minY

        app.swipeRight()
        if !waitForY(chapter, above: afterLeftY + 80) {
            app.swipeRight()
        }
        XCTAssertTrue(waitForY(chapter, above: afterLeftY + 80), "Swiping right did not return to the previous EPUB page")
        attachScreenshot(named: "epub-navigation-restored")

        let clock = app.descendants(matching: .any)["reader-clock"]
        XCTAssertTrue(clock.waitForExistence(timeout: 4))
        XCTAssertFalse(clock.label.localizedCaseInsensitiveContains("epub"))
        let title = app.staticTexts["reader-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 4))
        XCTAssertLessThan(title.frame.maxX, app.frame.width * 0.36)
        XCTAssertLessThan(title.frame.minY, back.frame.midY)
        XCTAssertTrue(app.descendants(matching: .any)["reader-progress-epub"].waitForExistence(timeout: 4))
        app.buttons["reader-search"].tap()
        let searchScope = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Every section of")
        ).firstMatch
        XCTAssertTrue(searchScope.waitForExistence(timeout: 4))
        XCTAssertTrue(searchScope.label.localizedCaseInsensitiveContains("alice epub fixture"))
        let epubQuery = app.textFields["reader-search-query"]
        XCTAssertTrue(epubQuery.waitForExistence(timeout: 4))
        let queryYBeforeFocus = epubQuery.frame.minY
        epubQuery.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
        XCTAssertEqual(epubQuery.frame.minY, queryYBeforeFocus, accuracy: 2)
        epubQuery.typeText("final page marker")
        app.buttons["reader-search-submit"].tap()
        let epubResult = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "reader-search-result-epub-")
        ).firstMatch
        XCTAssertTrue(epubResult.waitForExistence(timeout: 12), "EPUB search returned no result")
        epubResult.tap()
        XCTAssertTrue(waitForDisappearance(epubQuery, timeout: 4))

        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))

        let (_, pdfReader) = openPDF()
        XCTAssertEqual(pdfReader.value as? String, "1 rendered pages")
        XCTAssertTrue(app.descendants(matching: .any)["reader-progress-pdf"].waitForExistence(timeout: 4))
        app.buttons["reader-search"].tap()
        let pdfQuery = app.textFields["reader-search-query"]
        XCTAssertTrue(pdfQuery.waitForExistence(timeout: 4))
        pdfQuery.tap()
        pdfQuery.typeText("Wonderland")
        app.buttons["reader-search-submit"].tap()
        let pdfResult = app.buttons["reader-search-result-pdf-0"]
        XCTAssertTrue(pdfResult.waitForExistence(timeout: 8), "PDF search returned no result")
        pdfResult.tap()
        XCTAssertTrue(waitForDisappearance(pdfQuery, timeout: 4))
        attachScreenshot(named: "pdf-visible")
    }

    func testSpeechKeepsPlayingAndHeaderToggleStaysAfterLeavingReader() throws {
        let (back, _) = openEPUB()
        let readerToggle = app.buttons["reader-speech-toggle"]
        XCTAssertTrue(readerToggle.waitForExistence(timeout: 10), "EPUB reader did not expose speech control")
        readerToggle.tap()
        let speaking = NSPredicate(format: "label CONTAINS[c] %@", "Stop reading aloud")
        XCTAssertTrue(
            XCTWaiter.wait(
                for: [XCTNSPredicateExpectation(predicate: speaking, object: readerToggle)],
                timeout: 8
            ) == .completed,
            "EPUB reader did not start speech before leaving the book"
        )

        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["library-book-ui-test-alice-epub"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.buttons["app-speech-toggle"].waitForExistence(timeout: 5),
            "Library header did not keep the speech control after leaving a playing book"
        )

        let search = app.tabBars.buttons["Search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        XCTAssertTrue(search.isSelected)
        XCTAssertTrue(
            app.buttons["app-speech-toggle"].waitForExistence(timeout: 5),
            "Search header did not keep the speech control while the book kept playing"
        )
    }

    func testLibrarySortControlReordersFixtureBooks() {
        let epub = app.buttons["library-book-ui-test-alice-epub"]
        let pdf = app.buttons["library-book-ui-test-alice-pdf"]
        XCTAssertTrue(epub.waitForExistence(timeout: 5))
        XCTAssertTrue(pdf.waitForExistence(timeout: 5))

        chooseSort("Progress")
        XCTAssertLessThan(pdf.frame.minY, epub.frame.minY)

        chooseSort("Title")
        XCTAssertLessThan(epub.frame.minY, pdf.frame.minY)

        chooseSort("Author")
        XCTAssertLessThan(epub.frame.minY, pdf.frame.minY)

        chooseSort("Recent")
        XCTAssertLessThan(epub.frame.minY, pdf.frame.minY)
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

    private func chooseSort(_ label: String) {
        let sort = app.buttons["library-sort"]
        XCTAssertTrue(sort.waitForExistence(timeout: 4))
        sort.tap()
        let option = app.buttons[label]
        XCTAssertTrue(option.waitForExistence(timeout: 4))
        option.tap()
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
