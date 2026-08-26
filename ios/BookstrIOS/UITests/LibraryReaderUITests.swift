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

    func testEPUBNavigationControlsAndPDFRenderingJourney() throws {
        let (back, chapter) = openEPUB()
        let zoomIn = app.buttons["reader-font-larger"]
        let zoomOut = app.buttons["reader-font-smaller"]
        XCTAssertTrue(zoomIn.waitForExistence(timeout: 4), "EPUB reader did not expose zoom-in button")
        XCTAssertTrue(zoomOut.waitForExistence(timeout: 4), "EPUB reader did not expose zoom-out button")
        XCTAssertTrue(zoomIn.isHittable, "zoom-in should be tappable")
        XCTAssertTrue(zoomOut.isHittable, "zoom-out should be tappable")
        zoomIn.tap()
        zoomOut.tap()

        let initialY = chapter.frame.minY

        app.swipeLeft()
        XCTAssertTrue(waitForY(chapter, below: initialY - 80), "Swiping left did not advance the EPUB")
        let afterLeftY = chapter.frame.minY

        app.swipeRight()
        XCTAssertTrue(waitForY(chapter, above: afterLeftY + 80), "Swiping right did not return to the previous EPUB page")
        attachScreenshot(named: "epub-navigation-restored")

        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))

        let pdf = app.buttons["library-book-ui-test-alice-pdf"]
        XCTAssertTrue(pdf.waitForExistence(timeout: 5))
        pdf.tap()

        let pdfReader = app.descendants(matching: .any)["pdf-reader"]
        XCTAssertTrue(pdfReader.waitForExistence(timeout: 10))
        XCTAssertEqual(pdfReader.value as? String, "1 rendered pages")
        attachScreenshot(named: "pdf-visible")
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

    private func attachScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
