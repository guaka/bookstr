import XCTest

final class AppShellUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["--ui-testing-library-fixtures"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 8))
    }

    func testPrimaryTabsOpenTheirExpectedScreens() throws {
        selectTab("Search", navigationTitle: "Search")
        selectTab("Words", navigationTitle: "Words")
        selectTab("Settings", navigationTitle: "Settings")
        selectTab("Library", navigationTitle: "Library")
    }

    func testSettingsCanSaveRelayList() throws {
        selectTab("Settings", navigationTitle: "Settings")

        let relays = app.textViews.firstMatch
        XCTAssertTrue(relays.waitForExistence(timeout: 5), "Settings did not expose the relay editor")
        relays.tap()
        relays.typeText("wss://relay.example\nwss://backup.example")

        app.buttons["Save relays"].tap()
        XCTAssertTrue(app.staticTexts["Relays saved"].waitForExistence(timeout: 4))
    }

    func testContinueReadingOpensTheMostRecentFixture() throws {
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
        XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    }

    private func selectTab(_ label: String, navigationTitle: String) {
        let tab = app.tabBars.buttons[label]
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "Missing " + label + " tab")
        tab.tap()
        XCTAssertTrue(
            app.navigationBars[navigationTitle].waitForExistence(timeout: 5),
            label + " tab did not open " + navigationTitle
        )
    }
}
