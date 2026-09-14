import Foundation

struct CatalogSearchPage {
    var books: [BookSearchResult]
    var nextOffset: Int?
    var warning: String?

    static func libcat(_ response: [String: Any], offset: Int) -> CatalogSearchPage {
        let records = response["books"] as? [[String: Any]] ?? []
        let books = records.compactMap { record -> BookSearchResult? in
            guard let md5 = record["md5"] as? String, validHash(md5, length: 32) else { return nil }
            let raw = (record["extension"] as? String ?? "").lowercased()
            let format = ["epub", "pdf", "fb2", "cbr", "cbz"].contains(raw) ? BookFormat.from(format: raw, url: "") : nil
            return BookSearchResult(id: md5.lowercased(), source: "libcat", title: record["title"] as? String ?? "Untitled",
                author: record["author"] as? String ?? "Unknown author", year: record["year"] as? String,
                publisher: record["publisher"] as? String, language: record["language"] as? String,
                format: format, downloadUrl: nil, coverUrl: nil, rating: 0, editionCount: 0,
                rightsStatus: record["rights_status"] as? String ?? "unknown", license: record["license"] as? String,
                licenseUrl: record["license_url"] as? String, rightsSource: record["rights_source"] as? String,
                libvaultMd5: md5.lowercased())
        }
        let next = response["next_offset"] as? Int
        return CatalogSearchPage(books: books, nextOffset: next.flatMap { $0 > offset ? $0 : nil })
    }
    static func validHash(_ value: String, length: Int) -> Bool {
        value.count == length && value.utf8.allSatisfy { (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }
    }
    static func merge(_ first: [BookSearchResult], _ second: [BookSearchResult]) -> [BookSearchResult] {
        var seen = Set<String>()
        return (first + second).filter { seen.insert($0.id).inserted }
    }
    static func publication(_ response: [String: Any], for book: CatalogBook) throws -> CatalogBook {
        guard let blob = response["blossom"] as? [String: Any], blob["status"] as? String == "ready",
              let hash = blob["sha256"] as? String, validHash(hash, length: 64),
              let raw = blob["url"] as? String, let url = URL(string: raw), url.scheme == "https",
              url.host == PublicationUtilities.blossomHost, url.user == nil, url.password == nil,
              url.lastPathComponent.lowercased().split(separator: ".").first.map(String.init) == hash.lowercased()
        else { throw PrivateCatalogError.rejected("This edition is not available on Blossom yet") }
        let format = BookFormat.from(format: blob["format"] as? String, url: raw)
        return CatalogBook(id: book.id, title: book.title, author: book.author, epubUrl: raw,
            coverUrl: book.coverUrl, sourceUrl: book.sourceUrl, isbn: book.isbn, libvaultMd5: book.libvaultMd5,
            format: format, blossomSha256: hash.lowercased(), year: book.year, language: book.language,
            rightsStatus: book.rightsStatus, license: book.license, licenseUrl: book.licenseUrl, rightsSource: book.rightsSource)
    }
}
