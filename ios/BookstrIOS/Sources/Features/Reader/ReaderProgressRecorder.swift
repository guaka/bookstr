import Foundation

enum ReaderProgressRecorder {
    static func record(
        book: CatalogBook,
        format: BookFormat,
        progression: Double,
        locator: String,
        rights: BookRights? = nil,
        progressRepository: ProgressRepository,
        settingsRepository: SettingsRepository
    ) {
        progressRepository.save(bookId: book.id, progression: progression, cfi: locator)
        settingsRepository.saveReaderSession(
            session(book: book, format: format, locator: locator, rights: rights)
        )
    }

    static func session(
        book: CatalogBook,
        format: BookFormat,
        locator: String?,
        pageIndex: Int? = nil,
        rights: BookRights? = nil
    ) -> ReaderSession {
        ReaderSession(
            bookId: book.id,
            bookTitle: book.title,
            format: format,
            author: book.author,
            year: book.year,
            locator: locator,
            pageIndex: pageIndex ?? resolvedPageIndex(for: format, locator: locator),
            pageOffset: 0,
            rightsStatus: rights?.status.rawValue ?? book.rightsStatus,
            license: rights?.license ?? book.license,
            licenseUrl: rights?.licenseURL ?? book.licenseUrl,
            rightsSource: rights?.source ?? book.rightsSource
        )
    }

    static func resolvedPageIndex(for format: BookFormat, locator: String?) -> Int {
        guard let locator else { return 0 }
        switch format {
        case .cbr, .cbz:
            guard locator.hasPrefix("comic:") else { return 0 }
            return max(0, locator.split(separator: ":").dropFirst().first.flatMap { Int($0) } ?? 0)
        case .pdf:
            return locator.split(separator: ":").dropFirst().first.flatMap { Int($0) } ?? 0
        case .epub, .fb2:
            return 0
        }
    }
}
