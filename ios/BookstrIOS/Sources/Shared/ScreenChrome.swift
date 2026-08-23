import SwiftUI
import UIKit

enum ScreenChrome {
    static func configure() {
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().isTranslucent = false
    }
}

/// Cancels the unused top safe-area gap left after hiding the status bar.
struct TopSafeAreaCollapser: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        ProbeView()
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    private final class ProbeView: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            collapse()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            collapse()
        }

        private func collapse() {
            guard let window, let root = window.rootViewController else { return }
            let top = window.safeAreaInsets.top
            if root.additionalSafeAreaInsets.top != -top {
                root.additionalSafeAreaInsets.top = -top
            }
        }
    }
}

extension View {
    func bookstrScreenTitle(_ title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarRole(.editor)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
