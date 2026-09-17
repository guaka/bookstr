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

/// A flexible book row with an optional cover and a consistent trailing
/// column for edition details.
struct BookListDetails: View {
    let title: String
    let author: String
    let year: String?
    let format: String?
    let language: String?
    var publisher: String? = nil
    var coverURL: String? = nil
    let rights: BookRights
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        layout {
            BookCoverView(urlString: coverURL)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(author).font(.footnote).foregroundStyle(.secondary)
                HStack(alignment: .top, spacing: 5) {
                    RightsBadge(rights: rights)
                    if let publisher, !publisher.isEmpty {
                        Text(publisher).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 3) {
                if let format { Text(format.uppercased()).font(.caption.weight(.medium)) }
                if let year { Text(year).font(.caption2) }
                if let language { Text(language.uppercased()).font(.caption2) }
            }
            .foregroundStyle(.secondary)
            .frame(width: dynamicTypeSize.isAccessibilitySize ? nil : 58, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct BackgroundSpeechToolbarModifier: ViewModifier {
    @EnvironmentObject private var playback: ReaderPlaybackSession

    func body(content: Content) -> some View {
        content.toolbar {
            if playback.showsBackgroundSpeechControl {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        playback.toggleSpeech()
                    } label: {
                        Image(systemName: playback.isSpeechPlaying ? "stop.fill" : "play.fill")
                    }
                    .accessibilityLabel(playback.isSpeechPlaying ? "Stop reading aloud" : "Read aloud")
                    .accessibilityIdentifier("app-speech-toggle")
                }
            }
        }
    }
}

extension View {
    func bookstrListRow() -> some View {
        listRowInsets(EdgeInsets(top: 9, leading: 12, bottom: 9, trailing: 12))
    }

    func bookstrScreenTitle(_ title: String) -> some View {
        self
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarRole(.editor)
            .toolbarBackground(.visible, for: .navigationBar)
            .modifier(BackgroundSpeechToolbarModifier())
    }
}
