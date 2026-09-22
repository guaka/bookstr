import AVFoundation
import Foundation
import SherpaOnnx
import UIKit

private final class NeuralSpeechRenderer: NeuralSpeechSynthesizing, @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.bookstr.neural-speech", qos: .userInitiated)
    private var engineID: SpeechEngineID?
    private var synthesizer: SherpaOnnxOfflineTtsWrapper?
    private var constrained = false

    func setConstrained(_ constrained: Bool) {
        self.constrained = constrained
    }

    func unload() {
        queue.async {
            autoreleasepool { self.releaseSynthesizer() }
        }
    }

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
        task = UIApplication.shared.beginBackgroundTask(withName: "bookstr-neural-tts", expirationHandler: {
            BookstrDebugLog.shared.record("bgTask synth expired")
            endTask()
        })
        BookstrDebugLog.shared.record(
            "synth begin engine=\(engine.rawValue) chars=\(text.count) qos=userInitiated constrained=\(constrained)"
        )
        queue.async {
            defer { DispatchQueue.main.async(execute: endTask) }
            // sherpa-onnx's toCPointer uses NSString.utf8String, which is only
            // valid until the current autorelease pool pops. This queue has no
            // pool unless we install one, so Kokoro/espeak would read freed text
            // after a phrase or two.
            autoreleasepool {
                do {
                    let phrases = NeuralSpeechInput.synthesisPhrases(text, engine: engine)
                    guard !phrases.isEmpty else {
                        completion(.success((NeuralSpeechInput.silenceSamples, 24_000)))
                        return
                    }
                    let spec = try self.spec(for: engine)
                    let synthesizer = try self.synthesizer(for: spec)
                    let speaker: Int
                    switch spec.kind {
                    case .kokoro(_, _, let configuredSpeaker, _): speaker = configuredSpeaker
                    case .vits: speaker = 0
                    }
                    var collected: [Float] = []
                    var rate: Double = 0
                    for phrase in phrases {
                        // Nested pool so each NSString.utf8String dies with that generate,
                        // and withCString keeps Swift's UTF-8 buffer alive for the C call.
                        autoreleasepool {
                            let generated = phrase.withCString { _ in
                                synthesizer.generate(text: phrase, sid: speaker, speed: speed)
                            }
                            guard generated.audio != nil else { return }
                            let samples = Array(generated.samples)
                            let phraseRate = Double(generated.sampleRate)
                            guard !samples.isEmpty, phraseRate > 0 else { return }
                            if collected.isEmpty { rate = phraseRate }
                            collected.append(contentsOf: samples)
                        }
                    }
                    if collected.isEmpty || rate <= 0 {
                        completion(.success((NeuralSpeechInput.silenceSamples, 24_000)))
                    } else {
                        completion(.success((collected, rate)))
                    }
                } catch {
                    BookstrDebugLog.shared.record("synth error \(error.localizedDescription)")
                    completion(.failure(error))
                }
            }
        }
    }

    private func spec(for id: SpeechEngineID) throws -> SpeechModelSpec {
        guard let spec = SpeechModelCatalog.model(id), spec.isInstalled else {
            throw NeuralSpeechError.modelNotInstalled
        }
        return spec
    }

    private func releaseSynthesizer() {
        synthesizer = nil
        engineID = nil
    }

    private func synthesizer(for spec: SpeechModelSpec) throws -> SherpaOnnxOfflineTtsWrapper {
        if engineID == spec.id, let synthesizer { return synthesizer }
        // DestroyOfflineTts must run before another ONNX session is constructed.
        releaseSynthesizer()
        let created: SherpaOnnxOfflineTtsWrapper
        switch spec.kind {
        case .kokoro(let model, let voices, _, let language):
            let kokoro = sherpaOnnxOfflineTtsKokoroModelConfig(
                model: spec.fileURL(model).path,
                voices: spec.fileURL(voices).path,
                tokens: spec.tokensURL.path,
                dataDir: spec.dataDirectory.path,
                lang: language ?? ""
            )
            let modelConfig = sherpaOnnxOfflineTtsModelConfig(kokoro: kokoro, numThreads: NeuralSpeechBudget.onnxThreads)
            var config = sherpaOnnxOfflineTtsConfig(model: modelConfig, maxNumSentences: 1)
            created = SherpaOnnxOfflineTtsWrapper(config: &config)
        case .vits(let model):
            let vits = sherpaOnnxOfflineTtsVitsModelConfig(
                model: spec.fileURL(model).path,
                tokens: spec.tokensURL.path,
                dataDir: spec.dataDirectory.path
            )
            let modelConfig = sherpaOnnxOfflineTtsModelConfig(vits: vits, numThreads: NeuralSpeechBudget.onnxThreads)
            var config = sherpaOnnxOfflineTtsConfig(model: modelConfig, maxNumSentences: 1)
            created = SherpaOnnxOfflineTtsWrapper(config: &config)
        }
        guard created.sampleRate > 0 else { throw NeuralSpeechError.modelCouldNotLoad }
        engineID = spec.id
        synthesizer = created
        BookstrDebugLog.shared.record("model loaded \(spec.id.rawValue) rate=\(created.sampleRate)")
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
    private let keepAliveMixer = AVAudioMixerNode()
    private var connectedRate: Double = 0
    private var keepAliveRate: Double = 0
    private var keepAliveEnabled = false

    var isPlaying: Bool { player.isPlaying || keepAlive.isPlaying }

    init() {
        audioEngine.attach(player)
        audioEngine.attach(keepAlive)
        audioEngine.attach(keepAliveMixer)
        keepAliveMixer.outputVolume = 1
    }

    func reset() {}

    func pause() {
        player.pause()
        keepAlive.pause()
    }

    func resume() {
        do {
            try ensureEngineRunning()
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            return
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
            if keepAliveEnabled {
                BookstrDebugLog.shared.record("keepAlive off")
            }
            keepAliveEnabled = false
            keepAlive.stop()
            keepAliveRate = 0
            return
        }
        let rate = sampleRate > 0 ? sampleRate : 24_000
        if keepAliveEnabled, keepAliveRate == rate, keepAlive.isPlaying, connectedRate == rate {
            return
        }
        keepAliveEnabled = true
        keepAliveRate = rate
        do {
            try installKeepAlive(sampleRate: rate)
            BookstrDebugLog.shared.record("keepAlive on rate=\(Int(rate))")
        } catch {
            keepAliveEnabled = false
            keepAliveRate = 0
            BookstrDebugLog.shared.record("keepAlive fail \(error.localizedDescription)")
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
        if keepAliveEnabled, keepAliveRate == sampleRate, keepAlive.isPlaying == false {
            try? installKeepAlive(sampleRate: sampleRate)
        }
        if player.isPlaying == false {
            player.play()
        }
    }

    private func prepare(sampleRate: Double) throws {
        if connectedRate != sampleRate {
            BookstrDebugLog.shared.record(
                "engine reconfigure \(Int(connectedRate))->\(Int(sampleRate))"
            )
            // Never disconnect while nodes are playing — that hard-crashes AVAudioEngine.
            let resumeKeepAlive = keepAliveEnabled
            keepAlive.stop()
            player.stop()
            if audioEngine.isRunning {
                audioEngine.stop()
            }
            audioEngine.disconnectNodeOutput(player)
            audioEngine.disconnectNodeOutput(keepAlive)
            audioEngine.disconnectNodeOutput(keepAliveMixer)
            guard let format = AVAudioFormat(
                commonFormat: .pcmFormatFloat32,
                sampleRate: sampleRate,
                channels: 1,
                interleaved: false
            ) else { throw NeuralSpeechError.generationFailed }
            audioEngine.connect(player, to: audioEngine.mainMixerNode, format: format)
            audioEngine.connect(keepAlive, to: keepAliveMixer, format: format)
            audioEngine.connect(keepAliveMixer, to: audioEngine.mainMixerNode, format: format)
            connectedRate = sampleRate
            try ensureEngineRunning()
            if resumeKeepAlive {
                try installKeepAlive(sampleRate: sampleRate)
            }
        } else {
            try ensureEngineRunning()
        }
        try AVAudioSession.sharedInstance().setActive(true)
    }

    private func installKeepAlive(sampleRate: Double) throws {
        try prepare(sampleRate: sampleRate)
        keepAlive.stop()
        let silence = NeuralSpeechAudio.keepAliveSilence(sampleRate: sampleRate)
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(silence.count)),
              let channel = buffer.floatChannelData?[0]
        else { throw NeuralSpeechError.generationFailed }
        buffer.frameLength = AVAudioFrameCount(silence.count)
        silence.withUnsafeBufferPointer { source in
            guard let address = source.baseAddress else { return }
            channel.update(from: address, count: silence.count)
        }
        keepAlive.scheduleBuffer(buffer, at: nil, options: .loops)
        if keepAlive.isPlaying == false {
            keepAlive.play()
        }
    }

    private func ensureEngineRunning() throws {
        if audioEngine.isRunning == false {
            try audioEngine.start()
        }
    }
}

