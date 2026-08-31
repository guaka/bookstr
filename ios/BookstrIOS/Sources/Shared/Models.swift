import Foundation

enum BookFormat: String, Codable, CaseIterable, Sendable {
    case epub
    case pdf
    case fb2
    case cbr
    case cbz

    static func from(format: String?, url: String = "") -> BookFormat {
        let normalized = format?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "pdf" { return .pdf }
        if normalized == "epub" { return .epub }
        if normalized == "fb2" || normalized == "fb2.zip" { return .fb2 }
        if normalized == "cbr" { return .cbr }
        if normalized == "cbz" { return .cbz }
        let path = url.lowercased()
        if path.contains(".pdf") { return .pdf }
        if path.contains(".fb2") { return .fb2 }
        if path.contains(".cbr") { return .cbr }
        if path.contains(".cbz") { return .cbz }
        return .epub
    }
}

enum RightsStatus: String, Codable, Sendable {
    case publicDomain = "public_domain"
    case openLicense = "open_license"
    case copyrighted
    case unknown
}

struct BookRights: Equatable, Hashable, Sendable {
    var status: RightsStatus = .unknown
    var license: String?
    var licenseURL: String?
    var source: String?

    var compactLabel: String {
        switch status {
        case .publicDomain: return Self.matches(#"(?:^|[^a-z0-9])cc\s*0(?:[^a-z0-9]|$)"#, in: license) ? "CC0" : "PD"
        case .openLicense: return Self.creativeCommonsCode(license) ?? "OPEN"
        case .copyrighted, .unknown: return "©"
        }
    }

    var accessibleLabel: String {
        switch status {
        case .publicDomain: return license ?? "Public domain"
        case .openLicense: return license ?? "Open license"
        case .copyrighted: return "Copyrighted"
        case .unknown: return "No open license identified"
        }
    }

    static func normalize(
        status: String? = nil,
        license: String? = nil,
        licenseURL: String? = nil,
        source: String? = nil,
        copyright: Bool? = nil
    ) -> BookRights {
        let statement = clean(license)
        let safeURL = safeHTTPURL(clean(licenseURL) ?? firstURL(in: statement))
        let normalizedStatus = clean(status)?.lowercased().replacingOccurrences(of: "-", with: "_")
            .replacingOccurrences(of: " ", with: "_")
        let explicit: RightsStatus? = switch normalizedStatus {
        case "pd": .publicDomain
        case "open": .openLicense
        case "copyright": .copyrighted
        default: RightsStatus(rawValue: normalizedStatus ?? "")
        }
        let combined = [statement, safeURL].compactMap { $0 }.joined(separator: " ").lowercased()
        let detected: RightsStatus
        if let explicit, explicit != .unknown {
            detected = explicit
        } else if copyright == false {
            detected = .publicDomain
        } else if copyright == true {
            detected = .copyrighted
        } else if combined.contains("public domain") || combined.contains("no known copyright restrictions")
                    || combined.contains("creativecommons.org/publicdomain")
                    || matches(#"(?:^|[^a-z0-9])cc\s*0(?:[^a-z0-9]|$)"#, in: combined) {
            detected = .publicDomain
        } else if combined.contains("creative commons") || combined.contains("creativecommons.org/licenses/")
                    || matches(#"(?:^|[^a-z0-9])cc\s+(?:by|sa|nc|nd)"#, in: combined)
                    || combined.contains("gnu free documentation") || combined.contains("gfdl")
                    || combined.contains("free art license") || combined.contains("open publication license")
                    || combined.contains("unlicense") {
            detected = .openLicense
        } else if let statement = statement?.lowercased(),
                  statement.contains("all rights reserved") || statement.contains("copyrighted")
                    || statement.contains("copyright ") || statement.contains("©") {
            detected = .copyrighted
        } else {
            detected = .unknown
        }
        let normalizedStatement = statement ?? (copyright == false ? "Public domain in the U.S." : nil)
        let hasEvidence = detected != .unknown || normalizedStatement != nil || safeURL != nil
        return BookRights(status: detected, license: normalizedStatement, licenseURL: safeURL,
                          source: hasEvidence ? clean(source) : nil)
    }

    static func preferred(current: BookRights, incoming: BookRights) -> BookRights {
        if incoming.status != .unknown { return incoming }
        if current.status != .unknown { return current }
        return incoming.license != nil || incoming.licenseURL != nil || incoming.source != nil ? incoming : current
    }

    private static func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty,
              value.lowercased() != "null", value.lowercased() != "undefined" else { return nil }
        return value
    }

    private static func safeHTTPURL(_ value: String?) -> String? {
        guard let value, let url = URL(string: value), let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme), url.host != nil else { return nil }
        return url.absoluteString
    }

