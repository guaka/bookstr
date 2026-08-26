import XCTest
import SwiftUI
import UIKit

@testable import BookstrIOS

final class ThemeTests: XCTestCase {
    func testReaderThemeResolvesColorScheme() {
        XCTAssertEqual(ReaderTheme.white.colorScheme, ColorScheme.light)
        XCTAssertEqual(ReaderTheme.paper.colorScheme, ColorScheme.light)
        XCTAssertEqual(ReaderTheme.night.colorScheme, ColorScheme.dark)
    }

    func testReaderThemeResolvesPrimaryColorByMode() {
        XCTAssertTrue(areColorsEquivalent(ReaderTheme.white.primary, Color.bookstrSage))
        XCTAssertTrue(areColorsEquivalent(ReaderTheme.paper.primary, Color.bookstrSage))
        XCTAssertTrue(areColorsEquivalent(ReaderTheme.night.primary, Color.bookstrLightSage))
    }

    func testReaderThemeBackgroundColorsMapToUiBackground() {
        let themes: [ReaderTheme] = [.white, .paper, .night]
        for theme in themes {
            let background = UIColor(theme.background)
            let uiBackground = theme.uiBackground

            XCTAssertTrue(areColorsEquivalent(background, uiBackground))
        }
    }

    func testScreenChromeConfigureCanBeCalledWithoutCrash() {
        ScreenChrome.configure()
    }

    private func areColorsEquivalent(
        _ lhs: UIColor,
        _ rhs: UIColor,
        file: StaticString = #filePath,
        line: UInt = #line,
    ) -> Bool {
        var lhsRed = CGFloat(0)
        var lhsGreen = CGFloat(0)
        var lhsBlue = CGFloat(0)
        var lhsAlpha = CGFloat(0)
        var rhsRed = CGFloat(0)
        var rhsGreen = CGFloat(0)
        var rhsBlue = CGFloat(0)
        var rhsAlpha = CGFloat(0)

        let lhsGot = lhs.getRed(&lhsRed, green: &lhsGreen, blue: &lhsBlue, alpha: &lhsAlpha)
        let rhsGot = rhs.getRed(&rhsRed, green: &rhsGreen, blue: &rhsBlue, alpha: &rhsAlpha)
        guard lhsGot, rhsGot else { return false }

        let tolerance = CGFloat(0.001)
        return
            abs(lhsRed - rhsRed) <= tolerance &&
            abs(lhsGreen - rhsGreen) <= tolerance &&
            abs(lhsBlue - rhsBlue) <= tolerance &&
            abs(lhsAlpha - rhsAlpha) <= tolerance
    }
}
