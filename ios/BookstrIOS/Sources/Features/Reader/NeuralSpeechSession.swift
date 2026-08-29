import Foundation

enum NeuralSpeechInput {
    static let silenceSamples: [Float] = [0, 0, 0, 0, 0, 0, 0, 0]
    /// Kokoro v0.19 aborts the process when phoneme IDs reach `style_dim[0]` (510).
    /// English expands past that after a long sentence, so keep phrases short.
    static let kokoroCharacterLimit = 140

    static func speakable(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.contains(where: { $0.isLetter || $0.isNumber }) else { return nil }
        return trimmed
    }

    static func synthesisPhrases(_ text: String, engine: SpeechEngineID) -> [String] {
        guard let spoken = speakable(text) else { return [] }
        guard engine == .kokoroEnglish else { return [spoken] }
        return splitForKokoro(spoken)
    }

    static func splitForKokoro(_ text: String, limit: Int = kokoroCharacterLimit) -> [String] {
        let limit = max(1, limit)
        guard text.count > limit else { return [text] }
        var phrases: [String] = []
        var cursor = text.startIndex
        while cursor < text.endIndex {
            if text.distance(from: cursor, to: text.endIndex) <= limit {
                if let tail = speakable(String(text[cursor...])) {
                    phrases.append(tail)
                }
                break
            }
            let windowEnd = text.index(cursor, offsetBy: limit)
            let window = text[cursor..<windowEnd]
            let breakIndex = window.lastIndex(where: {
                $0.isWhitespace || $0 == "." || $0 == "!" || $0 == "?" || $0 == ";" || $0 == ":" || $0 == ","
            }) ?? text.index(before: windowEnd)
            if let piece = speakable(String(text[cursor...breakIndex])) {
                phrases.append(piece)
            }
            cursor = text.index(after: breakIndex)
            while cursor < text.endIndex, text[cursor].isWhitespace {
                cursor = text.index(after: cursor)
            }
        }
        return phrases.isEmpty ? [text] : phrases
    }
}

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
    func setConstrained(_ constrained: Bool)
    func unload()
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

enum NeuralSpeechBudget {
    /// Four IntraOp threads so Kokoro stays ahead of playback. Two threads made
    /// some phrases slower than the remaining audio, which opened long gaps.
    static let onnxThreads = 4
    static let foregroundLookahead = 4
    /// Same depth as foreground. A shallower background queue underruns on short
    /// phrases while the next one is still synthesizing.
    static let backgroundLookahead = 4

    static func maxSpokenAhead(constrained: Bool) -> Int {
        constrained ? backgroundLookahead : foregroundLookahead
    }

    /// Synthesis must stay user-initiated even with the screen off. Utility QoS
    /// lets iOS defer the next phrase until after the current buffer underruns.
    static func synthesisQoS(constrained _: Bool) -> DispatchQoS.QoSClass {
        .userInitiated
    }
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
    static var maxSpokenAhead: Int { NeuralSpeechBudget.foregroundLookahead }

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
    private var constrained = false

    var isPlaying: Bool { player.isPlaying || queuedOnPlayer > 0 || synthesizing }

    private var lookahead: Int { NeuralSpeechBudget.maxSpokenAhead(constrained: constrained) }

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

    func setConstrained(_ constrained: Bool) {
        guard self.constrained != constrained else { return }
        self.constrained = constrained
        synthesizer.setConstrained(constrained)
        BookstrDebugLog.shared.record(
            "budget constrained=\(constrained) ahead=\(lookahead) threads=\(NeuralSpeechBudget.onnxThreads)"
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
        synthesizer.unload()
        if hadWork {
            BookstrDebugLog.shared.record("stop")
        }
    }

    private func prefetch() {
        guard !synthesizing, nextRender < chunks.count else { return }
        guard spokenQueued + ready.count < lookahead else { return }
        let index = nextRender
        let chunk = chunks[index]
        guard let text = NeuralSpeechInput.speakable(chunk.speak) else {
            ready[index] = (NeuralSpeechInput.silenceSamples, sampleRate)
            nextRender = index + 1
            BookstrDebugLog.shared.record("synth skip empty #\(index)")
            scheduleReady()
            prefetch()
            return
        }
        synthesizing = true
        let active = generation
        synthesizer.synthesize(text: text, engine: engine, speed: speed) { [weak self] result in
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
              spokenQueued < lookahead,
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

