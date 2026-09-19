import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SpeechLanguageSettingsTests: XCTestCase {
    func testPreferredLanguageTagNormalizesPortugueseAndBlanks() {
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("  "), "en")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("pt"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("PT-BR"), "pt-br")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("por"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("por-BR"), "pt-br")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("Português"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("en_US"), "en-us")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag(" FR-fr "), "fr-fr")
    }

    func testEnglishWithoutSettingsUsesSystemDefault() {
        let choice = SpeechLanguageSettings.resolve(bookLanguage: "en", settingsByLanguage: [:])
        XCTAssertEqual(choice.languageTag, "en")
        XCTAssertEqual(choice.voiceIdentifier, SpeechVoiceID.systemDefault)
        XCTAssertNil(choice.neuralEngine)
        XCTAssertEqual(choice.engine, .apple)
        XCTAssertEqual(choice.rate, SpeechLanguageSettings.defaultRate)
    }

    func testPortugueseWithoutSettingsUsesSystemDefault() {
        let choice = SpeechLanguageSettings.resolve(bookLanguage: "pt", settingsByLanguage: [:])
        XCTAssertEqual(choice.languageTag, "pt-pt")
        XCTAssertEqual(choice.voiceIdentifier, SpeechVoiceID.systemDefault)
        XCTAssertNil(choice.neuralEngine)
    }

    func testLanguageSettingOutranksUnsetDefaultAndLegacyVoice() {
        let settings = [
            "en": SpeechLanguageSetting(voiceIdentifier: "com.apple.voice.compact.en-GB.Daniel", rate: 0.4),
        ]
        let choice = SpeechLanguageSettings.resolve(
            bookLanguage: "en-US",
            settingsByLanguage: settings,
            defaultRate: 0.5
        )
        XCTAssertEqual(choice.voiceIdentifier, "com.apple.voice.compact.en-GB.Daniel")
        XCTAssertEqual(choice.rate, 0.4)
        XCTAssertEqual(choice.engine, .apple)
    }

    func testEmptyVoiceSettingKeepsSystemDefaultForEnglish() {
        let settings = ["en": SpeechLanguageSetting(voiceIdentifier: "", rate: nil)]
        let choice = SpeechLanguageSettings.resolve(bookLanguage: "en", settingsByLanguage: settings)
        XCTAssertEqual(choice.voiceIdentifier, SpeechVoiceID.systemDefault)
        XCTAssertEqual(choice.engine, .apple)
    }

    func testRegionalSettingIsPreferredOverLanguageOnly() {
        let settings = [
            "pt": SpeechLanguageSetting(voiceIdentifier: "pt-generic"),
            "pt-pt": SpeechLanguageSetting(voiceIdentifier: "pt-portugal"),
        ]
        let choice = SpeechLanguageSettings.resolve(bookLanguage: "pt-PT", settingsByLanguage: settings)
        XCTAssertEqual(choice.voiceIdentifier, "pt-portugal")
    }

    func testSingleRegionalSettingMatchesBareLanguage() {
        let settings = ["pt-br": SpeechLanguageSetting(voiceIdentifier: "luciana")]
        XCTAssertEqual(
            SpeechLanguageSettings.setting(for: "pt", in: settings)?.voiceIdentifier,
            "luciana"
        )
        XCTAssertNil(SpeechLanguageSettings.setting(for: "fr", in: settings))
    }

    func testAmbiguousRegionalSettingsDoNotGuess() {
        let settings = [
            "en-us": SpeechLanguageSetting(voiceIdentifier: "samantha"),
            "en-gb": SpeechLanguageSetting(voiceIdentifier: "daniel"),
        ]
        XCTAssertNil(SpeechLanguageSettings.setting(for: "en", in: settings))
        XCTAssertEqual(
            SpeechLanguageSettings.resolve(bookLanguage: "en", settingsByLanguage: settings).voiceIdentifier,
            SpeechVoiceID.systemDefault
        )
    }

    func testNonEnglishWithoutSettingsUsesSystemDefault() {
        let choice = SpeechLanguageSettings.resolve(bookLanguage: "fr", settingsByLanguage: [:])
        XCTAssertEqual(choice.voiceIdentifier, SpeechVoiceID.systemDefault)
        XCTAssertEqual(choice.languageTag, "fr")
    }

    func testRateUsesLanguageOverrideThenClamp() {
        XCTAssertEqual(SpeechLanguageSettings.clampRate(0.2), 0.35)
        XCTAssertEqual(SpeechLanguageSettings.clampRate(0.9), 0.60)
        let choice = SpeechLanguageSettings.resolve(
            bookLanguage: "en",
            settingsByLanguage: ["en": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.kokoroEnglish.rawValue, rate: 0.9)],
            defaultRate: 0.4
        )
        XCTAssertEqual(choice.rate, 0.60)
    }

    func testNeuralEnginesAndCatalog() {
        XCTAssertTrue(SpeechEngineID.kokoroEnglish.supports(language: "en-GB"))
        XCTAssertFalse(SpeechEngineID.kokoroEnglish.supports(language: "pt-PT"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: "pt_PT"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: "pt"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: "pt-BR"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: "por"))
        XCTAssertFalse(SpeechEngineID.portuguesePortugal.supports(language: "en"))
        XCTAssertEqual(SpeechVoiceID.speakers(for: "pt-br").map(\.id), [SpeechEngineID.portuguesePortugal.rawValue])
        XCTAssertTrue(SpeechEngineID.system.supports(language: "fr"))
        XCTAssertEqual(SpeechEngineID.kokoroEnglish.label, "Kokoro · English")
        XCTAssertEqual(SpeechEngineID.portuguesePortugal.label, "Tugão · Português (Portugal)")
        XCTAssertEqual(SpeechVoiceID.speakers(for: "en").map(\.id), [SpeechEngineID.kokoroEnglish.rawValue])
        XCTAssertEqual(SpeechVoiceID.speakers(for: "pt-pt").map(\.id), [SpeechEngineID.portuguesePortugal.rawValue])
        XCTAssertTrue(SpeechVoiceID.speakers(for: "fr").isEmpty)
        XCTAssertTrue(SpeechLanguageSettings.isEnglish("EN-gb"))
        XCTAssertFalse(SpeechLanguageSettings.isEnglish("pt-PT"))
        XCTAssertEqual(
            SpeechLanguageSettings.resolve(
                bookLanguage: "en",
                settingsByLanguage: ["en": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.kokoroEnglish.rawValue)]
            ).engine,
            .neural(.kokoroEnglish)
        )
        XCTAssertEqual(
            SpeechLanguageSettings.resolve(
                bookLanguage: "pt",
                settingsByLanguage: ["pt-pt": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.portuguesePortugal.rawValue)]
            ).engine,
            .neural(.portuguesePortugal)
        )
        let brazilian = SpeechLanguageSettings.resolve(
            bookLanguage: "pt-BR",
            settingsByLanguage: ["pt-pt": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.portuguesePortugal.rawValue)]
        )
        XCTAssertEqual(brazilian.engine, .neural(.portuguesePortugal))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: brazilian.languageTag))
        XCTAssertTrue(SpeechLanguageSettings.isPortuguese("pt-BR"))
        XCTAssertTrue(SpeechLanguageSettings.isPortuguese("por"))
        XCTAssertEqual(
            SpeechPlaybackChoice(languageTag: "en", voiceIdentifier: "system", rate: 0.48).engine,
            .apple
        )
    }

    func testLegacyEngineMigratesIntoEmptyLanguageSettings() {
        XCTAssertEqual(
            SpeechLanguageSettings.migrateLegacyEngine("kokoro_en", into: [:])["en"]?.voiceIdentifier,
            SpeechEngineID.kokoroEnglish.rawValue
        )
        XCTAssertEqual(
            SpeechLanguageSettings.migrateLegacyEngine("piper_pt_pt", into: [:])["pt-pt"]?.voiceIdentifier,
            SpeechEngineID.portuguesePortugal.rawValue
        )
        let existing = ["en": SpeechLanguageSetting(voiceIdentifier: "samantha")]
        XCTAssertEqual(SpeechLanguageSettings.migrateLegacyEngine("kokoro_en", into: existing), existing)
        XCTAssertEqual(SpeechLanguageSettings.migrateLegacyEngine("system", into: [:]), [:])
        XCTAssertEqual(SpeechLanguageSettings.migrateLegacyEngine(nil, into: [:]), [:])
        XCTAssertEqual(SpeechLanguageSettings.migrateLegacyEngine("unknown", into: [:]), [:])
    }

    func testSettingsRoundTripAndInvalidPayload() {
        let original = ["en": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.kokoroEnglish.rawValue, rate: 0.5)]
        let data = SpeechLanguageSettings.encodeSettings(original)
        XCTAssertEqual(SpeechLanguageSettings.decodeSettings(data), original)
        XCTAssertEqual(SpeechLanguageSettings.decodeSettings(nil), [:])
        XCTAssertEqual(SpeechLanguageSettings.decodeSettings(Data()), [:])
        XCTAssertEqual(SpeechLanguageSettings.decodeSettings(Data("not-json".utf8)), [:])
    }

    func testLanguagesForBookCodesUniquesLibraryLanguagesAndKeepsEnglishPortuguese() {
        let languages = SpeechLanguageSettings.languagesForBookCodes(["fr", "en-US", "pt-BR", "fr-FR", ""])
        XCTAssertEqual(Set(languages), Set(["en", "fr", "pt-pt"]))
        XCTAssertEqual(languages, languages.sorted {
            SpeechLanguageSettings.displayName(for: $0)
                .localizedCaseInsensitiveCompare(SpeechLanguageSettings.displayName(for: $1)) == .orderedAscending
        })
        XCTAssertFalse(SpeechLanguageSettings.displayName(for: "fr").isEmpty)
    }
}
