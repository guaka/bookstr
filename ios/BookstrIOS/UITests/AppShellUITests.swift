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

    func testNavigationSettingsAndContinueReadingJourney() throws {
        selectTab("Search")
        selectTab("Words")
        selectTab("Settings")

        let englishVoice = app.descendants(matching: .any)["speech-voice-en"]
        let portugueseVoice = app.descendants(matching: .any)["speech-voice-pt"]
        XCTAssertTrue(englishVoice.waitForExistence(timeout: 5), "Settings did not expose the English voice picker")
        XCTAssertTrue(portugueseVoice.waitForExistence(timeout: 5), "Settings did not expose the Portuguese voice picker")
        XCTAssertTrue(app.descendants(matching: .any)["reader-font"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["reader-alignment"].waitForExistence(timeout: 4))
        reveal(englishVoice)
        englishVoice.tap()
        XCTAssertTrue(pickerChoice("Kokoro · English").waitForExistence(timeout: 8))
        dismissSettingsPicker()
        reveal(portugueseVoice)
        portugueseVoice.tap()
        XCTAssertTrue(pickerChoice("Tugão · Português (Portugal)").waitForExistence(timeout: 8))
        dismissSettingsPicker()
        XCTAssertTrue(app.buttons["speech-model-kokoro_en"].waitForExistence(timeout: 4), "Settings did not expose the Kokoro download control")
        XCTAssertTrue(app.buttons["speech-model-piper_pt_pt"].waitForExistence(timeout: 4), "Settings did not expose the Tugão download control")

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

        selectTab("Library")
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

    private func reveal(_ element: XCUIElement) {
        for _ in 0..<8 where !element.isHittable {
            app.swipeUp()
        }
    }

    private func pickerChoice(_ label: String) -> XCUIElement {
        app.descendants(matching: .any)[label]
    }

    private func dismissSettingsPicker() {
        if app.navigationBars.buttons["Settings"].waitForExistence(timeout: 2) {
            app.navigationBars.buttons["Settings"].tap()
        } else {
            app.swipeDown()
        }
    }
}
