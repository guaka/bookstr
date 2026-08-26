import XCTest
import NostrCore
@testable import BookstrIOS

final class NostrIdentityTests: XCTestCase {
    func testHexPublicKeyFromTrimmedNpub() {
        let npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        let expected = (try? PublicKey(npub: npub))?.hex.lowercased()
        XCTAssertEqual(NostrIdentity.hexPublicKey(from: "  \(npub)  "), expected)
    }

    func testHexPublicKeyRejectsInvalidValue() {
        XCTAssertNil(NostrIdentity.hexPublicKey(from: "not-a-key"))
        XCTAssertNil(NostrIdentity.hexPublicKey(from: "   "))
    }

    func testNpubFromHexNormalizesCasingAndRoundTrips() {
        let npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        let hex = (try? PublicKey(npub: npub))?.hex ?? ""
        let uppercaseHex = hex.uppercased()
        let derivedNpub = NostrIdentity.npub(fromHex: uppercaseHex)
        let expected = (try? PublicKey(hex: hex))?.npub

        XCTAssertNotNil(derivedNpub)
        XCTAssertEqual(derivedNpub, expected)
    }

    func testHexPublicKeyRejectsBadHexLength() {
        XCTAssertNil(NostrIdentity.hexPublicKey(from: "abcd"))
    }

    func testNpubFromHexRejectsInvalidFormat() {
        XCTAssertNil(NostrIdentity.npub(fromHex: "not-a-key"))
    }

    func testNpubFromHexRejectsEmptyString() {
        XCTAssertNil(NostrIdentity.npub(fromHex: ""))
    }

    func testHexPublicKeyRejectsLeadingAndTrailingWhitespaceForShortValue() {
        XCTAssertNil(NostrIdentity.hexPublicKey(from: "  deadbeef  "))
    }

    func testNpubFromHexPreservesLowercaseOutput() {
        let npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        let uppercaseHex = ((try? PublicKey(npub: npub))?.hex ?? "").uppercased()

        XCTAssertEqual(NostrIdentity.npub(fromHex: uppercaseHex), npub)
    }

    func testHexPublicKeyFromUppercaseHexReturnsLowercase() {
        let npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        let uppercaseHex = ((try? PublicKey(npub: npub))?.hex ?? "").uppercased()

        XCTAssertEqual(NostrIdentity.hexPublicKey(from: uppercaseHex), uppercaseHex.lowercased())
    }

    func testNpubFromHexIgnoresSurroundingWhitespace() {
        let npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        let hex = (try? PublicKey(npub: npub))?.hex ?? ""
        let wrapped = "  \(hex) \n"

        XCTAssertEqual(NostrIdentity.npub(fromHex: wrapped), npub)
    }
}
