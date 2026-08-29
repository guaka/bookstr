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
    /// Uses inaudible dither — pure zeros are treated as silence and iOS suspends/jetsams the app.
    static func keepAliveSilence(sampleRate: Double, seconds: Double = 0.35) -> [Float] {
        let rate = sampleRate > 0 ? sampleRate : 24_000
        let count = max(1, Int((max(0.05, seconds) * rate).rounded(.down)))
        // ~-80 dBFS alternating dither: enough for AVAudioSession, not audible on earbuds.
        let amplitude: Float = 1e-4
        return (0..<count).map { ($0 & 1) == 0 ? amplitude : -amplitude }
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

enum NeuralSpeechProgress {
    static let tickNanoseconds: UInt64 = 750_000_000

    /// Maps elapsed playback into a short highlight window so saved CFIs advance during a phrase.
    static func highlightRange(
        offset: Int,
        textLength: Int,
        elapsed: TimeInterval,
        duration: TimeInterval
    ) -> (start: Int, end: Int) {
        let length = max(1, textLength)
        let fraction = duration > 0 ? min(1, max(0, elapsed / duration)) : 0
        let cursor = offset + min(length - 1, max(0, Int((Double(length) * fraction).rounded(.down))))
        let end = min(offset + length, cursor + max(1, min(12, offset + length - cursor)))
        return (cursor, max(end, cursor + 1))
    }
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
    private var phraseDurations: [Int: TimeInterval] = [:]
    private var onPhrase: ((SpeechQueueChunk) -> Void)?
    private var onProgress: ((Int, Int) -> Void)?
    private var onComplete: ((Result<Void, Error>) -> Void)?
    private var progressTask: Task<Void, Never>?
    private var activePhrase: SpeechQueueChunk?
    private var phraseDuration: TimeInterval = 0
    private var phraseElapsed: TimeInterval = 0
    private var phraseAnchor = Date()
    private var phrasePaused = false

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
        onProgress: @escaping (Int, Int) -> Void,
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
        self.onProgress = onProgress
        self.onComplete = completion
        nextRender = 0
        nextSchedule = 0
        queuedOnPlayer = 0
        spokenQueued = 0
        synthesizing = false
        ready = [:]
        phraseDurations = [:]
        player.reset()
        // Keep-alive starts after the first buffer so the engine graph matches the model rate.
        BookstrDebugLog.shared.record(
            "start engine=\(engine.rawValue) chunks=\(chunks.count) speed=\(String(format: "%.2f", speed))"
        )
        prefetch()
    }

    func pause() {
        if !phrasePaused {
            phraseElapsed += Date().timeIntervalSince(phraseAnchor)
            phrasePaused = true
        }
        BookstrDebugLog.shared.record("pause")
        player.pause()
    }

    func resume() {
        if phrasePaused {
            phraseAnchor = Date()
            phrasePaused = false
        }
        BookstrDebugLog.shared.record("resume")
        player.resume()
    }

    func stop() {
        let hadWork = !chunks.isEmpty || synthesizing || queuedOnPlayer > 0
        generation += 1
        progressTask?.cancel()
        progressTask = nil
        activePhrase = nil
        synthesizing = false
        queuedOnPlayer = 0
        spokenQueued = 0
        ready.removeAll()
        phraseDurations.removeAll()
        chunks.removeAll()
        onPhrase = nil
        onProgress = nil
        onComplete = nil
        player.setKeepAliveActive(false, sampleRate: sampleRate)
        player.stop()
        if hadWork {
            BookstrDebugLog.shared.record("stop")
        }
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
                    self.sampleRate = rate
                    self.player.setKeepAliveActive(true, sampleRate: rate)
                    BookstrDebugLog.shared.record(
                        "synth ok #\(index) samples=\(audio.samples.count) rate=\(Int(rate))"
                    )
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
                let duration = Double(samples.count) / max(audio.sampleRate, 1)
                phraseDurations[index] = duration
                if startsNow {
                    announcePhrase(index)
                }
                try player.schedule(samples: samples, sampleRate: audio.sampleRate) { [weak self] in
                    DispatchQueue.main.async {
                        guard let self, self.generation == active else { return }
                        self.queuedOnPlayer -= 1
                        self.spokenQueued -= 1
                        if index + 1 < self.chunks.count, self.spokenQueued > 0 {
                            self.announcePhrase(index + 1)
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
                BookstrDebugLog.shared.record("schedule fail #\(index) \(error.localizedDescription)")
                fail(error)
                return
            }
        }
        prefetch()
    }

    private func announcePhrase(_ index: Int) {
        guard chunks.indices.contains(index) else { return }
        let chunk = chunks[index]
        onPhrase?(chunk)
        beginPhraseProgress(chunk, duration: phraseDurations[index] ?? 0.05)
    }

    private func beginPhraseProgress(_ chunk: SpeechQueueChunk, duration: TimeInterval) {
        activePhrase = chunk
        phraseDuration = max(0.05, duration)
        phraseElapsed = 0
        phraseAnchor = Date()
        phrasePaused = false
        emitProgress()
        progressTask?.cancel()
        let active = generation
        progressTask = Task { @MainActor [weak self] in
            while let self, self.generation == active, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: NeuralSpeechProgress.tickNanoseconds)
                guard self.generation == active, !Task.isCancelled else { return }
                self.emitProgress()
            }
        }
    }

    private func emitProgress() {
        guard let chunk = activePhrase else { return }
        let elapsed = phrasePaused
            ? phraseElapsed
            : phraseElapsed + Date().timeIntervalSince(phraseAnchor)
        let range = NeuralSpeechProgress.highlightRange(
            offset: chunk.offset,
            textLength: (chunk.text as NSString).length,
            elapsed: elapsed,
            duration: phraseDuration
        )
        onProgress?(range.start, range.end)
    }

    private func finish() {
        BookstrDebugLog.shared.record("finish")
        let completion = onComplete
        stop()
        completion?(.success(()))
    }

    private func fail(_ error: Error) {
        BookstrDebugLog.shared.record("fail \(error.localizedDescription)")
        let completion = onComplete
        stop()
        completion?(.failure(error))
    }
}

