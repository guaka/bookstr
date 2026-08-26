import XCTest
@testable import BookstrIOS

final class Nip46ErrorTests: XCTestCase {
    func testNip46ErrorDescriptionsCoverAllKnownErrors() {
        XCTAssertEqual(Nip46Error.missingRelay.errorDescription, "Add at least one valid relay URL")
        XCTAssertEqual(Nip46Error.sessionNotStarted.errorDescription, "Start a NIP-46 QR session first")
        XCTAssertEqual(Nip46Error.notConnected.errorDescription, "NIP-46 signer is not connected")
        XCTAssertEqual(
            Nip46Error.timedOut.errorDescription,
            "Amber did not respond in time. Open Amber, approve decrypt, then pull to refresh."
        )
        XCTAssertEqual(
            Nip46Error.payloadTooLarge(128).errorDescription,
            "Favorites list is 128 characters—too large for this signer request. Reconnect Nostr so Bookstr can republish it in smaller pieces, then pull to refresh."
        )
    }
}
