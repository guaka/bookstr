import SwiftUI
import ImageIO
#if canImport(UIKit)
import UIKit
typealias BookCoverPlatformImage = UIImage
#endif
#if canImport(AppKit)
import AppKit
typealias BookCoverPlatformImage = NSImage
#endif

/// Fixed-size cover thumbnail used across library rows and search results.
/// `urlString` is either a remote https URL or a local file URL produced by
/// the embedded-cover cache.
struct BookCoverView: View {
    let urlString: String?
    @State private var localImage: BookCoverPlatformImage?

    private static let localImageCache: NSCache<NSURL, BookCoverPlatformImage> = {
        let cache = NSCache<NSURL, BookCoverPlatformImage>()
        cache.totalCostLimit = 12 * 1_024 * 1_024
        return cache
    }()

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
        Group {
            if let localImage {
#if canImport(UIKit)
                Image(uiImage: localImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
#else
                Image(nsImage: localImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
#endif
            } else {
                placeholder
            }
        }
        .task(id: url) {
            localImage = nil
            localImage = await Task.detached(priority: .utility) {
                Self.thumbnailImage(at: url)
            }.value
        }
    }

    static func thumbnailImage(at url: URL) -> BookCoverPlatformImage? {
        if let cached = localImageCache.object(forKey: url as NSURL) { return cached }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceThumbnailMaxPixelSize: 256,
              ] as CFDictionary)
        else { return nil }
#if canImport(UIKit)
        let image = UIImage(cgImage: cgImage)
#else
        let image = NSImage(cgImage: cgImage, size: .zero)
#endif
        localImageCache.setObject(image, forKey: url as NSURL, cost: cgImage.bytesPerRow * cgImage.height)
        return image
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
