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

    override func tearDownWithError() throws {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTorrentSearchOpensAndReopensOfflinePublication() throws {
        app.terminate()
        app.launchArguments += ["--ui-testing-torrent-fixture"]
        app.launch()
        selectTab("Search")
        let query = app.searchFields.firstMatch
        XCTAssertTrue(query.waitForExistence(timeout: 10))
        query.tap(); query.typeText("Torrent Reading Fixture\n")
        let book = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search.open.")).firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        XCTAssertTrue(book.label.contains("Fixture Author"))
        book.tap()
        XCTAssertTrue(app.buttons["downloads.done"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Torrent Reading Fixture"].exists)
        app.buttons["downloads.done"].tap()
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        query.tap(); query.typeText(" more\n")
        app.buttons["Close"].tap()
        app.buttons["search.downloads"].tap()
        let downloaded = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "downloads.open.")).firstMatch
        XCTAssertTrue(downloaded.waitForExistence(timeout: 20))
        downloaded.tap()
        let reader = app.descendants(matching: .any)["pdf-reader"]
        XCTAssertTrue(reader.waitForExistence(timeout: 20))
        app.terminate()
        app.launchArguments += ["--ui-testing-preserve-library-state", "--ui-testing-open-continuation"]
        app.launch()
        XCTAssertTrue(reader.waitForExistence(timeout: 15))
    }

    func testZlibSearchDownloadsAndReopensOfflinePublication() throws {
        app.launchArguments += ["--ui-testing-zlib-fixture"]
        try testTorrentSearchOpensAndReopensOfflinePublication()
    }

    func testCatalogInvitationConfirmationCancellationAndRelaunch() throws {
        let npub = "npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h"
        let name = "Catalog-\(UUID().uuidString.prefix(8))"
        let uri = "bookstr://catalog?v=1&npub=\(npub)&name=\(name)&relay=wss%3A%2F%2Frelay.example"
        app.open(URL(string: uri + "&nsec=secret")!)
        XCTAssertFalse(app.buttons["catalog-invitation-confirm"].exists)
        app.open(URL(string: uri)!)
        XCTAssertTrue(app.staticTexts["catalog-invitation-name"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["catalog-invitation-npub"].label, npub)
        app.buttons["catalog-invitation-cancel"].tap()
        XCTAssertFalse(app.buttons["catalog-invitation-confirm"].exists)
        app.open(URL(string: uri)!)
        XCTAssertTrue(app.buttons["catalog-invitation-confirm"].waitForExistence(timeout: 10))
        app.buttons["catalog-invitation-confirm"].tap()
        selectTab("Settings")
        XCTAssertEqual(app.staticTexts["settings-catalog-name"].label, name)
        XCTAssertEqual(app.staticTexts["settings-catalog-npub"].label, npub)
        app.terminate()
        app.open(URL(string: uri)!)
        selectTab("Settings")
        XCTAssertFalse(app.buttons["catalog-invitation-confirm"].exists)
        XCTAssertEqual(app.staticTexts["settings-catalog-name"].label, name)
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
        if englishVoice.isHittable {
            englishVoice.tap()
            let systemDefaultChoice = pickerChoice("System default")
            XCTAssertTrue(systemDefaultChoice.waitForExistence(timeout: 8))
            systemDefaultChoice.tap()
            XCTAssertTrue(
                englishVoice.waitForExistence(timeout: 4),
                "Settings did not return from the English voice picker"
            )
        }
        reveal(app.buttons["speech-model-kokoro_en"])
        XCTAssertTrue(app.buttons["speech-model-kokoro_en"].waitForExistence(timeout: 4), "Settings did not expose the Kokoro download control")
        XCTAssertTrue(app.buttons["speech-model-piper_pt_pt"].waitForExistence(timeout: 4), "Settings did not expose the Tugão download control")

        let relays = app.descendants(matching: .any)["settings-relays-editor"]
        reveal(relays)
        XCTAssertTrue(relays.waitForExistence(timeout: 5), "Settings did not expose the relay editor")
        relays.tap()
        relays.typeText("wss://relay.example\nwss://backup.example")
        let done = app.buttons["Done"]
        if done.waitForExistence(timeout: 2) { done.tap() }

        let save = app.buttons["settings-save-relays"]
        reveal(save)
        XCTAssertTrue(save.waitForExistence(timeout: 4))
        save.tap()
        XCTAssertTrue(app.staticTexts["Relays saved"].waitForExistence(timeout: 4))

        let speechLogs = app.descendants(matching: .any)["speech-debug-logs"]
        reveal(speechLogs)
        XCTAssertTrue(speechLogs.waitForExistence(timeout: 4), "Settings did not expose speech logs at the bottom")

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

    func testLibraryFixturesExposeBothReadableFormats() throws {
        XCTAssertTrue(app.buttons["library-book-ui-test-alice-epub"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["library-book-ui-test-alice-pdf"].waitForExistence(timeout: 5))
    }

    func testOpeningEPUBShowsReaderControlsAndChapter() throws {
        let epub = app.buttons["library-book-ui-test-alice-epub"]
        XCTAssertTrue(epub.waitForExistence(timeout: 5))
        epub.tap()

        XCTAssertTrue(app.buttons["reader-back"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["reader-speech-toggle"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Down the Rabbit-Hole")
            ).firstMatch.waitForExistence(timeout: 10)
        )
    }

    private func selectTab(_ label: String) {
        let tab = app.tabBars.buttons[label]
        XCTAssertTrue(tab.waitForExistence(timeout: 5), "Missing " + label + " tab")
        tab.tap()
        XCTAssertTrue(tab.isSelected, label + " tab was not selected")
    }

    private func reveal(_ element: XCUIElement) {
        for _ in 0..<24 {
            if element.exists { return }
            app.swipeUp()
        }
    }

    private func pickerChoice(_ label: String) -> XCUIElement {
        app.buttons[label].firstMatch
    }
}
