import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

/// Fixed-size cover thumbnail used across library rows and search results.
/// `urlString` is either a remote https URL or a local file URL produced by
/// the embedded-cover cache.
struct BookCoverView: View {
    let urlString: String?

    var body: some View {
        Group {
            if let url = Self.coverURL(urlString) {
                if url.isFileURL {
                    localCover(url)
                } else {
                    AsyncImage(url: url, transaction: Transaction(animation: nil)) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        default:
                            placeholder
                        }
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: Self.width, height: Self.height)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .strokeBorder(.quaternary, lineWidth: 0.5)
        )
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func localCover(_ url: URL) -> some View {
#if canImport(UIKit)
        if let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            placeholder
        }
#else
        if let image = NSImage(contentsOf: url) {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            placeholder
        }
#endif
    }

    private var placeholder: some View {
        ZStack {
            Rectangle().fill(.quaternary)
            Image(systemName: "book.closed")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    static let width: CGFloat = 42
    static let height: CGFloat = 62

    static func coverURL(_ value: String?) -> URL? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
              let url = URL(string: value),
              ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
}
