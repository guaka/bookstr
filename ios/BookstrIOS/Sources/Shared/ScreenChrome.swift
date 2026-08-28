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

struct RightsBadge: View {
    let rights: BookRights

    var body: some View {
        Text(rights.compactLabel)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isOpen ? Color.green : Color.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background((isOpen ? Color.green : Color.secondary).opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
            .accessibilityLabel(rights.accessibleLabel)
    }

    private var isOpen: Bool {
        rights.status == .publicDomain || rights.status == .openLicense
    }
}

struct RightsDetailsItem: Identifiable {
    let id = UUID()
    let title: String
    let author: String?
    let year: String?
    let format: String?
    let rights: BookRights
}

struct RightsDetailsView: View {
    @Environment(\.dismiss) private var dismiss
    let item: RightsDetailsItem

    var body: some View {
        NavigationStack {
            List {
                Section("Book") {
                    LabeledContent("Title", value: item.title)
                    if let author = item.author, !author.isEmpty { LabeledContent("Author", value: author) }
                    if let year = item.year, !year.isEmpty { LabeledContent("Published", value: year) }
                    if let format = item.format, !format.isEmpty { LabeledContent("Format", value: format.uppercased()) }
                }
                Section("Rights") {
                    LabeledContent("Status", value: item.rights.accessibleLabel)
                    if let license = item.rights.license { LabeledContent("Statement", value: license) }
                    if let rawURL = item.rights.licenseURL, let url = URL(string: rawURL) {
                        Link(destination: url) { LabeledContent("License URL", value: rawURL) }
                    }
                    if let source = item.rights.source { LabeledContent("Source", value: source) }
                }
            }
            .navigationTitle("Book details")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
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
