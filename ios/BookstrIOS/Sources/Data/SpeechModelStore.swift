import Foundation

enum SpeechEngineID: String, CaseIterable, Identifiable {
    case system
    case kokoroEnglish = "kokoro_en"
    case portuguesePortugal = "piper_pt_pt"
    case portuguesePortugalMiro = "piper_pt_pt_miro"
    case portuguesePortugalDii = "piper_pt_pt_dii"
    case frenchMiro = "piper_fr_fr"
    case germanMiro = "piper_de_de"
    case spanishMiro = "piper_es_es"
    case catalanOna = "piper_ca_es"
    case dutchDii = "piper_nl_nl_dii"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "Apple voices"
        case .kokoroEnglish: "Kokoro · English"
        case .portuguesePortugal: "Tugão · Português (Portugal)"
        case .portuguesePortugalMiro: "Miro · Português (Portugal)"
        case .portuguesePortugalDii: "Dii · Português (Portugal)"
        case .frenchMiro: "Miro · Français"
        case .germanMiro: "Miro · Deutsch"
        case .spanishMiro: "Miro · Español"
        case .catalanOna: "UPC Ona · Català"
        case .dutchDii: "Dii · Nederlands"
        }
    }

    var isNeural: Bool { self != .system }

    var preferredLanguageTag: String {
        switch self {
        case .system, .kokoroEnglish: "en"
        case .portuguesePortugal, .portuguesePortugalMiro, .portuguesePortugalDii: "pt-pt"
        case .frenchMiro: "fr"
        case .germanMiro: "de"
        case .spanishMiro: "es"
        case .catalanOna: "ca"
        case .dutchDii: "nl"
        }
    }

    func supports(language: String) -> Bool {
        switch self {
        case .system: true
        case .kokoroEnglish: SpeechLanguageSettings.isEnglish(language)
        case .portuguesePortugal, .portuguesePortugalMiro, .portuguesePortugalDii:
            SpeechLanguageSettings.isPortuguese(language)
        case .frenchMiro: SpeechLanguageSettings.isFrench(language)
        case .germanMiro: SpeechLanguageSettings.isGerman(language)
        case .spanishMiro: SpeechLanguageSettings.isSpanish(language)
        case .catalanOna: SpeechLanguageSettings.isCatalan(language)
        case .dutchDii: SpeechLanguageSettings.baseLanguage(language) == "nl"
        }
    }
}

enum SpeechModelKind: Equatable {
    case kokoro(model: String, voices: String, speaker: Int)
    case vits(model: String)
}

struct SpeechModelSpec: Identifiable, Equatable {
    struct File: Equatable {
        let path: String
        let expectedBytes: Int64?
    }

    let id: SpeechEngineID
    let repository: String
    let revision: String
    let files: [File]
    let kind: SpeechModelKind

    var approximateBytes: Int64 {
        files.compactMap(\.expectedBytes).reduce(0, +)
    }

    var directory: URL { SpeechModelCatalog.rootDirectory.appendingPathComponent(id.rawValue, isDirectory: true) }
    var dataDirectory: URL { SpeechModelCatalog.rootDirectory.appendingPathComponent("espeak-ng-data", isDirectory: true) }
    var tokensURL: URL { directory.appendingPathComponent("tokens.txt") }

    func fileURL(_ path: String) -> URL { directory.appendingPathComponent(path) }

    var isInstalled: Bool {
        files.allSatisfy { file in
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL(file.path).path),
                  let size = attributes[.size] as? NSNumber else { return false }
            return size.int64Value > 0 && (file.expectedBytes == nil || size.int64Value == file.expectedBytes)
        }
    }
}

enum SpeechModelCatalog {
    static var rootDirectoryOverride: URL?

    static var modelsOverride: [SpeechModelSpec]?