    private static func firstURL(in value: String?) -> String? {
        guard let value, let range = value.range(of: #"https?://[^\s<>\"']+"#, options: .regularExpression) else { return nil }
        return String(value[range]).trimmingCharacters(in: CharacterSet(charactersIn: ".,)"))
    }

    private static func matches(_ pattern: String, in value: String?) -> Bool {
        value?.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func creativeCommonsCode(_ value: String?) -> String? {
        guard let value, let range = value.range(
            of: #"(?:creative\s+commons\s+)?CC\s*[- ]?((?:BY)(?:[- ](?:SA|NC|ND)){0,2})(?:\s*(\d+(?:\.\d+)?))?"#,
            options: [.regularExpression, .caseInsensitive]
        ) else { return nil }
        let match = String(value[range]).uppercased()
            .replacingOccurrences(of: "CREATIVE COMMONS ", with: "")
            .replacingOccurrences(of: "CC-", with: "CC ")
        let components = match.split(whereSeparator: \.isWhitespace)
        guard let ccIndex = components.firstIndex(of: "CC"), components.indices.contains(ccIndex + 1) else { return nil }
        let terms = components[ccIndex + 1].replacingOccurrences(of: " ", with: "-")
        let version = components.dropFirst(ccIndex + 2).first.map(String.init)
        return "CC \(terms)" + (version.map { " \($0)" } ?? "")
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
    var language: String? = nil
    var rightsStatus: String? = nil
    var license: String? = nil
    var licenseUrl: String? = nil
    var rightsSource: String? = nil

    var rights: BookRights {
        BookRights.normalize(status: rightsStatus, license: license, licenseURL: licenseUrl, source: rightsSource)
    }
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
    var rightsStatus: String = RightsStatus.unknown.rawValue
    var license: String? = nil
    var licenseUrl: String? = nil
    var rightsSource: String? = nil

    var rights: BookRights {
        BookRights.normalize(status: rightsStatus, license: license, licenseURL: licenseUrl, source: rightsSource)
    }

    var isReadable: Bool { downloadUrl?.isEmpty == false && format != nil }

    func asCatalogBook() -> CatalogBook? {
        guard let downloadUrl, let format else { return nil }
        return CatalogBook(id: id, title: title, author: author, epubUrl: downloadUrl,
                           coverUrl: coverUrl, sourceUrl: downloadUrl, isbn: nil, libvaultMd5: nil,
                           format: format, blossomSha256: nil, year: year, language: language,
                           rightsStatus: rightsStatus, license: license, licenseUrl: licenseUrl,
                           rightsSource: rightsSource)
    }

    func asFavoriteBook() -> CatalogBook {
        CatalogBook(id: id, title: title, author: author, epubUrl: downloadUrl ?? "",
                    coverUrl: coverUrl, sourceUrl: downloadUrl, isbn: nil, libvaultMd5: nil,
                    format: format ?? .epub, blossomSha256: nil, year: year, language: language,
                    rightsStatus: rightsStatus, license: license, licenseUrl: licenseUrl,
                    rightsSource: rightsSource)
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

struct BookSnippet: Codable, Identifiable, Hashable {
    let syncId: String
    let text: String
    let bookId: String
    let bookTitle: String
    let author: String
    let isbn: String?
    let format: BookFormat
    let locator: String
    let createdAt: Int64
    let updatedAt: Int64
    let deleted: Bool

    var id: String { syncId }
}

enum ReaderTheme: String, Codable, CaseIterable {
    case white
    case paper
    case night
}

enum ReaderFont: String, Codable, CaseIterable {
    case arial
    case georgia
    case palatino
    case system

    var label: String {
        switch self {
        case .arial: "Arial"
        case .georgia: "Georgia"
        case .palatino: "Palatino"
        case .system: "System"
        }
    }
}

enum ReaderAlignment: String, Codable, CaseIterable {
    case justified
    case left

    var label: String { self == .justified ? "Justified" : "Left" }
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
    static let bookstrSnippetsDidChange = Notification.Name("bookstrSnippetsDidChange")
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
    let rightsStatus: String?
    let license: String?
    let licenseUrl: String?
    let rightsSource: String?

    init(
        bookId: String,
        bookTitle: String,
        format: BookFormat,
        author: String? = nil,
        year: String? = nil,
        locator: String? = nil,
        pageIndex: Int = 0,
        pageOffset: Int = 0,
        rightsStatus: String? = nil,
        license: String? = nil,
        licenseUrl: String? = nil,
        rightsSource: String? = nil
    ) {
        self.bookId = bookId
        self.bookTitle = bookTitle
        self.format = format
        self.author = author
        self.year = year
        self.locator = locator
        self.pageIndex = max(pageIndex, 0)
        self.pageOffset = max(pageOffset, 0)
        self.rightsStatus = rightsStatus
        self.license = license
        self.licenseUrl = licenseUrl
        self.rightsSource = rightsSource
    }
}
