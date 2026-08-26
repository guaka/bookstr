import Foundation

enum SearchFavoriteMatcher {
    static func matches(_ result: BookSearchResult, favorite: ExternalFavorite) -> Bool {
        favorite.key == result.id
            || (result.downloadUrl?.isEmpty == false && favorite.url == result.downloadUrl)
            || (favorite.title.caseInsensitiveCompare(result.title) == .orderedSame
                && (favorite.author ?? "").caseInsensitiveCompare(result.author) == .orderedSame)
    }
}
