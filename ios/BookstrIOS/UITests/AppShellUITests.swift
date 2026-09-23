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

    func testDutchNeuralVoiceIsOfferedInSettings() throws {
        selectTab("Settings")
        let language = app.descendants(matching: .any)["speech-language"]
        reveal(language)
        XCTAssertTrue(language.waitForExistence(timeout: 5))
        language.tap()
        app.buttons["Dutch"].tap()
        let download = app.buttons["speech-model-piper_nl_nl_dii"]
        reveal(download)
        XCTAssertTrue(download.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["speech-voice-nl"].exists)
    }

    func testDownloadedDutchVoiceIsAutomaticallySelected() throws {
        selectTab("Settings")
        let language = app.descendants(matching: .any)["speech-language"]
        reveal(language)
        language.tap()
        app.buttons["Dutch"].tap()
        let remove = app.buttons["speech-model-remove-piper_nl_nl_dii"]
        if remove.exists { remove.tap() }
        let download = app.buttons["speech-model-piper_nl_nl_dii"]
        reveal(download)
        XCTAssertTrue(download.waitForExistence(timeout: 5))
        download.tap()
        XCTAssertTrue(remove.waitForExistence(timeout: 180), "The Dutch model must finish downloading")
        let voice = app.descendants(matching: .any)["speech-voice-nl"]
        XCTAssertTrue(voice.waitForExistence(timeout: 5))
        XCTAssertTrue(voice.staticTexts["Dii · Nederlands"].exists, voice.debugDescription)
    }

    func testDownloadedBookAppearsInLibraryBeforeOpening() throws {
        app.terminate()
        app.launchArguments += ["--ui-testing-torrent-fixture"]
        app.launch()
        selectTab("Search")
        let query = app.searchFields.firstMatch
        XCTAssertTrue(query.waitForExistence(timeout: 10))
        query.tap()
        query.typeText("Torrent Reading Fixture\n")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "search.open.")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 10))
        let id = String(result.identifier.dropFirst("search.open.".count))
        result.tap()
        XCTAssertTrue(app.buttons["downloads.done"].waitForExistence(timeout: 10))
        app.buttons["downloads.done"].tap()
        selectTab("Library")
        XCTAssertTrue(app.buttons["library-book-\(id)"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["pdf-reader"].exists)
    }

    func testZlibSearchDownloadsAndReopensOfflinePublication() throws {
        app.launchArguments += ["--ui-testing-zlib-fixture"]
        try testTorrentSearchOpensAndReopensOfflinePublication()
    }

    func testCompactBookRowsUseScreenWidth() throws {
        let epub = app.buttons["library-book-ui-test-alice-epub"]
        let pdf = app.buttons["library-book-ui-test-alice-pdf"]
        XCTAssertTrue(epub.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(epub.frame.width, app.frame.width - 32)
        XCTAssertEqual(epub.staticTexts["EPUB"].frame.maxX, pdf.staticTexts["PDF"].frame.maxX, accuracy: 1)
        XCTAssertLessThanOrEqual(epub.staticTexts["Alice EPUB Fixture"].frame.height, 19)
        let libraryScreenshot = XCTAttachment(screenshot: app.screenshot())
        libraryScreenshot.name = "Compact Library"
        libraryScreenshot.lifetime = .keepAlways
        add(libraryScreenshot)
        app.terminate()
        app.launchArguments += ["--ui-testing-torrent-fixture", "--ui-testing-torrent-multiple"]
        app.launch()
        selectTab("Search")
        let query = app.searchFields["Title, author, ISBN, publisher"]
        query.tap(); query.typeText("Torrent\n")
        let book = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "search.open.", "Torrent Reading Fixture")).element
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        XCTAssertTrue(book.label.contains("Fixture Press"))
        XCTAssertLessThanOrEqual(book.frame.minX, 13)
        XCTAssertGreaterThanOrEqual(book.frame.width, app.frame.width - 80)
    }

    func testBookRowsStackEditionDetailsForAccessibilityText() throws {
        app.terminate()
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let book = app.buttons["library-book-ui-test-alice-epub"]
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        let title = book.staticTexts["Alice EPUB Fixture"]
        let format = book.staticTexts["EPUB"]
        XCTAssertGreaterThan(title.frame.height, 25)
        XCTAssertGreaterThanOrEqual(format.frame.minY, title.frame.maxY)
        XCTAssertLessThanOrEqual(book.frame.maxX, app.frame.maxX)
    }

    func testSearchFieldsStayBelowCameraWhenFocused() throws {
        let library = app.searchFields["Filter books"]
        if !library.isHittable { app.swipeDown() }
        XCTAssertTrue(library.waitForExistence(timeout: 5))
        library.tap()
        library.typeText("Alice")
        XCTAssertGreaterThanOrEqual(library.frame.minY, 54)
        app.buttons["Close"].tap()
        selectTab("Search")
        let search = app.searchFields["Title, author, ISBN, publisher"]
        search.tap()
        search.typeText("author")
        XCTAssertGreaterThanOrEqual(search.frame.minY, 54)
    }

    func testConcurrentTorrentDownloadsRestoreAfterRelaunch() throws {
        app.terminate()
        app.launchArguments += ["--ui-testing-torrent-fixture", "--ui-testing-torrent-multiple", "--ui-testing-torrent-pending"]
        app.launch()
        selectTab("Search")
        let query = app.searchFields["Title, author, ISBN, publisher"]
        query.tap(); query.typeText("Torrent\n")
        let first = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "search.open.", "Torrent Reading Fixture")).element
        let second = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND label BEGINSWITH %@", "search.open.", "Second Torrent Fixture")).element
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        let firstID = String(first.identifier.dropFirst("search.open.".count))
        let secondID = String(second.identifier.dropFirst("search.open.".count))
        first.tap()
        XCTAssertTrue(app.buttons["downloads.done"].waitForExistence(timeout: 5))
        app.buttons["downloads.done"].tap()
        second.tap()
        for id in [firstID, secondID] {
            let status = app.staticTexts["downloads.status.\(id)"]
            expectation(for: NSPredicate(format: "label == %@", "Finding peers…"), evaluatedWith: status)
        }
        waitForExpectations(timeout: 15)
        app.terminate()
        app.launchArguments.removeAll { $0 == "--ui-testing-torrent-pending" }
        app.launchArguments += ["--ui-testing-preserve-library-state", "--ui-testing-torrent-offline"]
        app.launch()
        selectTab("Search")
        app.buttons["search.downloads"].tap()
        for id in [firstID, secondID] {
            XCTAssertTrue(app.buttons["downloads.open.\(id)"].waitForExistence(timeout: 20))
        }
        app.terminate()
        app.launch()
        selectTab("Search")
        app.buttons["search.downloads"].tap()
        for id in [firstID, secondID] {
            XCTAssertTrue(app.buttons["downloads.open.\(id)"].waitForExistence(timeout: 10))
        }
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
        let speechLanguage = app.descendants(matching: .any)["speech-language"]
        XCTAssertTrue(speechLanguage.waitForExistence(timeout: 5), "Settings did not expose the speech language picker")
        XCTAssertTrue(englishVoice.waitForExistence(timeout: 5), "Settings did not expose the English voice picker")
        XCTAssertTrue(app.descendants(matching: .any)["reader-font"].waitForExistence(timeout: 4))
        XCTAssertTrue(app.descendants(matching: .any)["reader-alignment"].waitForExistence(timeout: 4))
        reveal(speechLanguage)
        if speechLanguage.isHittable {
            speechLanguage.tap()
            let portugueseChoice = pickerChoice("Portuguese")
            if portugueseChoice.waitForExistence(timeout: 4) {
                portugueseChoice.tap()
                let portugueseVoice = app.descendants(matching: .any)["speech-voice-pt"]
                XCTAssertTrue(portugueseVoice.waitForExistence(timeout: 4), "Settings did not expose the Portuguese voice picker")
            }
            if speechLanguage.isHittable {
                speechLanguage.tap()
                let englishChoice = pickerChoice("English")
                if englishChoice.waitForExistence(timeout: 4) {
                    englishChoice.tap()
                }
            }
        }
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
        XCTAssertFalse(app.staticTexts["Speech speed"].exists)
        reveal(speechLanguage)
        if speechLanguage.isHittable {
            speechLanguage.tap()
            let portugueseChoice = pickerChoice("Portuguese")
            if portugueseChoice.waitForExistence(timeout: 4) {
                portugueseChoice.tap()
                XCTAssertTrue(
                    app.buttons["speech-model-piper_pt_pt"].waitForExistence(timeout: 4),
                    "Settings did not expose the Tugão download control for Portuguese"
                )
                XCTAssertTrue(app.buttons["speech-model-piper_pt_pt_miro"].waitForExistence(timeout: 2))
                XCTAssertTrue(app.buttons["speech-model-piper_pt_pt_dii"].waitForExistence(timeout: 2))
            }
            if speechLanguage.isHittable {
                speechLanguage.tap()
                let frenchChoice = pickerChoice("French")
                if frenchChoice.waitForExistence(timeout: 4) {
                    frenchChoice.tap()
                    XCTAssertTrue(
                        app.buttons["speech-model-piper_fr_fr"].waitForExistence(timeout: 4),
                        "Settings did not expose the French Miro download control"
                    )
                }
            }
            if speechLanguage.isHittable {
                speechLanguage.tap()
                let englishChoice = pickerChoice("English")
                if englishChoice.waitForExistence(timeout: 4) {
                    englishChoice.tap()
                }
            }
        }
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
        XCTAssertTrue(app.buttons["reader-book-details"].waitForExistence(timeout: 10))
        exitReaderToLibrary()
        XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 5))

        let continueTab = app.tabBars.buttons["Continue reading"]
        XCTAssertTrue(continueTab.waitForExistence(timeout: 5))
        continueTab.tap()

        XCTAssertTrue(app.buttons["reader-book-details"].waitForExistence(timeout: 10), "Continue reading did not open the reader")
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Down the Rabbit-Hole")
            ).firstMatch.waitForExistence(timeout: 10),
            "Continued EPUB did not expose its chapter text"
        )
        exitReaderToLibrary()
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

        XCTAssertTrue(app.buttons["reader-book-details"].waitForExistence(timeout: 10))
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

    private func exitReaderToLibrary() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.96)).tap()
        let library = app.buttons["reader-pane-library"]
        XCTAssertTrue(library.waitForExistence(timeout: 4))
        library.tap()
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
