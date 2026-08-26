import AVFoundation
import Foundation
import SherpaOnnx

private final class NeuralSpeechRenderer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.bookstr.neural-speech", qos: .userInitiated)
    private var engineID: SpeechEngineID?
    private var synthesizer: SherpaOnnxOfflineTtsWrapper?

    func render(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping @Sendable (Result<(samples: [Float], sampleRate: Double), Error>) -> Void
    ) {
        queue.async {
            do {
                let spec = try self.spec(for: engine)
                let synthesizer = try self.synthesizer(for: spec)
                let speaker: Int
                switch spec.kind {
                case .kokoro(_, _, let configuredSpeaker): speaker = configuredSpeaker
                case .vits: speaker = 0
                }
                let audio = synthesizer.generate(text: text, sid: speaker, speed: speed)
                guard !audio.samples.isEmpty, audio.sampleRate > 0 else {
                    throw NeuralSpeechError.generationFailed
                }
                completion(.success((audio.samples, Double(audio.sampleRate))))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func spec(for id: SpeechEngineID) throws -> SpeechModelSpec {
        guard let spec = SpeechModelCatalog.model(id), spec.isInstalled else {
            throw NeuralSpeechError.modelNotInstalled
        }
        return spec
    }

    private func synthesizer(for spec: SpeechModelSpec) throws -> SherpaOnnxOfflineTtsWrapper {
        if engineID == spec.id, let synthesizer { return synthesizer }
        let created: SherpaOnnxOfflineTtsWrapper
        switch spec.kind {
        case .kokoro(let model, let voices, _):
            let kokoro = sherpaOnnxOfflineTtsKokoroModelConfig(
                model: spec.fileURL(model).path,
                voices: spec.fileURL(voices).path,
                tokens: spec.tokensURL.path,
                dataDir: spec.dataDirectory.path
            )
            let modelConfig = sherpaOnnxOfflineTtsModelConfig(kokoro: kokoro, numThreads: 2)
            var config = sherpaOnnxOfflineTtsConfig(model: modelConfig, maxNumSentences: 1)
            created = SherpaOnnxOfflineTtsWrapper(config: &config)
        case .vits(let model):
            let vits = sherpaOnnxOfflineTtsVitsModelConfig(
                model: spec.fileURL(model).path,
                tokens: spec.tokensURL.path,
                dataDir: spec.dataDirectory.path
            )
            let modelConfig = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: 2)
            var config = sherpaOnnxOfflineTtsConfig(model: modelConfig, maxNumSentences: 1)
            created = SherpaOnnxOfflineTtsWrapper(config: &config)
        }
        guard created.sampleRate > 0 else { throw NeuralSpeechError.modelCouldNotLoad }
        engineID = spec.id
        synthesizer = created
        return created
    }
}

enum NeuralSpeechError: LocalizedError {
    case modelNotInstalled
    case modelCouldNotLoad
    case generationFailed

    var errorDescription: String? {
        switch self {
        case .modelNotInstalled: "Download this reading voice in Settings first."
        case .modelCouldNotLoad: "The downloaded reading voice could not be loaded."
        case .generationFailed: "The reading voice could not generate audio for this text."
        }
    }
}

@MainActor
final class NeuralSpeechPlayback {
    private let renderer = NeuralSpeechRenderer()
    private let audioEngine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var requestID: UUID?
    private(set) var isPaused = false

    var isPlaying: Bool { player.isPlaying }

    init() {
        audioEngine.attach(player)
    }

    func play(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        stop()
        let id = UUID()
        requestID = id
        renderer.render(text: text, engine: engine, speed: speed) { [weak self] result in
            Task { @MainActor in
                guard let self, self.requestID == id else { return }
                switch result {
                case .failure(let error):
                    self.requestID = nil
                    completion(.failure(error))
                case .success(let rendered):
                    do {
                        try self.schedule(rendered.samples, sampleRate: rendered.sampleRate, requestID: id, completion: completion)
                    } catch {
                        self.requestID = nil
                        completion(.failure(error))
                    }
                }
            }
        }
    }

    func pause() {
        player.pause()
        isPaused = true
    }

    func resume() {
        guard requestID != nil else { return }
        isPaused = false
        player.play()
    }

    func stop() {
        requestID = nil
        isPaused = false
        player.stop()
        audioEngine.stop()
    }

    private func schedule(
        _ samples: [Float],
        sampleRate: Double,
        requestID: UUID,
        completion: @escaping (Result<Void, Error>) -> Void
    ) throws {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0]
        else { throw NeuralSpeechError.generationFailed }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            guard let address = source.baseAddress else { return }
            channel.update(from: address, count: samples.count)
        }
        audioEngine.disconnectNodeOutput(player)
        audioEngine.connect(player, to: audioEngine.mainMixerNode, format: format)
        try audioEngine.start()
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.requestID == requestID else { return }
                self.requestID = nil
                completion(.success(()))
            }
        }
        player.play()
        isPaused = false
    }
}
