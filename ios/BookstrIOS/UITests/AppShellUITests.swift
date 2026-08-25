import XCTest

final class AppShellUITests: XCTestCase {
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

    func testPrimaryTabsOpenTheirExpectedScreens() throws {
        selectTab("Search")
        selectTab("Words")
        selectTab("Settings")
        selectTab("Library")
    }

    func testSettingsCanSaveRelayList() throws {
        selectTab("Settings")

        let relays = app.textViews.firstMatch
        XCTAssertTrue(relays.waitForExistence(timeout: 5), "Settings did not expose the relay editor")
        relays.tap()
        relays.typeText("wss://relay.example\nwss://backup.example")
        let done = app.buttons["Done"]
        if done.waitForExistence(timeout: 2) { done.tap() }

        let save = app.buttons["Save relays"]
        XCTAssertTrue(save.waitForExistence(timeout: 4))
        save.tap()
        XCTAssertTrue(app.staticTexts["Relays saved"].waitForExistence(timeout: 4))
    }

    func testContinueReadingOpensTheMostRecentFixture() throws {
        let epub = app.buttons["library-book-ui-test-alice-epub"]
        XCTAssertTrue(epub.waitForExistence(timeout: 5))
        epub.tap()
        let initialBack = app.buttons["reader-back"]
        XCTAssertTrue(initialBack.waitForExistence(timeout: 10))
        initialBack.tap()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))

        let continueTab = app.tabBars.buttons["Continue reading"]
        XCTAssertTrue(continueTab.waitForExistence(timeout: 5))
        continueTab.tap()

        let back = app.buttons["reader-back"]
        XCTAssertTrue(back.waitForExistence(timeout: 10), "Continue reading did not open the reader")
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Down the Rabbit-Hole")
            ).firstMatch.waitForExistence(timeout: 10),
            "Continued EPUB did not expose its chapter text"
        )
        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))
    }

    private func selectTab(_ label: String) {
        let tab = app.tabBars.buttons[label]
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "Missing " + label + " tab")
        tab.tap()
        XCTAssertTrue(tab.isSelected, label + " tab was not selected")
    }
}
