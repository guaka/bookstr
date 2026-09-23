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
    var bookID: String? = nil
    var title: String = "Book"
    var author: String = ""
#if canImport(UIKit)
    @EnvironmentObject private var coverDiscovery: CoverDiscoveryService
#endif
    @State private var localImage: BookCoverPlatformImage?

    nonisolated(unsafe) private static let localImageCache: NSCache<NSURL, BookCoverPlatformImage> = {
        let cache = NSCache<NSURL, BookCoverPlatformImage>()
        cache.totalCostLimit = 12 * 1_024 * 1_024
        return cache
    }()

    var body: some View {
        Group {
            if let url = displayedURL {
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
                            discoveredFallback
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

    private var displayedURL: URL? {
#if canImport(UIKit)
        Self.coverURL(urlString) ?? bookID.flatMap { coverDiscovery.cachedURL(for: $0) }
#else
        Self.coverURL(urlString)
#endif
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
#if canImport(UIKit)
            localImage = await Task.detached(priority: .utility) {
                Self.thumbnailImage(at: url)
            }.value
#else
            localImage = Self.thumbnailImage(at: url)
#endif
        }
    }

    nonisolated static func thumbnailImage(at url: URL) -> BookCoverPlatformImage? {
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
#if canImport(UIKit)
        Image(uiImage: CoverTitleCard.image(title: title, author: author, key: bookID ?? title))
            .resizable()
            .aspectRatio(contentMode: .fill)
#else
        ZStack { Color.secondary.opacity(0.12); Image(systemName: "book.closed").foregroundStyle(.secondary) }
#endif
    }

#if canImport(UIKit)
    @ViewBuilder
    private var discoveredFallback: some View {
        if let url = bookID.flatMap({ coverDiscovery.cachedURL(for: $0) }) {
            localCover(url)
        } else {
            placeholder
        }
    }
#else
    private var discoveredFallback: some View { placeholder }
#endif

    static let width: CGFloat = 42
    static let height: CGFloat = 62

    static func coverURL(_ value: String?) -> URL? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
              let url = URL(string: value),
              ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") else { return nil }
        return url
    }
}

#if canImport(UIKit)
enum CoverTitleCard {
    private static let cache = NSCache<NSString, UIImage>()
    private static let colors: [UIColor] = [
        UIColor(red: 0.18, green: 0.36, blue: 0.32, alpha: 1),
        UIColor(red: 0.30, green: 0.29, blue: 0.47, alpha: 1),
        UIColor(red: 0.49, green: 0.29, blue: 0.25, alpha: 1),
        UIColor(red: 0.20, green: 0.36, blue: 0.48, alpha: 1)
    ]

    static func image(title: String, author: String, key: String) -> UIImage {
        let cacheKey = "\(key)|\(title)|\(author)" as NSString
        if let cached = cache.object(forKey: cacheKey) { return cached }
        let size = CGSize(width: 320, height: 480)
        let index = key.utf8.reduce(0) { ($0 &+ Int($1)) % colors.count }
        let image = UIGraphicsImageRenderer(size: size).image { context in
            colors[index].setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.withAlphaComponent(0.48).setStroke()
            let border = UIBezierPath(rect: CGRect(x: 18, y: 18, width: 284, height: 444))
            border.lineWidth = 2
            border.stroke()
            let heading = title.isEmpty ? "Book" : title
            (heading as NSString).draw(in: CGRect(x: 34, y: 82, width: 252, height: 248), withAttributes: [
                .font: UIFont.systemFont(ofSize: 35, weight: .bold),
                .foregroundColor: UIColor.white
            ])
            (author as NSString).draw(in: CGRect(x: 34, y: 370, width: 252, height: 64), withAttributes: [
                .font: UIFont.systemFont(ofSize: 20, weight: .medium),
                .foregroundColor: UIColor.white
            ])
        }
        cache.setObject(image, forKey: cacheKey)
        return image
    }
}

@MainActor
enum CoverArtwork {
    static func image(for book: CatalogBook, discovery: CoverDiscoveryService) -> UIImage {
        if let url = BookCoverView.coverURL(book.coverUrl), url.isFileURL,
           let image = BookCoverView.thumbnailImage(at: url) { return image }
        if let url = discovery.cachedURL(for: book.id),
           let image = BookCoverView.thumbnailImage(at: url) { return image }
        return CoverTitleCard.image(title: book.title, author: book.author, key: book.id)
    }
}
#endif
