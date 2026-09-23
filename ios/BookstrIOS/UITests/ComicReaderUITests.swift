import XCTest

final class ComicReaderUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing-library-fixtures"]
        app.launch()
        openLibrary()
    }

    override func tearDownWithError() throws {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testCBZDismissesKeyboardFlipsZoomsAndPans() {
        app.swipeDown()
        let filter = app.searchFields["Filter books"]
        XCTAssertTrue(filter.waitForExistence(timeout: 5), "Pulling down did not reveal the Library filter")
        filter.tap()
        filter.typeText("CBZ")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))

        let reader = openComic(id: "ui-test-comic-cbz", format: "CBZ", pageCount: 3)
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch, timeout: 4), "Opening the comic left the keyboard visible")

        reader.swipeLeft(velocity: .fast)
        XCTAssertTrue(waitForValue(reader, containing: "Page 2 of 3"), "Fit-size flick did not advance the CBZ")
        reader.swipeRight(velocity: .fast)
        XCTAssertTrue(waitForValue(reader, containing: "Page 1 of 3"), "Fit-size reverse flick did not restore the first page")

        for _ in 0..<4 { chooseZoom("Zoom Out") }
        XCTAssertTrue(waitForZoom(25), "Comic zoom did not reach its 25 percent minimum")
        app.buttons["reader-comic-zoom"].tap()
        XCTAssertFalse(app.buttons["Zoom Out"].isEnabled, "Zoom Out remained enabled below the minimum")
        app.buttons["Fit Page"].tap()
        XCTAssertTrue(waitForZoom(92))

        chooseZoom("Zoom In")
        XCTAssertTrue(waitForZoom(112), "Comic did not enlarge before the pan check")
        let start = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.78, dy: 0.78))
        let end = reader.coordinate(withNormalizedOffset: CGVector(dx: 0.22, dy: 0.22))
        start.press(forDuration: 0.8, thenDragTo: end)
        XCTAssertTrue(waitForPositiveScroll(reader), "A deliberate drag did not pan the enlarged page")
        XCTAssertTrue(waitForValue(reader, containing: "Page 1 of 3"), "Panning accidentally flipped the page")

        reader.swipeLeft(velocity: .fast)
        XCTAssertTrue(waitForValue(reader, containing: "Page 2 of 3"), "A fast flick did not flip the enlarged page")
    }

    func testFreeLicensedCBRExtractsAndFlipsPages() {
        let reader = openComic(id: "ui-test-comic-cbr", format: "CBR", pageCount: 4)
        reader.swipeLeft(velocity: .fast)
        XCTAssertTrue(waitForValue(reader, containing: "Page 2 of 4"), "Native CBR extraction opened but could not flip pages")
        reader.swipeRight(velocity: .fast)
        XCTAssertTrue(waitForValue(reader, containing: "Page 1 of 4"))
    }

    func testExplicitComicSelectionSurvivesRelaunch() {
        _ = openComic(id: "ui-test-comic-cbz", format: "CBZ", pageCount: 3)
        XCTAssertEqual(app.buttons["reader-book-details"].label, "Book details for Comic CBZ Fixture")

        app.terminate()
        app.launchArguments = [
            "--ui-testing-library-fixtures",
            "--ui-testing-preserve-library-state",
            "--ui-testing-open-continuation",
        ]
        app.launch()

        let reader = comicReader(format: "CBZ")
        XCTAssertTrue(reader.waitForExistence(timeout: 15), "Relaunch did not restore the explicitly opened comic")
        XCTAssertTrue(waitForValue(reader, containing: "Page 1 of 3"))
        XCTAssertEqual(app.buttons["reader-book-details"].label, "Book details for Comic CBZ Fixture")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Down the Rabbit-Hole")).firstMatch.exists,
            "Relaunch restored the stale EPUB instead of the comic"
        )
    }

    private func openLibrary() {
        let library = app.tabBars.buttons["Library"]
        XCTAssertTrue(library.waitForExistence(timeout: 12))
        library.tap()
        XCTAssertTrue(library.isSelected)
    }

    private func openComic(id: String, format: String, pageCount: Int) -> XCUIElement {
        let book = app.buttons["library-book-\(id)"]
        XCTAssertTrue(book.waitForExistence(timeout: 8), "Missing \(format) UI-test fixture")
        book.tap()

        XCTAssertTrue(app.buttons["reader-book-details"].waitForExistence(timeout: 10), "\(format) reader was not presented")
        let reader = comicReader(format: format)
        XCTAssertTrue(reader.waitForExistence(timeout: 15), "\(format) web reader did not appear")
        XCTAssertTrue(
            waitForValue(reader, containing: "Page 1 of \(pageCount)"),
            "\(format) did not expose \(pageCount) readable pages"
        )
        XCTAssertTrue(app.descendants(matching: .any)["reader-progress-\(format.lowercased())"].exists)
        return reader
    }

    private func comicReader(format: String) -> XCUIElement {
        app.webViews.matching(identifier: "comic-reader-webview")
            .matching(NSPredicate(format: "label == %@", "\(format) comic reader"))
            .firstMatch
    }

    private func chooseZoom(_ label: String) {
        let zoom = app.buttons["reader-comic-zoom"]
        XCTAssertTrue(zoom.waitForExistence(timeout: 4))
        zoom.tap()
        let choice = app.buttons[label]
        XCTAssertTrue(choice.waitForExistence(timeout: 4))
        choice.tap()
    }

    private func waitForZoom(_ percent: Int) -> Bool {
        let zoom = app.buttons["reader-comic-zoom"]
        let predicate = NSPredicate(format: "label CONTAINS %@", "\(percent) percent")
        return XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: zoom)],
            timeout: 5
        ) == .completed
    }

    private func waitForValue(_ element: XCUIElement, containing text: String) -> Bool {
        let predicate = NSPredicate(format: "value CONTAINS %@", text)
        return XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: element)],
            timeout: 8
        ) == .completed
    }

    private func waitForPositiveScroll(_ element: XCUIElement) -> Bool {
        let predicate = NSPredicate(
            format: "value MATCHES %@",
            ".*(horizontal|vertical) scroll [1-9][0-9]* of [1-9][0-9]*.*"
        )
        return XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: predicate, object: element)],
            timeout: 6
        ) == .completed
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        XCTWaiter.wait(
            for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)],
            timeout: timeout
        ) == .completed
    }
}
