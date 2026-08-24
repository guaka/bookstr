import XCTest

@testable import BookstrIOS

final class AppContainerTests: XCTestCase {
    func testBootstrapProvidesWordNavigationState() {
        let container = AppContainer.bootstrap()

        XCTAssertNotNil(container.wordNavigation)
    }

    func testWordNavigationStateCanBeUsedFromContainer() {
        let container = AppContainer.bootstrap()

        container.wordNavigation.request(word: "  known-word  ")

        XCTAssertEqual(container.wordNavigation.requestedWord, "known-word")
        XCTAssertEqual(container.wordNavigation.requestToken, 1)
    }
}
