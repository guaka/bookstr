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
                author: [record["authors"], record["author"]].compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }.first(where: { !$0.isEmpty }) ?? "Unknown author", year: record["year"] as? String,
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
}