    // eSpeak keeps its first data directory for the process lifetime. Every voice
    // installs the same language data so switching voices also switches languages.
    static let commonEspeakFiles = [
        SpeechModelSpec.File(path: "espeak-ng-data/ca_dict", expectedBytes: 45566),
        SpeechModelSpec.File(path: "espeak-ng-data/de_dict", expectedBytes: 68276),
        SpeechModelSpec.File(path: "espeak-ng-data/en_dict", expectedBytes: 166944),
        SpeechModelSpec.File(path: "espeak-ng-data/es_dict", expectedBytes: 49252),
        SpeechModelSpec.File(path: "espeak-ng-data/fr_dict", expectedBytes: 63727),
        SpeechModelSpec.File(path: "espeak-ng-data/intonations", expectedBytes: 2040),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/gmw/de", expectedBytes: 42),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/gmw/en", expectedBytes: 140),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/gmw/en-US", expectedBytes: 257),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/gmw/nl", expectedBytes: 23),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/roa/ca", expectedBytes: 25),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/roa/es", expectedBytes: 63),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/roa/fr", expectedBytes: 79),
        SpeechModelSpec.File(path: "espeak-ng-data/lang/roa/pt", expectedBytes: 95),
        SpeechModelSpec.File(path: "espeak-ng-data/nl_dict", expectedBytes: 65979),
        SpeechModelSpec.File(path: "espeak-ng-data/phondata", expectedBytes: 550424),
        SpeechModelSpec.File(path: "espeak-ng-data/phondata-manifest", expectedBytes: 21821),
        SpeechModelSpec.File(path: "espeak-ng-data/phonindex", expectedBytes: 39074),
        SpeechModelSpec.File(path: "espeak-ng-data/phontab", expectedBytes: 55796),
        SpeechModelSpec.File(path: "espeak-ng-data/pt_dict", expectedBytes: 67817)
    ]

    static var models: [SpeechModelSpec] {
        modelsOverride ?? bundledModels
    }

    static let bundledModels: [SpeechModelSpec] = [
        SpeechModelSpec(
            id: .kokoroEnglish,
            repository: "csukuangfj/kokoro-en-v0_19",
            revision: "92805c485745946a0d945562d3aba19e7cbb2104",
            files: [
                .init(path: "model.onnx", expectedBytes: 345_555_491),
                .init(path: "voices.bin", expectedBytes: 5_755_904),
                .init(path: "tokens.txt", expectedBytes: 1_078)
            ] + commonEspeakFiles,
            kind: .kokoro(model: "model.onnx", voices: "voices.bin", speaker: 0)
        ),
        SpeechModelSpec(
            id: .portuguesePortugal,
            repository: "csukuangfj/vits-piper-pt_PT-tugao-medium",
            revision: "612042d3d5a504d6c65080b1b2b2f7981b831954",
            files: [
                .init(path: "pt_PT-tugao-medium.onnx", expectedBytes: 63_201_425),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "pt_PT-tugao-medium.onnx")
        ),
        SpeechModelSpec(
            id: .portuguesePortugalMiro,
            repository: "csukuangfj/vits-piper-pt_PT-miro-high",
            revision: "6a917dc1f1d2f6a4a0a12742478483ccce3f52b6",
            files: [
                .init(path: "pt_PT-miro-high.onnx", expectedBytes: 63_511_198),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "pt_PT-miro-high.onnx")
        ),
        SpeechModelSpec(
            id: .portuguesePortugalDii,
            repository: "csukuangfj/vits-piper-pt_PT-dii-high",
            revision: "27cf37a700e91003217a567e12761e6497fe9b0b",
            files: [
                .init(path: "pt_PT-dii-high.onnx", expectedBytes: 63_511_198),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "pt_PT-dii-high.onnx")
        ),
        SpeechModelSpec(
            id: .frenchMiro,
            repository: "csukuangfj/vits-piper-fr_FR-miro-high",
            revision: "695e063aefa9a7c61e4755a1924e137bc11d291d",
            files: [
                .init(path: "fr_FR-miro-high.onnx", expectedBytes: 63_153_773),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "fr_FR-miro-high.onnx")
        ),
        SpeechModelSpec(
            id: .germanMiro,
            repository: "csukuangfj/vits-piper-de_DE-miro-high",
            revision: "e736ced18138f0608322c96fa6b0dc05b492107c",
            files: [
                .init(path: "de_DE-miro-high.onnx", expectedBytes: 63_153_773),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "de_DE-miro-high.onnx")
        ),
        SpeechModelSpec(
            id: .spanishMiro,
            repository: "csukuangfj/vits-piper-es_ES-miro-high",
            revision: "0e1f773561429a9e50fa23d868a40eb341ad83c4",
            files: [
                .init(path: "es_ES-miro-high.onnx", expectedBytes: 63_153_775),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "es_ES-miro-high.onnx")
        ),
        SpeechModelSpec(
            id: .catalanOna,
            repository: "csukuangfj/vits-piper-ca_ES-upc_ona-medium",
            revision: "814326c793214a358024edcf2d17e6de1acf0280",
            files: [
                .init(path: "ca_ES-upc_ona-medium.onnx", expectedBytes: 63_201_422),
                .init(path: "tokens.txt", expectedBytes: 921)
            ] + commonEspeakFiles,
            kind: .vits(model: "ca_ES-upc_ona-medium.onnx")
        ),
        SpeechModelSpec(
            id: .dutchDii,
            repository: "csukuangfj/vits-piper-nl_NL-dii-high",
            revision: "12169a38e0f40f3ffc429273346f6d0700387cdf",
            files: [
                .init(path: "nl_NL-dii-high.onnx", expectedBytes: 63_153_771),
                .init(path: "tokens.txt", expectedBytes: 954)
            ] + commonEspeakFiles,
            kind: .vits(model: "nl_NL-dii-high.onnx")
        )
    ]

    static var rootDirectory: URL {
        if let rootDirectoryOverride { return rootDirectoryOverride }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("bookstr/speech-models", isDirectory: true)
    }

    static func model(_ id: SpeechEngineID) -> SpeechModelSpec? {
        models.first { $0.id == id }
    }

    static func sourceURL(repository: String, revision: String, path: String) -> URL? {
        let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        return URL(string: "https://huggingface.co/\(repository)/resolve/\(revision)/\(encodedPath)")
    }
}

