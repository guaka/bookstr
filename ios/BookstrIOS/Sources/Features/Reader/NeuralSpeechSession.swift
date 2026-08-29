import Foundation

enum NeuralSpeechAudio {
    static func trimTrailingSilence(
        _ samples: [Float],
        sampleRate: Double,
        threshold: Float = 0.012,
        keepMilliseconds: Double = 18
    ) -> [Float] {
        guard samples.count > 1, sampleRate > 0 else { return samples }
        var last = samples.count - 1
        while last >= 0, abs(samples[last]) < threshold {
            last -= 1
        }
        guard last >= 0 else { return samples }
        let keep = max(0, Int((keepMilliseconds / 1000.0) * sampleRate))
        let end = min(samples.count, last + 1 + keep)
        if end >= samples.count { return samples }
        return Array(samples[..<end])
    }

    static func withLeadingPause(_ samples: [Float], sampleRate: Double, pauseSeconds: Double) -> [Float] {
        guard pauseSeconds > 0, sampleRate > 0 else { return samples }
        let count = Int((pauseSeconds * sampleRate).rounded(.down))
        guard count > 0 else { return samples }
        return Array(repeating: 0, count: count) + samples
    }

    /// Looping pad for a side-channel keep-alive node (not inserted into spoken audio).
    static func keepAliveSilence(sampleRate: Double, seconds: Double = 0.25) -> [Float] {
        let rate = sampleRate > 0 ? sampleRate : 24_000
        let count = max(1, Int((max(0.05, seconds) * rate).rounded(.down)))
        return Array(repeating: 0, count: count)
    }
}

protocol NeuralSpeechSynthesizing: AnyObject {
    func synthesize(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping (Result<(samples: [Float], sampleRate: Double), Error>) -> Void
    )
}

protocol NeuralSpeechScheduling: AnyObject {
    var isPlaying: Bool { get }
    func reset()
    func pause()
    func resume()
    func stop()
    /// Side-channel silence so iOS does not suspend the app without delaying spoken phrases.
    func setKeepAliveActive(_ active: Bool, sampleRate: Double)
    func schedule(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping () -> Void
    ) throws
}

@MainActor
final class NeuralSpeechSession {
    /// Keep a few spoken buffers ahead for smooth playback without unbounded PCM growth.
    static let maxSpokenAhead = 3

    private let synthesizer: NeuralSpeechSynthesizing
    private let player: NeuralSpeechScheduling
    private var chunks: [SpeechQueueChunk] = []
    private var engine = SpeechEngineID.system
    private var speed: Float = 1
    private var generation = 0
    private var nextRender = 0
    private var nextSchedule = 0
    private var queuedOnPlayer = 0
    private var spokenQueued = 0
    private var synthesizing = false
    private var sampleRate: Double = 24_000
    private var ready: [Int: (samples: [Float], sampleRate: Double)] = [:]
    private var onPhrase: ((SpeechQueueChunk) -> Void)?
    private var onComplete: ((Result<Void, Error>) -> Void)?

    var isPlaying: Bool { player.isPlaying || queuedOnPlayer > 0 || synthesizing }

    init(synthesizer: NeuralSpeechSynthesizing, player: NeuralSpeechScheduling) {
        self.synthesizer = synthesizer
        self.player = player
    }

    func start(
        chunks: [SpeechQueueChunk],
        engine: SpeechEngineID,
        speed: Float,
        onPhrase: @escaping (SpeechQueueChunk) -> Void,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        stop()
        guard !chunks.isEmpty else {
            completion(.success(()))
            return
        }
        generation += 1
        self.chunks = chunks
        self.engine = engine
        self.speed = speed
        self.onPhrase = onPhrase
        self.onComplete = completion
        nextRender = 0
        nextSchedule = 0
        queuedOnPlayer = 0
        spokenQueued = 0
        synthesizing = false
        ready = [:]
        player.reset()
        player.setKeepAliveActive(true, sampleRate: sampleRate)
        prefetch()
    }

    func pause() { player.pause() }
    func resume() { player.resume() }

    func stop() {
        generation += 1
        synthesizing = false
        queuedOnPlayer = 0
        spokenQueued = 0
        ready.removeAll()
        chunks.removeAll()
        onPhrase = nil
        onComplete = nil
        player.setKeepAliveActive(false, sampleRate: sampleRate)
        player.stop()
    }

    private func prefetch() {
        guard !synthesizing, nextRender < chunks.count else { return }
        guard spokenQueued + ready.count < Self.maxSpokenAhead else { return }
        synthesizing = true
        let index = nextRender
        let active = generation
        let chunk = chunks[index]
        synthesizer.synthesize(text: chunk.speak, engine: engine, speed: speed) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.generation == active else { return }
                self.synthesizing = false
                switch result {
                case .failure(let error):
                    self.fail(error)
                case .success(let audio):
                    let rate = audio.sampleRate > 0 ? audio.sampleRate : self.sampleRate
                    if rate != self.sampleRate {
                        self.sampleRate = rate
                        self.player.setKeepAliveActive(true, sampleRate: rate)
                    } else {
                        self.sampleRate = rate
                    }
                    self.ready[index] = audio
                    self.nextRender = index + 1
                    self.scheduleReady()
                    self.prefetch()
                }
            }
        }
    }

    private func scheduleReady() {
        while nextSchedule < chunks.count,
              spokenQueued < Self.maxSpokenAhead,
              let audio = ready[nextSchedule] {
            let index = nextSchedule
            nextSchedule += 1
            ready[index] = nil
            let startsNow = spokenQueued == 0
            queuedOnPlayer += 1
            spokenQueued += 1
            if startsNow {
                onPhrase?(chunks[index])
            }
            let active = generation
            do {
                let voiced = NeuralSpeechAudio.trimTrailingSilence(
                    audio.samples,
                    sampleRate: audio.sampleRate
                )
                let samples = NeuralSpeechAudio.withLeadingPause(
                    voiced,
                    sampleRate: audio.sampleRate,
                    pauseSeconds: chunks[index].pauseSeconds
                )
                try player.schedule(samples: samples, sampleRate: audio.sampleRate) { [weak self] in
                    DispatchQueue.main.async {
                        guard let self, self.generation == active else { return }
                        self.queuedOnPlayer -= 1
                        self.spokenQueued -= 1
                        if index + 1 < self.chunks.count, self.spokenQueued > 0 {
                            self.onPhrase?(self.chunks[index + 1])
                        }
                        if index == self.chunks.count - 1 {
                            self.finish()
                            return
                        }
                        self.scheduleReady()
                        self.prefetch()
                    }
                }
            } catch {
                fail(error)
                return
            }
        }
        prefetch()
    }

    private func finish() {
        let completion = onComplete
        stop()
        completion?(.success(()))
    }

    private func fail(_ error: Error) {
        let completion = onComplete
        stop()
        completion?(.failure(error))
    }
}
