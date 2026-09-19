import XCTest
@testable import BookstrLogic

final class BookListFacetFiltersTests: XCTestCase {
    func testNormalizationTrimsAndLowercasesLanguageAndFormat() {
        XCTAssertEqual(BookListFacetFilters.normalizedLanguage("  PT-pt "), "pt")
        XCTAssertEqual(BookListFacetFilters.normalizedLanguage("pt-BR"), "pt")
        XCTAssertEqual(BookListFacetFilters.normalizedLanguage(nil), "")
        XCTAssertEqual(BookListFacetFilters.normalizedFormat(".EPUB"), "epub")
        XCTAssertEqual(BookListFacetFilters.normalizedFormat("FB2.ZIP"), "fb2")
        XCTAssertEqual(BookListFacetFilters.normalizedFormat(nil), "")
    }

    func testMatchesTreatsEmptyFacetsAsAll() {
        let all = BookListFacetFilters()
        XCTAssertTrue(all.matches(language: "en", format: "epub"))
        XCTAssertTrue(all.matches(language: nil, format: nil))

        let languageOnly = BookListFacetFilters(language: "pt", format: "")
        XCTAssertTrue(languageOnly.matches(language: "PT", format: "pdf"))
        XCTAssertTrue(languageOnly.matches(language: "pt-BR", format: "epub"))
        XCTAssertTrue(languageOnly.matches(language: "Português", format: "epub"))
        XCTAssertFalse(languageOnly.matches(language: "en", format: "pdf"))

        let englishOnly = BookListFacetFilters(language: "en", format: "")
        XCTAssertTrue(englishOnly.matches(language: "English", format: "epub"))
        XCTAssertTrue(englishOnly.matches(language: "eng", format: "pdf"))
        XCTAssertFalse(englishOnly.matches(language: "French", format: "epub"))

        let formatOnly = BookListFacetFilters(language: "", format: "epub")
        XCTAssertTrue(formatOnly.matches(language: "en", format: "EPUB"))
        XCTAssertFalse(formatOnly.matches(language: "en", format: "pdf"))
    }

    func testAvailableOptionsAreUniqueSortedAndSkipBlanks() {
        XCTAssertEqual(
            BookListFacetFilters.languages(from: ["en", "PT", nil, "", "en", " pt ", "pt-BR", "English", "eng"]),
            ["en", "pt"]
        )
        XCTAssertEqual(
            BookListFacetFilters.formats(from: ["EPUB", ".pdf", "epub", nil, "fb2.zip"]),
            ["epub", "fb2", "pdf"]
        )
    }

    func testSanitizeClearsStaleSelections() {
        var filters = BookListFacetFilters(language: "de", format: "cbr")
        filters.sanitize(languages: ["en", "pt"], formats: ["epub", "pdf"])
        XCTAssertEqual(filters.language, "")
        XCTAssertEqual(filters.format, "")

        filters = BookListFacetFilters(language: "en", format: "pdf")
        filters.sanitize(languages: ["en", "pt"], formats: ["epub", "pdf"])
        XCTAssertEqual(filters.language, "en")
        XCTAssertEqual(filters.format, "pdf")
    }

    func testDisplayLabelUsesUppercaseLanguageCodes() {
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "epub"), "EPUB")
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "en"), "EN")
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "English"), "EN")
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "French"), "FR")
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "Español"), "ES")
        XCTAssertEqual(BookListFacetFilters.displayLabel(for: "pt-BR"), "PT")
        XCTAssertEqual(BookListFacetFilters.languageBadge("Deutsch"), "DE")
        XCTAssertEqual(BookListFacetFilters.languageBadge("català"), "CA")
        XCTAssertNil(BookListFacetFilters.languageBadge(nil))
        XCTAssertNil(BookListFacetFilters.languageBadge("  "))
    }
}