protocol SpeechFileDownloading: Sendable {
    func download(from url: URL) async throws -> (URL, URLResponse)
}

struct URLSessionSpeechDownloader: SpeechFileDownloading {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func download(from url: URL) async throws -> (URL, URLResponse) {
        try await session.download(from: url)
    }
}

@MainActor
final class SpeechModelStore: ObservableObject {
    @Published private(set) var installing: SpeechEngineID?
    @Published private(set) var completedFiles = 0
    @Published private(set) var errorMessage: String?
    @Published private(set) var lastErrorEngine: SpeechEngineID?

    private let downloader: any SpeechFileDownloading
    private let fileManager: FileManager
    private let sourceURLBuilder: (String, String, String) -> URL?

    init(
        downloader: any SpeechFileDownloading = URLSessionSpeechDownloader(),
        fileManager: FileManager = .default,
        sourceURLBuilder: @escaping (String, String, String) -> URL? = SpeechModelCatalog.sourceURL
    ) {
        self.downloader = downloader
        self.fileManager = fileManager
        self.sourceURLBuilder = sourceURLBuilder
    }

    func isInstalled(_ id: SpeechEngineID) -> Bool {
        id == .system || SpeechModelCatalog.model(id)?.isInstalled == true
    }

    func installAndSelect(_ id: SpeechEngineID, settings: SettingsRepository) async {
        await install(id)
        guard errorMessage == nil, isInstalled(id) else { return }
        settings.selectDownloadedSpeechEngine(id)
    }

    func install(_ id: SpeechEngineID) async {
        guard installing == nil, let model = SpeechModelCatalog.model(id) else { return }
        installing = id
        completedFiles = 0
        errorMessage = nil
        lastErrorEngine = nil
        let staging = SpeechModelCatalog.rootDirectory
            .appendingPathComponent(".install-\(UUID().uuidString)", isDirectory: true)
        do {
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
            for file in model.files {
                guard let source = sourceURLBuilder(model.repository, model.revision, file.path) else {
                    throw URLError(.badURL)
                }
                let (temporary, response) = try await downloader.download(from: source)
                guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                    throw URLError(.badServerResponse)
                }
                let destination = staging.appendingPathComponent(file.path)
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                if fileManager.fileExists(atPath: destination.path) {
                    try fileManager.removeItem(at: destination)
                }
                try fileManager.moveItem(at: temporary, to: destination)
                if let expected = file.expectedBytes {
                    let attributes = try fileManager.attributesOfItem(atPath: destination.path)
                    guard (attributes[.size] as? NSNumber)?.int64Value == expected else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                }
                completedFiles += 1
            }
            // Keep shared pronunciation data after removing an individual voice.
            for file in model.files where file.path.hasPrefix("espeak-ng-data/") {
                let destination = SpeechModelCatalog.rootDirectory.appendingPathComponent(file.path)
                try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                let data = try Data(contentsOf: staging.appendingPathComponent(file.path))
                try data.write(to: destination, options: .atomic)
            }
            try fileManager.createDirectory(at: SpeechModelCatalog.rootDirectory, withIntermediateDirectories: true)
            if fileManager.fileExists(atPath: model.directory.path) {
                try fileManager.removeItem(at: model.directory)
            }
            try fileManager.moveItem(at: staging, to: model.directory)
        } catch {
            try? fileManager.removeItem(at: staging)
            errorMessage = error.localizedDescription
            lastErrorEngine = id
        }
        installing = nil
    }

    func remove(_ id: SpeechEngineID) {
        guard installing != id, let model = SpeechModelCatalog.model(id) else { return }
        do {
            if fileManager.fileExists(atPath: model.directory.path) {
                try fileManager.removeItem(at: model.directory)
            }
            errorMessage = nil
            lastErrorEngine = nil
        } catch {
            errorMessage = error.localizedDescription
            lastErrorEngine = id
        }
        objectWillChange.send()
    }
}
