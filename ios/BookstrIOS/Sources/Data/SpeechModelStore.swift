import Foundation

enum SpeechEngineID: String, CaseIterable, Identifiable {
    case system
    case kokoroEnglish = "kokoro_en"
    case portuguesePortugal = "piper_pt_pt"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "Apple voices"
        case .kokoroEnglish: "Kokoro · English"
        case .portuguesePortugal: "Tugão · Português (Portugal)"
        }
    }

    var isNeural: Bool { self != .system }

    var preferredLanguageTag: String {
        switch self {
        case .system: "en"
        case .kokoroEnglish: "en"
        case .portuguesePortugal: "pt-pt"
        }
    }

    func supports(language: String) -> Bool {
        switch self {
        case .system: true
        case .kokoroEnglish: SpeechLanguageSettings.isEnglish(language)
        case .portuguesePortugal: SpeechLanguageSettings.isPortuguese(language)
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
    var dataDirectory: URL { directory.appendingPathComponent("espeak-ng-data", isDirectory: true) }
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

    static let commonEspeakFiles = [
        SpeechModelSpec.File(path: "espeak-ng-data/intonations", expectedBytes: 2_040),
        SpeechModelSpec.File(path: "espeak-ng-data/phondata", expectedBytes: 550_424),
        SpeechModelSpec.File(path: "espeak-ng-data/phondata-manifest", expectedBytes: 21_821),
        SpeechModelSpec.File(path: "espeak-ng-data/phonindex", expectedBytes: 39_074),
        SpeechModelSpec.File(path: "espeak-ng-data/phontab", expectedBytes: 55_796)
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
                .init(path: "tokens.txt", expectedBytes: 1_078),
                .init(path: "espeak-ng-data/en_dict", expectedBytes: 166_944),
                .init(path: "espeak-ng-data/lang/gmw/en", expectedBytes: 140),
                .init(path: "espeak-ng-data/lang/gmw/en-US", expectedBytes: 257)
            ] + commonEspeakFiles,
            kind: .kokoro(model: "model.onnx", voices: "voices.bin", speaker: 0)
        ),
        SpeechModelSpec(
            id: .portuguesePortugal,
            repository: "csukuangfj/vits-piper-pt_PT-tugao-medium",
            revision: "612042d3d5a504d6c65080b1b2b2f7981b831954",
            files: [
                .init(path: "pt_PT-tugao-medium.onnx", expectedBytes: 63_201_425),
                .init(path: "tokens.txt", expectedBytes: 954),
                .init(path: "espeak-ng-data/pt_dict", expectedBytes: 67_817),
                .init(path: "espeak-ng-data/lang/roa/pt", expectedBytes: 95)
            ] + commonEspeakFiles,
            kind: .vits(model: "pt_PT-tugao-medium.onnx")
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
