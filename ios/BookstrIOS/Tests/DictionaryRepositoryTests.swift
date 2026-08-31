import XCTest
import SQLite3
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class DictionaryRepositoryTests: XCTestCase {
    private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

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
            defer { sqlite3_finalize(prepared) }
            _ = row.0.withCString { sqlite3_bind_text(prepared, 1, $0, -1, sqliteTransient) }
            _ = row.1.withCString { sqlite3_bind_text(prepared, 2, $0, -1, sqliteTransient) }
            _ = row.2.withCString { sqlite3_bind_text(prepared, 3, $0, -1, sqliteTransient) }
            XCTAssertEqual(sqlite3_step(prepared), SQLITE_DONE)
        }
    }

    private func pack(_ id: String, installed: Bool = false) -> DictionaryPack {
        let parts = id.split(separator: "-").map(String.init)
        return DictionaryPack(id: id, label: id, sourceLanguage: parts[0], targetLanguage: parts[1],
                              installed: installed, bytes: installed ? 2048 : 0)
    }

    func testPairSelectionKeepsPreferredEnglishPortuguesePair() {
        let packs = [pack("de-en"), pack("en-de"), pack("en-pt")]
        var selection = DictionaryPairSelection()
        selection.normalize(using: packs)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "en", target: "pt"))
        XCTAssertEqual(selection.selectedPack(in: packs)?.id, "en-pt")
    }

    func testChangingSourceSelectsOnlyAValidTarget() {
        let packs = [pack("de-en"), pack("de-pt"), pack("en-pt")]
        var selection = DictionaryPairSelection()
        selection.selectSource("de", using: packs)
        XCTAssertEqual(selection.source, "de")
        XCTAssertEqual(selection.target, "pt")
        XCTAssertEqual(selection.selectedPack(in: packs)?.id, "de-pt")
    }

    func testInstalledPairIsExcludedAndSelectionAdvancesWithinSource() {
        let installed = pack("en-pt", installed: true)
        let packs = [pack("en-de"), installed, pack("pt-en")]
        var selection = DictionaryPairSelection(source: "en", target: "pt")
        selection.didInstall(installed, using: packs)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "en", target: "de"))
        XCTAssertFalse(selection.targets(in: packs).contains("pt"))
    }

    func testSelectionChangesSourceWhenItsPairsAreExhausted() {
        let installed = pack("en-pt", installed: true)
        let packs = [installed, pack("pt-en")]
        var selection = DictionaryPairSelection()
        selection.didInstall(installed, using: packs)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "pt", target: "en"))
    }

    func testAllInstalledClearsSelection() {
        let packs = [pack("en-pt", installed: true), pack("pt-en", installed: true)]
        var selection = DictionaryPairSelection()
        selection.normalize(using: packs)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "", target: ""))
        XCTAssertNil(selection.selectedPack(in: packs))
    }

    func testRemovedPackBecomesSelectableAgainWithoutInvalidatingCurrentPair() {
        var selection = DictionaryPairSelection(source: "de", target: "en")
        let beforeRemoval = [pack("de-en"), pack("en-pt", installed: true)]
        selection.normalize(using: beforeRemoval)
        let afterRemoval = [pack("de-en"), pack("en-pt")]
        selection.normalize(using: afterRemoval)
        XCTAssertEqual(selection, DictionaryPairSelection(source: "de", target: "en"))
        XCTAssertTrue(selection.sources(in: afterRemoval).contains("en"))
    }

    func testAllInstalledReturnsEachMatchingDictionaryAsItsOwnResult() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("bookstr-dictionaries-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try makeDictionary(at: directory, id: "de-en", rows: [("Herz", "heart", "organ")])
        try makeDictionary(at: directory, id: "de-pt", rows: [("Herz", "coração | peito", "órgão")])
        try makeDictionary(at: directory, id: "en-de", rows: [("other", "andere", "")])

        let matches = DictionaryRepository(packDirectory: directory).lookupAllInstalled(word: "herz")

        XCTAssertEqual(matches.map(\.partOfSpeech), ["German → English", "German → Portuguese"])
        XCTAssertEqual(matches.map(\.language), ["en", "pt"])
        XCTAssertEqual(matches.map(\.definitions), [["heart — organ"], ["coração, peito — órgão"]])
    }

    func testAllInstalledChecksFallbackSpellingInEveryDictionary() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("bookstr-dictionaries-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try makeDictionary(at: directory, id: "pt-en", rows: [("dou-lhe", "I give him", "")])
        try makeDictionary(at: directory, id: "pt-de", rows: [("dou", "ich gebe", "")])

        let matches = DictionaryRepository(packDirectory: directory).lookupAllInstalled(word: "dou-lhe")

        XCTAssertEqual(matches.map(\.partOfSpeech), ["Portuguese → English", "Portuguese → German"])
        XCTAssertEqual(matches.map(\.definitions), [["I give him"], ["ich gebe"]])
    }

    func testParsesPortugueseDefinitionsAndEnglishTranslation() {
        let extract = """
        ==Português==
        ===Substantivo===
        órgão que bombeia sangue
        centro dos sentimentos

        ===Tradução===
        Inglês: heart
        """
        let repository = DictionaryRepository()
        let parsed = repository.parseExtract(extract, language: "pt", word: "coração")
        XCTAssertEqual(parsed.partOfSpeech, "Substantivo")
        XCTAssertEqual(parsed.definitions, ["órgão que bombeia sangue", "centro dos sentimentos"])
        XCTAssertEqual(parsed.translation, "heart")
    }

    func testDetectsPortugueseFromContext() {
        let repository = DictionaryRepository()
        XCTAssertEqual(repository.languageFor(context: "O coração bombeia sangue para o corpo."), "pt")
        XCTAssertEqual(repository.languageFor(context: "The heart pumps blood."), "en")
    }

    func testReadsEnglishTranslationFromHTML() {
        let html = #"<ul><li>Inglês: heart</li></ul>"#
        XCTAssertEqual(DictionaryRepository().translation(fromHTML: html), "heart")
    }

    func testFindsLemmaFromPluralGloss() {
        let repository = DictionaryRepository()
        XCTAssertEqual(repository.lemma(from: ["plural de colheita."], word: "colheitas"), "colheita")
        XCTAssertEqual(repository.lemma(from: ["plural of harvest"], word: "harvests"), "harvest")
        XCTAssertNil(repository.lemma(from: ["o ato de colher"], word: "colheita"))
        XCTAssertTrue(repository.needsLemmaFollow(definitions: ["plural de colheita."], word: "colheitas"))
        XCTAssertFalse(repository.needsLemmaFollow(
            definitions: ["plural de colheita", "o ato de colher (produtos agrícolas)"],
            word: "colheitas"
        ))
    }

    func testParsesPluralFormWithoutHeadwordNoise() {
        let extract = """
        ==Português==
        ===Forma de substantivo===
        colheitas, plural
        plural de colheita.
        """
        let repository = DictionaryRepository()
        let parsed = repository.parseExtract(extract, language: "pt", word: "colheitas")
        XCTAssertEqual(parsed.definitions, ["plural de colheita."])
        XCTAssertEqual(repository.lemma(from: parsed.definitions, word: "colheitas"), "colheita")
    }

    func testMergesSingularEntryUnderPlural() {
        let repository = DictionaryRepository()
        let merged = repository.merge(
            inflection: DictionaryLookup(
                word: "colheitas",
                language: "pt",
                partOfSpeech: "Forma de substantivo",
                definitions: ["plural de colheita."],
                translation: nil,
                sourceUrl: "https://pt.wiktionary.org/wiki/colheitas"
            ),
            lemma: DictionaryLookup(
                word: "colheita",
                language: "pt",
                partOfSpeech: "Substantivo",
                definitions: ["o ato de colher (produtos agrícolas)"],
                translation: "harvest",
                sourceUrl: "https://pt.wiktionary.org/wiki/colheita"
            )
        )
        XCTAssertEqual(merged.word, "colheitas")
        XCTAssertEqual(merged.partOfSpeech, "Substantivo")
        XCTAssertEqual(merged.translation, "harvest")
        XCTAssertEqual(merged.definitions, ["plural de colheita", "o ato de colher (produtos agrícolas)"])
    }

    func testHyphenatedWordFallsBackToFirstPart() {
        XCTAssertEqual(DictionaryRepository().lookupCandidates(for: "dou-lhe"), ["dou-lhe", "dou"])
    }

    func testMultipleCliticsStillUseFirstPart() {
        XCTAssertEqual(DictionaryRepository().lookupCandidates(for: "dar-lhe-ei"), ["dar-lhe-ei", "dar"])
    }

    func testTypographicHyphensFromEpubAreRecognized() {
        let repository = DictionaryRepository()
        XCTAssertEqual(repository.lookupCandidates(for: "dou‐lhe"), ["dou‐lhe", "dou"])
        XCTAssertEqual(repository.lookupCandidates(for: "dou‑lhe"), ["dou‑lhe", "dou"])
    }

    func testExactUnhyphenatedWordHasNoFallback() {
        XCTAssertEqual(DictionaryRepository().lookupCandidates(for: "dou"), ["dou"])
    }

    func testLeadingHyphenDoesNotCreateEmptyLookup() {
        XCTAssertEqual(DictionaryRepository().lookupCandidates(for: "-lhe"), ["-lhe"])
    }

    func testLookupCandidatesTrimAndLowercaseWithoutLosingExactForm() {
        XCTAssertEqual(DictionaryRepository().lookupCandidates(for: "  Dou-Lhe  "), ["dou-lhe", "dou"])
    }

    func testParseExtractFallsBackToEmptyWhenLanguageSectionMissing() {
        let extract = """
        ==English==
        ===Noun===
        heart

        ==French==
        ===Nom===
        coeur
        """
        let parsed = DictionaryRepository().parseExtract(extract, language: "pt", word: "coração")

        XCTAssertEqual(parsed.partOfSpeech, "")
        XCTAssertEqual(parsed.definitions, [])
        XCTAssertNil(parsed.translation)
    }

    func testParseExtractIgnoresIgnoredSectionsAndSkipsHeadwordPronunciations() {
        let extract = """
        ==Português==
        ===Substantivo===
        correr.n
        ação
        correr.v
        ===Verbo===
        correr
        """
        let parsed = DictionaryRepository().parseExtract(extract, language: "pt", word: "correr")

        XCTAssertEqual(parsed.partOfSpeech, "Substantivo")
        XCTAssertEqual(parsed.definitions, ["ação"])
    }

    func testInflectionNoiseAndGlossHelpersCoverBranches() {
        let repository = DictionaryRepository()
        XCTAssertTrue(repository.isInflectionNoise("correr, plural", word: "correr"))
        XCTAssertTrue(repository.isInflectionNoise("correr, feminino arcaico", word: "correr"))
        XCTAssertFalse(repository.isInflectionNoise("corrida", word: "correr"))
        XCTAssertFalse(repository.isInflectionNoise("correr", word: "correr"))
        XCTAssertTrue(repository.isInflectionGloss("plural de correr", word: "correr"))
        XCTAssertFalse(repository.isInflectionGloss("corrida", word: "correr"))
    }
}
