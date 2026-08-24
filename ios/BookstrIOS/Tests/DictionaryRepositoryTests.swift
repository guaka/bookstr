import XCTest
@testable import BookstrIOS

final class DictionaryRepositoryTests: XCTestCase {
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
}