@MainActor
final class NeuralSpeechPlayback {
    private let renderer = NeuralSpeechRenderer()
    private let audioPlayer = NeuralAudioPlayer()
    private let session: NeuralSpeechSession
    private var playbackTask = UIBackgroundTaskIdentifier.invalid
    private(set) var isPaused = false

    var isPlaying: Bool { session.isPlaying }

    init() {
        session = NeuralSpeechSession(synthesizer: renderer, player: audioPlayer)
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.session.setConstrained(true) }
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.session.setConstrained(false) }
        }
        if UIApplication.shared.applicationState != .active {
            session.setConstrained(true)
        }
    }

    func play(
        chunks: [SpeechQueueChunk],
        engine: SpeechEngineID,
        speed: Float,
        onPhrase: @escaping (SpeechQueueChunk) -> Void,
        onProgress: @escaping (Int, Int) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        isPaused = false
        beginPlaybackTask()
        session.start(
            chunks: chunks,
            engine: engine,
            speed: speed,
            onPhrase: onPhrase,
            onProgress: onProgress,
            completion: { [weak self] result in
                self?.endPlaybackTask()
                completion(result)
            }
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
            onProgress: { _, _ in },
            completion: completion
        )
    }

    func pause() {
        isPaused = true
        session.pause()
    }

    func resume() {
        isPaused = false
        beginPlaybackTask()
        session.resume()
    }

    func stop() {
        isPaused = false
        session.stop()
        endPlaybackTask()
    }

    func unload() {
        stop()
        renderer.unload()
    }

    private func beginPlaybackTask() {
        endPlaybackTask()
        playbackTask = UIApplication.shared.beginBackgroundTask(withName: "bookstr-neural-playback") { [weak self] in
            BookstrDebugLog.shared.record("bgTask playback expired")
            self?.endPlaybackTask()
        }
        BookstrDebugLog.shared.record("bgTask playback begin")
    }

    private func endPlaybackTask() {
        guard playbackTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(playbackTask)
        playbackTask = .invalid
        BookstrDebugLog.shared.record("bgTask playback end")
    }
}
