import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

final class SpeechLanguageSettingsTests: XCTestCase {
    func testDutchVoiceIsAvailableAndResolvesForBookLanguages() throws {
        XCTAssertTrue(SpeechLanguageSettings.languagesForBookCodes([]).contains("nl"))
        XCTAssertEqual(SpeechEngineID.dutchDii.label, "Dii · Nederlands")
        XCTAssertEqual(SpeechEngineID.dutchDii.preferredLanguageTag, "nl")
        XCTAssertFalse(SpeechEngineID.dutchDii.supports(language: "de"))
        let saved = ["nl": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.dutchDii.rawValue)]
        let restored = SpeechLanguageSettings.decodeSettings(SpeechLanguageSettings.encodeSettings(saved))
        for language in ["nl", "nld", "dut", "Dutch", "Nederlands", "nl_NL", "nl-BE"] {
            XCTAssertTrue(SpeechEngineID.dutchDii.supports(language: language))
            XCTAssertEqual(SpeechVoiceID.speakers(for: language).map(\.id), ["piper_nl_nl_dii"])
            XCTAssertEqual(SpeechLanguageSettings.resolve(bookLanguage: language, settingsByLanguage: restored).engine, .neural(.dutchDii))
        }
    }

    func testPreferredLanguageTagNormalizesPortugueseAndBlanks() {
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("  "), "en")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("pt"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("PT-BR"), "pt-br")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("por"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("por-BR"), "pt-br")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("Português"), "pt-pt")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("en_US"), "en-us")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag(" FR-fr "), "fr-fr")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("English"), "en")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("english"), "en")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("eng"), "en")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("French"), "fr")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("fra"), "fr")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("Deutsch"), "de")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("ger"), "de")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("Español"), "es")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("castellano"), "es")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("Català"), "ca")
        XCTAssertEqual(SpeechLanguageSettings.preferredLanguageTag("cat"), "ca")
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
        XCTAssertTrue(SpeechEngineID.kokoroEnglish.supports(language: "English"))
        XCTAssertFalse(SpeechEngineID.kokoroEnglish.supports(language: "pt-PT"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugal.supports(language: "pt_PT"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugalMiro.supports(language: "pt"))
        XCTAssertTrue(SpeechEngineID.portuguesePortugalDii.supports(language: "por"))
        XCTAssertFalse(SpeechEngineID.portuguesePortugal.supports(language: "en"))
        XCTAssertTrue(SpeechEngineID.frenchMiro.supports(language: "French"))
        XCTAssertTrue(SpeechEngineID.frenchMiro.supports(language: "fra"))
        XCTAssertTrue(SpeechEngineID.germanMiro.supports(language: "Deutsch"))
        XCTAssertTrue(SpeechEngineID.spanishMiro.supports(language: "Español"))
        XCTAssertTrue(SpeechEngineID.catalanOna.supports(language: "Català"))
        XCTAssertEqual(
            SpeechVoiceID.speakers(for: "pt-br").map(\.id),
            [
                SpeechEngineID.portuguesePortugal.rawValue,
                SpeechEngineID.portuguesePortugalMiro.rawValue,
                SpeechEngineID.portuguesePortugalDii.rawValue,
            ]
        )
        XCTAssertTrue(SpeechEngineID.system.supports(language: "fr"))
        XCTAssertEqual(SpeechEngineID.kokoroEnglish.label, "Kokoro · English")
        XCTAssertEqual(SpeechEngineID.portuguesePortugal.label, "Tugão · Português (Portugal)")
        XCTAssertEqual(SpeechEngineID.portuguesePortugalMiro.label, "Miro · Português (Portugal)")
        XCTAssertEqual(SpeechEngineID.portuguesePortugalDii.label, "Dii · Português (Portugal)")
        XCTAssertEqual(SpeechEngineID.frenchMiro.label, "Miro · Français")
        XCTAssertEqual(SpeechEngineID.germanMiro.label, "Miro · Deutsch")
        XCTAssertEqual(SpeechEngineID.spanishMiro.label, "Miro · Español")
        XCTAssertEqual(SpeechEngineID.catalanOna.label, "UPC Ona · Català")
        XCTAssertEqual(SpeechVoiceID.speakers(for: "en").map(\.id), [SpeechEngineID.kokoroEnglish.rawValue])
        XCTAssertEqual(SpeechVoiceID.speakers(for: "fr").map(\.id), [SpeechEngineID.frenchMiro.rawValue])
        XCTAssertEqual(SpeechVoiceID.speakers(for: "de").map(\.id), [SpeechEngineID.germanMiro.rawValue])
        XCTAssertEqual(SpeechVoiceID.speakers(for: "es").map(\.id), [SpeechEngineID.spanishMiro.rawValue])
        XCTAssertEqual(SpeechVoiceID.speakers(for: "ca").map(\.id), [SpeechEngineID.catalanOna.rawValue])
        XCTAssertTrue(SpeechLanguageSettings.isEnglish("EN-gb"))
        XCTAssertTrue(SpeechLanguageSettings.isEnglish("English"))
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
                bookLanguage: "French",
                settingsByLanguage: ["fr": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.frenchMiro.rawValue)]
            ).engine,
            .neural(.frenchMiro)
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
        let stale = try! JSONEncoder().encode([
            "english": SpeechLanguageSetting(voiceIdentifier: "samantha"),
            "fra": SpeechLanguageSetting(voiceIdentifier: SpeechEngineID.frenchMiro.rawValue),
        ] as [String: SpeechLanguageSetting])
        let migrated = SpeechLanguageSettings.decodeSettings(stale)
        XCTAssertEqual(migrated["en"]?.voiceIdentifier, "samantha")
        XCTAssertEqual(migrated["fr"]?.voiceIdentifier, SpeechEngineID.frenchMiro.rawValue)
        XCTAssertNil(migrated["english"])
        XCTAssertNil(migrated["fra"])
    }

    func testLanguagesForBookCodesUniquesLibraryLanguagesAndKeepsEnglishPortuguese() {
        let languages = SpeechLanguageSettings.languagesForBookCodes(["fr", "en-US", "pt-BR", "fr-FR", "English", ""])
        XCTAssertEqual(
            Set(languages),
            Set(SpeechLanguageSettings.seededLanguageTags)
        )
        XCTAssertEqual(languages.filter { $0 == "en" }.count, 1)
        XCTAssertEqual(languages, languages.sorted {
            SpeechLanguageSettings.displayName(for: $0)
                .localizedCaseInsensitiveCompare(SpeechLanguageSettings.displayName(for: $1)) == .orderedAscending
        })
        XCTAssertFalse(SpeechLanguageSettings.displayName(for: "fr").isEmpty)
        XCTAssertEqual(
            SpeechLanguageSettings.displayName(for: "English"),
            SpeechLanguageSettings.displayName(for: "en")
        )
        XCTAssertNotEqual(SpeechLanguageSettings.displayName(for: "english"), "ENGLISH")
    }

    func testSpeechLanguageListCacheReplaceAndInvalidate() {
        SpeechLanguageListCache.invalidate()
        XCTAssertNil(SpeechLanguageListCache.peek())
        SpeechLanguageListCache.replace(["en", "fr"])
        XCTAssertEqual(SpeechLanguageListCache.peek(), ["en", "fr"])
        SpeechLanguageListCache.invalidate()
        XCTAssertNil(SpeechLanguageListCache.peek())
    }
}
