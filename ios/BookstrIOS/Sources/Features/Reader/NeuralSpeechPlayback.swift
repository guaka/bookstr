import AVFoundation
import Foundation
import SherpaOnnx
import UIKit

private final class NeuralSpeechRenderer: NeuralSpeechSynthesizing, @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.bookstr.neural-speech", qos: .userInitiated)
    private var engineID: SpeechEngineID?
    private var synthesizer: SherpaOnnxOfflineTtsWrapper?

    func synthesize(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping (Result<(samples: [Float], sampleRate: Double), Error>) -> Void
    ) {
        // beginBackgroundTask must run on the main thread; callers are MainActor.
        var task = UIBackgroundTaskIdentifier.invalid
        let endTask = {
            if task != .invalid {
                UIApplication.shared.endBackgroundTask(task)
                task = .invalid
            }
        }
        task = UIApplication.shared.beginBackgroundTask(withName: "bookstr-neural-tts", expirationHandler: endTask)
        queue.async {
            defer { DispatchQueue.main.async(execute: endTask) }
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

private final class NeuralAudioPlayer: NeuralSpeechScheduling {
    private let audioEngine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let keepAlive = AVAudioPlayerNode()
    private var connectedRate: Double = 0
    private var keepAliveRate: Double = 0
    private var keepAliveEnabled = false

    var isPlaying: Bool { player.isPlaying || keepAlive.isPlaying }

    init() {
        audioEngine.attach(player)
        audioEngine.attach(keepAlive)
    }

    func reset() {}

    func pause() {
        player.pause()
        keepAlive.pause()
    }

    func resume() {
        if audioEngine.isRunning == false {
            try? audioEngine.start()
        }
        if keepAliveEnabled, keepAlive.isPlaying == false {
            keepAlive.play()
        }
        if player.isPlaying == false {
            player.play()
        }
    }

    func stop() {
        keepAliveEnabled = false
        keepAliveRate = 0
        keepAlive.stop()
        player.stop()
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        connectedRate = 0
    }

    func setKeepAliveActive(_ active: Bool, sampleRate: Double) {
        guard active else {
            keepAliveEnabled = false
            keepAlive.stop()
            keepAliveRate = 0
            return
        }
        let rate = sampleRate > 0 ? sampleRate : 24_000
        if keepAliveEnabled, keepAliveRate == rate, keepAlive.isPlaying {
            return
        }
        keepAliveEnabled = true
        keepAliveRate = rate
        keepAlive.stop()
        do {
            try prepare(sampleRate: rate)
            let silence = NeuralSpeechAudio.keepAliveSilence(sampleRate: rate)
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: rate,
                channels: 1,
                interleaved: false
            ),
                  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(silence.count)),
                  let channel = buffer.floatChannelData?[0]
            else { return }
            buffer.frameLength = AVAudioFrameCount(silence.count)
            silence.withUnsafeBufferPointer { source in
                guard let address = source.baseAddress else { return }
                channel.update(from: address, count: silence.count)
            }
            keepAlive.scheduleBuffer(buffer, at: nil, options: .loops)
            if keepAlive.isPlaying == false {
                keepAlive.play()
            }
        } catch {
            keepAliveEnabled = false
        }
    }

    func schedule(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping () -> Void
    ) throws {
        try prepare(sampleRate: sampleRate)
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0]
        else { throw NeuralSpeechError.generationFailed }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            guard let address = source.baseAddress else { return }
            channel.update(from: address, count: samples.count)
        }
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in
            DispatchQueue.main.async(execute: completion)
        }
        if player.isPlaying == false {
            player.play()
        }
    }

    private func prepare(sampleRate: Double) throws {
        if connectedRate != sampleRate {
            audioEngine.disconnectNodeOutput(player)
            audioEngine.disconnectNodeOutput(keepAlive)
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: 1,
                interleaved: false
            ) else { throw NeuralSpeechError.generationFailed }
            audioEngine.connect(player, to: audioEngine.mainMixerNode, format: format)
            audioEngine.connect(keepAlive, to: audioEngine.mainMixerNode, format: format)
            connectedRate = sampleRate
        }
        if audioEngine.isRunning == false {
            try audioEngine.start()
        }
        try AVAudioSession.sharedInstance().setActive(true)
    }
}

@MainActor
final class NeuralSpeechPlayback {
    private let renderer = NeuralSpeechRenderer()
    private let audioPlayer = NeuralAudioPlayer()
    private let session: NeuralSpeechSession
    private(set) var isPaused = false

    var isPlaying: Bool { session.isPlaying }

    init() {
        session = NeuralSpeechSession(synthesizer: renderer, player: audioPlayer)
    }

    func play(
        chunks: [SpeechQueueChunk],
        engine: SpeechEngineID,
        speed: Float,
        onPhrase: @escaping (SpeechQueueChunk) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        isPaused = false
        session.start(
            chunks: chunks,
            engine: engine,
            speed: speed,
            onPhrase: onPhrase,
            completion: completion
        )
    }

    func play(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        play(
            chunks: [SpeechQueueChunk(text: text, offset: 0, pauseSeconds: 0)],
            engine: engine,
            speed: speed,
            onPhrase: { _ in },
            completion: completion
        )
    }

    func pause() {
        isPaused = true
        session.pause()
    }

    func resume() {
        isPaused = false
        session.resume()
    }

    func stop() {
        isPaused = false
        session.stop()
    }
}
