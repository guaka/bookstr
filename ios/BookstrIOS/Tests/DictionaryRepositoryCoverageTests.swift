import XCTest
import SQLite3
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class DictionaryRepositoryCoverageTests: XCTestCase {
    private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private func pack(_ id: String, installed: Bool = false) -> DictionaryPack {
        let parts = id.split(separator: "-").map(String.init)
        return DictionaryPack(
            id: id,
            label: id,
            sourceLanguage: parts[0],
            targetLanguage: parts[1],
            installed: installed,
            bytes: installed ? 2048 : 0
        )
    }

    private func makeDictionary(at directory: URL, id: String, rows: [(String, String, String)]) throws {
        let url = directory.appendingPathComponent("\(id).sqlite3")
        var database: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &database), SQLITE_OK)
        let opened = try XCTUnwrap(database)
        defer { sqlite3_close(opened) }
        XCTAssertEqual(sqlite3_exec(
            opened,
            "CREATE TABLE translation_grouped (written_rep TEXT, trans_list TEXT, sense_list TEXT, score INTEGER, importance INTEGER)",
            nil,
            nil,
            nil
        ), SQLITE_OK)
        for row in rows {
            var statement: OpaquePointer?
            XCTAssertEqual(sqlite3_prepare_v2(
                opened,
                "INSERT INTO translation_grouped VALUES (?, ?, ?, 1, 1)",
                -1,
                &statement,
                nil
            ), SQLITE_OK)
            let prepared = try XCTUnwrap(statement)
            _ = row.0.withCString { sqlite3_bind_text(prepared, 1, $0, -1, sqliteTransient) }
            _ = row.1.withCString { sqlite3_bind_text(prepared, 2, $0, -1, sqliteTransient) }
            _ = row.2.withCString { sqlite3_bind_text(prepared, 3, $0, -1, sqliteTransient) }
            XCTAssertEqual(sqlite3_step(prepared), SQLITE_DONE)
            sqlite3_finalize(prepared)
        }
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("bookstr-dictionary-coverage-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    func testPairSelectionNormalizesWithoutPreferredLanguages() {
        let packs = [pack("de-es"), pack("de-fr"), pack("fr-de"), pack("en-de", installed: true)]
        XCTAssertEqual(DictionaryPairSelection(source: "x", target: "x").availablePacks(in: packs).count, 3)
        XCTAssertEqual(DictionaryPairSelection(source: "x", target: "x").sources(in: packs), ["de", "fr"])
        XCTAssertEqual(DictionaryPairSelection(source: "de", target: "x").targets(in: packs), ["es", "fr"])

        var selection = DictionaryPairSelection(source: "x", target: "x")
        selection.normalize(using: packs)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "de", target: "es"))
        selection.selectTarget("fr", using: packs)
        XCTAssertEqual(selection.selectedPack(in: packs)?.id, "de-fr")

        var empty = DictionaryPairSelection()
        empty.selectSource("de", using: [pack("de-en", installed: true)])
        XCTAssertEqual(empty, DictionaryPairSelection(source: "", target: ""))
    }

    func testPackInventoryAndLanguageMatching() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try makeDictionary(at: directory, id: "en-pt", rows: [("hello", "olá", "greeting")])
        let repository = DictionaryRepository(packDirectory: directory)
        let installed = try XCTUnwrap(repository.packs().first { $0.id == "en-pt" })
        XCTAssertTrue(installed.installed)
        XCTAssertGreaterThan(installed.bytes, 0)
        XCTAssertTrue(repository.hasInstalledPack(for: "EN-US"))
        XCTAssertFalse(repository.hasInstalledPack(for: "xx"))
        repository.removePack("en-pt")
        XCTAssertFalse(repository.hasInstalledPack(for: "en"))
    }

    func testOfflineLookupSortsTargetsAndCleansRows() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let rows = [
            ("hello", "goodbye | farewell", ""),
            ("hello", "goodbye | farewell", "greeting"),
            ("hello", "", "")
        ]
        try makeDictionary(at: directory, id: "en-de", rows: rows)
        try makeDictionary(at: directory, id: "en-pt", rows: rows)
        let repository = DictionaryRepository(packDirectory: directory)

        let all = repository.lookupAllInstalled(word: "HELLO")
        XCTAssertEqual(all.map(\.language), ["en"])
        XCTAssertEqual(all.first?.definitions, [
            "PT · goodbye, farewell", "PT · goodbye, farewell — greeting",
            "DE · goodbye, farewell", "DE · goodbye, farewell — greeting"
        ])
        XCTAssertTrue(repository.lookupAllInstalled(word: "unknown").isEmpty)
        XCTAssertTrue(repository.lookupAllInstalled(word: " ").isEmpty)
    }

    func testParserAndMergeHelpersCoverFallbacks() async throws {
        let repository = DictionaryRepository()
        XCTAssertEqual(repository.translation(from: "- Inglês: [[hello]], world; later"), "hello")
        XCTAssertNil(repository.translation(from: "English: hello"))
        XCTAssertNil(repository.translation(from: "Inglês:    "))
        XCTAssertEqual(repository.translation(fromHTML: "<b>Inglês</b>: hello"), "hello")
        XCTAssertNil(repository.translation(fromHTML: "<b>English</b>: hello"))

        XCTAssertTrue(repository.isHeadwordPronunciation("run.v, verb"))
        XCTAssertFalse(repository.isHeadwordPronunciation("run"))
        XCTAssertEqual(repository.languageFor(context: "Uma ação por pessoa"), "pt")
        XCTAssertEqual(repository.languageFor(context: "A simple sentence"), "en")

        let merged = repository.merge(
            inflection: DictionaryLookup(
                word: "words", language: "en", partOfSpeech: "Inflection",
                definitions: [""], translation: "fallback", sourceUrl: "source"
            ),
            lemma: DictionaryLookup(
                word: "word", language: "en", partOfSpeech: "", 
                definitions: ["one", "one", "two", "three", "four", "five"],
                translation: nil, sourceUrl: "lemma"
            )
        )
        XCTAssertEqual(merged.partOfSpeech, "Inflection")
        XCTAssertEqual(merged.translation, "fallback")
        XCTAssertEqual(merged.definitions, ["one", "two", "three", "four"])

        do {
            _ = try await repository.lookup(word: " ", language: "en", context: "")
            XCTFail("Whitespace should not be looked up")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .badURL)
        }
    }

    func testEnglishExtractFiltersNoiseAndUsesTranslationFallback() {
        let extract = """
        ==English==
        ===Noun===
        apple.n
        IPA: /ˈæpəl/
        A fruit.
        A fruit.
        a
        Rhymes: -aple
        Hyphenation: ap-ple
        ===Etymology===
        Latin origin
        ===Tradução===
        Inglês: [[maçã]], fruit; extra
        ===Verb===
        to apple
        """
        let parsed = DictionaryRepository().parseExtract(extract, language: "en", word: "apple")
        XCTAssertEqual(parsed.partOfSpeech, "Noun")
        XCTAssertEqual(parsed.definitions, ["A fruit.", "to apple"])
        XCTAssertEqual(parsed.translation, "maçã")
    }

    func testInvalidPackInstallFailsBeforeNetwork() async {
        do {
            _ = try await DictionaryRepository().installPack("not-a-real-pack")
            XCTFail("Unknown packs must be rejected")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .badURL)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
