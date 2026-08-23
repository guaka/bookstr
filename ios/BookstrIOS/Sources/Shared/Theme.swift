import SwiftUI
import UIKit

extension Color {
    static let bookstrSage = Color(red: 47 / 255, green: 93 / 255, blue: 80 / 255)
    static let bookstrTerracotta = Color(red: 199 / 255, green: 75 / 255, blue: 50 / 255)
    static let bookstrHighlightGold = Color(red: 231 / 255, green: 199 / 255, blue: 102 / 255)
    static let bookstrLightSage = Color(red: 127 / 255, green: 184 / 255, blue: 167 / 255)
}

extension ReaderTheme {
    var colorScheme: ColorScheme {
        self == .night ? .dark : .light
    }

    var background: Color {
        switch self {
        case .white: return Color(red: 1, green: 1, blue: 1)
        case .paper: return Color(red: 247 / 255, green: 243 / 255, blue: 234 / 255)
        case .night: return Color(red: 18 / 255, green: 18 / 255, blue: 18 / 255)
        }
    }

    var uiBackground: UIColor {
        UIColor(background)
    }

    var primary: Color {
        self == .night ? .bookstrLightSage : .bookstrSage
    }
}
