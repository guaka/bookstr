import Foundation

enum BookFormat: String, Codable, CaseIterable, Sendable {
    case epub
    case pdf

    static func from(format: String?, url: String = "") -> BookFormat {
        let normalized = format?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "pdf" { return .pdf }
        if normalized == "epub" { return .epub }
        return url.lowercased().contains(".pdf") ? .pdf : .epub
    }
}

struct CatalogBook: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let author: String
    let epubUrl: String
    let coverUrl: String?
    let sourceUrl: String?
    let isbn: String?
    let libvaultMd5: String?
    let format: BookFormat
    let blossomSha256: String?
    let year: String?
}

struct BookSearchResult: Identifiable, Hashable {
    let id: String
    let source: String
    let title: String
    let author: String
    let year: String?
    let publisher: String?
    let language: String?
    let format: BookFormat?
    let downloadUrl: String?
    let coverUrl: String?
    let rating: Double
    let editionCount: Int

    var isReadable: Bool { downloadUrl?.isEmpty == false && format != nil }

    func asCatalogBook() -> CatalogBook? {
        guard let downloadUrl, let format else { return nil }
        return CatalogBook(id: id, title: title, author: author, epubUrl: downloadUrl,
                           coverUrl: coverUrl, sourceUrl: downloadUrl, isbn: nil, libvaultMd5: nil,
                           format: format, blossomSha256: nil, year: year)
    }

    func asFavoriteBook() -> CatalogBook {
        CatalogBook(id: id, title: title, author: author, epubUrl: downloadUrl ?? "",
                    coverUrl: coverUrl, sourceUrl: downloadUrl, isbn: nil, libvaultMd5: nil,
                    format: format ?? .epub, blossomSha256: nil, year: year)
    }
}

struct BookProgress: Codable, Hashable {
    let bookId: String
    var progression: Double
    var cfi: String
    var updatedAt: Int64
}

struct VocabularyWord: Codable, Identifiable, Hashable {
    let key: String
    let word: String
    let language: String
    let syncId: String
    let bookId: String
    let bookTitle: String
    let cfi: String
    let contextSentence: String
    let partOfSpeech: String
    let definitions: [String]
    let translation: String?
    let sourceUrl: String
    let lookupCount: Int
    let firstSeenAt: Int64
    let lastSeenAt: Int64
    let deleted: Bool

    var id: String { key }
}

enum ReaderTheme: String, Codable, CaseIterable {
    case white
    case paper
    case night
}

enum NostrAuthMode: String, Codable, CaseIterable {
    case none
    case nsec
    case amber
    case nip46
}

extension Notification.Name {
    static let bookstrIdentityDidChange = Notification.Name("bookstrIdentityDidChange")
    static let bookstrVocabularyDidChange = Notification.Name("bookstrVocabularyDidChange")
    static let bookstrDictionariesDidChange = Notification.Name("bookstrDictionariesDidChange")
    static let bookstrAmberAuth = Notification.Name("bookstrAmberAuth")
}

struct ReaderSession: Codable {
    let bookId: String
    let bookTitle: String
    let format: BookFormat
    let author: String?
    let year: String?
    let locator: String?
    let pageIndex: Int
    let pageOffset: Int
}
