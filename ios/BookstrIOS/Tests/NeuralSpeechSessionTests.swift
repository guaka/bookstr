import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

@MainActor
final class NeuralSpeechSessionTests: XCTestCase {
    func testTrimTrailingSilenceKeepsSpokenTailAndDropsPadding() {
        let spoken: [Float] = [0.4, -0.3, 0.02]
        let padding = Array(repeating: Float(0.001), count: 48)
        let trimmed = NeuralSpeechAudio.trimTrailingSilence(
            spoken + padding,
            sampleRate: 1_000,
            threshold: 0.012,
            keepMilliseconds: 5
        )
        XCTAssertEqual(trimmed, spoken + Array(repeating: Float(0.001), count: 5))
        XCTAssertEqual(NeuralSpeechAudio.trimTrailingSilence([0.2], sampleRate: 24_000), [0.2])
        XCTAssertEqual(NeuralSpeechAudio.trimTrailingSilence([0, 0, 0], sampleRate: 24_000), [0, 0, 0])
        XCTAssertEqual(NeuralSpeechAudio.trimTrailingSilence([0.5, 0.4], sampleRate: 0), [0.5, 0.4])
        XCTAssertEqual(
            NeuralSpeechAudio.trimTrailingSilence([0.5, 0.001], sampleRate: 1_000, keepMilliseconds: 50),
            [0.5, 0.001]
        )
        XCTAssertEqual(NeuralSpeechAudio.withLeadingPause([0.2], sampleRate: 1_000, pauseSeconds: 0), [0.2])
        XCTAssertEqual(NeuralSpeechAudio.withLeadingPause([0.2], sampleRate: 0, pauseSeconds: 0.4), [0.2])
        XCTAssertEqual(
            NeuralSpeechAudio.withLeadingPause([0.2], sampleRate: 1_000, pauseSeconds: 0.0004),
            [0.2]
        )
        XCTAssertEqual(
            NeuralSpeechAudio.withLeadingPause([0.2], sampleRate: 1_000, pauseSeconds: 0.003),
            [0, 0, 0, 0.2]
        )
        XCTAssertEqual(NeuralSpeechInput.speakable("  Hello.  "), "Hello.")
        XCTAssertNil(NeuralSpeechInput.speakable("   "))
        XCTAssertNil(NeuralSpeechInput.speakable("\n\t"))
        XCTAssertNil(NeuralSpeechInput.speakable("..."))
        XCTAssertNil(NeuralSpeechInput.speakable("—"))
        XCTAssertNil(NeuralSpeechInput.speakable("[*]"))
        XCTAssertEqual(NeuralSpeechInput.speakable("100000"), "100000")
        XCTAssertEqual(NeuralSpeechInput.silenceSamples.count, 8)
        XCTAssertTrue(NeuralSpeechInput.silenceSamples.allSatisfy { $0 == 0 })
        XCTAssertEqual(NeuralSpeechInput.kokoroCharacterLimit, 140)
        XCTAssertEqual(
            NeuralSpeechInput.synthesisPhrases("Hello there.", engine: .portuguesePortugal),
            ["Hello there."]
        )
        XCTAssertEqual(NeuralSpeechInput.synthesisPhrases("   ", engine: .kokoroEnglish), [])
        XCTAssertEqual(NeuralSpeechInput.synthesisPhrases("...", engine: .kokoroEnglish), [])
        let short = NeuralSpeechInput.synthesisPhrases("A short English sentence.", engine: .kokoroEnglish)
        XCTAssertEqual(short, ["A short English sentence."])
        let long = String(repeating: "word ", count: 80) + "end."
        let phrases = NeuralSpeechInput.splitForKokoro(long, limit: 40)
        XCTAssertGreaterThan(phrases.count, 1)
        XCTAssertTrue(phrases.allSatisfy { $0.count <= 40 })
        XCTAssertEqual(phrases.joined(separator: " ").replacingOccurrences(of: "  ", with: " "), long.trimmingCharacters(in: .whitespaces))
        XCTAssertEqual(NeuralSpeechInput.splitForKokoro("short", limit: 40), ["short"])
        XCTAssertEqual(NeuralSpeechInput.splitForKokoro(String(repeating: "a", count: 12), limit: 5).count, 3)
        XCTAssertEqual(NeuralSpeechInput.splitForKokoro("hello     world", limit: 5), ["hello", "world"])
        XCTAssertEqual(NeuralSpeechInput.splitForKokoro("... ...", limit: 2), ["... ..."])
        XCTAssertEqual(NeuralSpeechInput.splitForKokoro("ok", limit: 0), ["o", "k"])
    }

    func testEmptySpokenChunksAreSkippedWithoutCallingTheEngine() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var phrases: [SpeechQueueChunk] = []
        var finished = false
        let blank = SpeechQueueChunk(text: "   ", offset: 0, pauseSeconds: 0, speak: "   ")
        let marks = SpeechQueueChunk(text: "...", offset: 3, pauseSeconds: 0, speak: "...")
        let spoken = SpeechQueueChunk(text: "Hello.", offset: 4, pauseSeconds: 0)

        session.start(
            chunks: [blank, marks, spoken],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { phrases.append($0) },
            onProgress: { _, _ in },
            completion: { result in
                if case .success = result { finished = true }
            }
        )
        XCTAssertEqual(synthesizer.texts, ["Hello."])
        XCTAssertEqual(player.scheduledCount, 1)
        XCTAssertEqual(player.scheduledSampleCounts, [NeuralSpeechInput.silenceSamples.count])
        XCTAssertEqual(phrases, [blank])

        synthesizer.complete()
        await settle()
        player.finishNext()
        await settle()
        XCTAssertEqual(player.scheduledCount, 2)
        XCTAssertEqual(player.scheduledSampleCounts, [
            NeuralSpeechInput.silenceSamples.count,
            NeuralSpeechInput.silenceSamples.count,
        ])
        XCTAssertEqual(phrases, [blank, marks])
        player.finishNext()
        await settle()
        XCTAssertEqual(player.scheduledCount, 3)
        player.finishNext()
        await settle()
        XCTAssertEqual(phrases, [blank, marks, spoken])
        XCTAssertTrue(finished)
        session.stop()
    }

    func testSynthesizesGroupedThousandsWithoutCommas() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        session.start(
            chunks: [SpeechQueueChunk(text: "100,000", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        XCTAssertEqual(synthesizer.texts, ["100000"])
        session.stop()
    }

    func testEmptyChunksFinishImmediately() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var finished = false
        session.start(
            chunks: [],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in XCTFail("empty narration has no phrases") },
            onProgress: { _, _ in XCTFail("empty narration has no progress") },
            completion: { result in
                if case .success = result { finished = true }
            }
        )
        XCTAssertTrue(finished)
        XCTAssertTrue(synthesizer.texts.isEmpty)
    }

    func testPrefetchesNextPhraseWhileCurrentAudioIsQueuedAndUpdatesPositionPerPhrase() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        let first = SpeechQueueChunk(text: "One.", offset: 0, pauseSeconds: 0)
        let second = SpeechQueueChunk(text: "Two!", offset: 5, pauseSeconds: 0.4)
        var phrases: [SpeechQueueChunk] = []
        var finished = false

        session.start(
            chunks: [first, second],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { phrases.append($0) },
            onProgress: { _, _ in },
            completion: { result in
                if case .success = result { finished = true }
            }
        )
        XCTAssertEqual(synthesizer.texts, ["One."])
        XCTAssertFalse(player.keepAliveActive, "keep-alive waits for the first model sample rate")
        XCTAssertTrue(phrases.isEmpty)
        XCTAssertEqual(player.scheduledCount, 0)

        synthesizer.complete()
        await settle()
        XCTAssertTrue(player.keepAliveActive)
        XCTAssertEqual(phrases, [first])
        XCTAssertEqual(phrases[0].spokenEnd, 4)
        XCTAssertEqual(player.scheduledCount, 1)
        XCTAssertTrue(session.isPlaying)
        XCTAssertEqual(player.scheduledSampleCounts[0], 20)
        XCTAssertEqual(synthesizer.texts, ["One.", "Two!"], "the next phrase must start synthesizing before the current audio finishes")
        synthesizer.complete()
        await settle()
        XCTAssertEqual(player.scheduledCount, 1)
        XCTAssertEqual(phrases, [first], "the highlight stays on the playing phrase until its audio ends")

        player.finishNext()
        await settle()
        XCTAssertEqual(player.scheduledCount, 2)
        XCTAssertEqual(player.scheduledSampleCounts[1], 420)
        XCTAssertEqual(phrases, [first, second])
        XCTAssertEqual(phrases[1].offset, 5)
        XCTAssertEqual(phrases[1].spokenEnd, 9)

        player.finishNext()
        await settle()
        XCTAssertTrue(finished)
        XCTAssertFalse(player.keepAliveActive)
    }

    func testSideChannelKeepAliveDoesNotDelaySpokenAudio() async {
        let synthesizer = MockNeuralSynthesizer()
        synthesizer.sampleCount = 8
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        let first = SpeechQueueChunk(text: "One.", offset: 0, pauseSeconds: 0)
        let second = SpeechQueueChunk(text: "Two!", offset: 5, pauseSeconds: 0)
        var finished = false

        session.start(
            chunks: [first, second],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { result in
                if case .success = result { finished = true }
            }
        )
        XCTAssertFalse(player.keepAliveActive)
        XCTAssertEqual(player.scheduledCount, 0)
        synthesizer.complete()
        await settle()
        XCTAssertTrue(player.keepAliveActive)
        XCTAssertEqual(player.scheduledCount, 1)
        XCTAssertEqual(player.scheduledSampleCounts[0], 8)

        player.finishNext()
        await settle()
        synthesizer.complete()
        await settle()
        player.finishNext()
        await settle()
        XCTAssertTrue(finished)
    }

    func testLimitsSpokenLookaheadToAvoidBackgroundJetsam() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        let chunks = [
            SpeechQueueChunk(text: "One.", offset: 0, pauseSeconds: 0),
            SpeechQueueChunk(text: "Two.", offset: 5, pauseSeconds: 0),
            SpeechQueueChunk(text: "Three.", offset: 10, pauseSeconds: 0),
            SpeechQueueChunk(text: "Four.", offset: 17, pauseSeconds: 0),
            SpeechQueueChunk(text: "Five.", offset: 23, pauseSeconds: 0),
        ]
        session.start(
            chunks: chunks,
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        XCTAssertEqual(synthesizer.texts, ["One.", "Two.", "Three.", "Four."], "must not synthesize far ahead of playback")
        XCTAssertEqual(NeuralSpeechSession.maxSpokenAhead, 4)
        XCTAssertEqual(NeuralSpeechBudget.onnxThreads, 4)
        XCTAssertEqual(NeuralSpeechBudget.maxSpokenAhead(constrained: false), 4)
        XCTAssertEqual(NeuralSpeechBudget.maxSpokenAhead(constrained: true), 4)
        XCTAssertEqual(NeuralSpeechBudget.synthesisQoS(constrained: false), .userInitiated)
        XCTAssertEqual(NeuralSpeechBudget.synthesisQoS(constrained: true), .userInitiated)

        player.finishNext()
        await settle()
        XCTAssertEqual(synthesizer.texts, ["One.", "Two.", "Three.", "Four.", "Five."])
        session.stop()
    }

    func testBackgroundLookaheadKeepsTheSamePhrasePipelineAsForeground() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        session.setConstrained(true)
        XCTAssertTrue(synthesizer.constrained)
        session.start(
            chunks: [
                SpeechQueueChunk(text: "One.", offset: 0, pauseSeconds: 0),
                SpeechQueueChunk(text: "Two.", offset: 5, pauseSeconds: 0),
                SpeechQueueChunk(text: "Three.", offset: 10, pauseSeconds: 0),
                SpeechQueueChunk(text: "Four.", offset: 17, pauseSeconds: 0),
                SpeechQueueChunk(text: "Five.", offset: 23, pauseSeconds: 0),
            ],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        synthesizer.complete()
        await settle()
        XCTAssertEqual(synthesizer.texts, ["One.", "Two.", "Three.", "Four."])
        XCTAssertEqual(player.scheduledCount, 1)
        player.finishNext()
        await settle()
        XCTAssertEqual(synthesizer.texts, ["One.", "Two.", "Three.", "Four.", "Five."])
        session.stop()
    }

    func testPlayerFlushCannotSkipPrefetchedParagraphs() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        let paragraphs = (0..<5).map {
            SpeechQueueChunk(text: "Paragraph \($0).", offset: $0 * 20, pauseSeconds: $0 == 0 ? 0 : 0.75)
        }
        var spoken: [String] = []
        var finished = false
        session.start(
            chunks: paragraphs,
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { spoken.append($0.text) },
            onProgress: { _, _ in },
            completion: { result in if case .success = result { finished = true } }
        )
        for _ in 0..<4 {
            synthesizer.complete()
            await settle()
        }

        XCTAssertEqual(synthesizer.texts.count, 4, "rendering should still stay ahead of playback")
        XCTAssertEqual(player.completions.count, 1, "only the audible paragraph may be queued on the player")
        player.finishAllCurrentlyScheduled()
        await settle()
        XCTAssertEqual(spoken, ["Paragraph 0.", "Paragraph 1."])
        XCTAssertFalse(finished, "a player flush must not mark prefetched paragraphs as heard")

        synthesizer.complete()
        await settle()
        while !finished {
            player.finishNext()
            await settle()
        }
        XCTAssertEqual(spoken, paragraphs.map(\.text))
    }

    func testHighlightRangeAdvancesThroughPhrase() {
        let start = NeuralSpeechProgress.highlightRange(offset: 10, textLength: 100, elapsed: 0, duration: 10)
        XCTAssertEqual(start.start, 10)
        XCTAssertGreaterThan(start.end, start.start)
        let mid = NeuralSpeechProgress.highlightRange(offset: 10, textLength: 100, elapsed: 5, duration: 10)
        XCTAssertEqual(mid.start, 60)
        let end = NeuralSpeechProgress.highlightRange(offset: 10, textLength: 100, elapsed: 10, duration: 10)
        XCTAssertEqual(end.start, 109)
    }

    func testEmitsProgressOffsetsWhilePhrasePlays() async {
        let synthesizer = MockNeuralSynthesizer()
        synthesizer.sampleCount = 2_000
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var progress: [(Int, Int)] = []
        session.start(
            chunks: [SpeechQueueChunk(text: "Hello there friend.", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { start, end in progress.append((start, end)) },
            completion: { _ in }
        )
        synthesizer.complete()
        await settle()
        XCTAssertFalse(progress.isEmpty, "phrase start must report a progress window")
        XCTAssertEqual(progress[0].0, 0)
        XCTAssertGreaterThan(progress[0].1, progress[0].0)
        try? await Task.sleep(nanoseconds: NeuralSpeechProgress.tickNanoseconds + 50_000_000)
        await settle()
        XCTAssertGreaterThan(progress.count, 1, "progress must tick during playback")
        session.stop()
    }

    func testKeepAliveSilenceUsesSampleRate() {
        let pad = NeuralSpeechAudio.keepAliveSilence(sampleRate: 1_000, seconds: 0.25)
        XCTAssertEqual(pad.count, 250)
        XCTAssertTrue(pad.contains { abs($0) > 0 }, "dither must not be pure silence")
        XCTAssertEqual(NeuralSpeechAudio.keepAliveSilence(sampleRate: 0, seconds: 0.25).count, 6_000)
        XCTAssertEqual(NeuralSpeechAudio.keepAliveSilence(sampleRate: 1_000, seconds: 0).count, 50)
    }

    func testRenderFailureStopsSession() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var failed = false
        session.start(
            chunks: [SpeechQueueChunk(text: "Nope", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in XCTFail("failed render must not start a phrase") },
            onProgress: { _, _ in XCTFail("failed render must not report progress") },
            completion: { result in
                if case .failure = result { failed = true }
            }
        )
        synthesizer.fail(NSError(domain: "test", code: 1))
        await settle()
        XCTAssertTrue(failed)
        XCTAssertEqual(player.scheduledCount, 0)
        XCTAssertFalse(player.keepAliveActive)
    }

    func testStopIgnoresInFlightSynthesis() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var completed = false
        session.start(
            chunks: [SpeechQueueChunk(text: "Hold", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in XCTFail("stopped narration must not start a phrase") },
            onProgress: { _, _ in },
            completion: { _ in completed = true }
        )
        session.stop()
        synthesizer.complete()
        await settle()
        XCTAssertFalse(completed)
        XCTAssertTrue(player.completions.isEmpty)
    }

    func testPauseAndResumeForwardToPlayer() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        session.start(
            chunks: [SpeechQueueChunk(text: "Go", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        synthesizer.complete()
        await settle()
        session.pause()
        session.resume()
        XCTAssertEqual(player.pauseCount, 1)
        XCTAssertEqual(player.resumeCount, 1)
        session.stop()
    }

    func testScheduleFailureStopsSession() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        player.scheduleError = NSError(domain: "player", code: 2)
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        var failed = false
        session.start(
            chunks: [SpeechQueueChunk(text: "Nope", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { result in
                if case .failure = result { failed = true }
            }
        )
        synthesizer.complete()
        await settle()
        XCTAssertTrue(failed)
    }

    func testStopUnloadsTheEngineBeforeAnotherSessionStarts() async {
        let synthesizer = MockNeuralSynthesizer()
        let player = MockNeuralPlayer()
        let session = NeuralSpeechSession(synthesizer: synthesizer, player: player)
        session.start(
            chunks: [SpeechQueueChunk(text: "Hello.", offset: 0, pauseSeconds: 0)],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        XCTAssertEqual(synthesizer.unloadCount, 1)
        XCTAssertEqual(synthesizer.texts, ["Hello."])
        session.start(
            chunks: [SpeechQueueChunk(text: "Olá.", offset: 0, pauseSeconds: 0)],
            engine: .portuguesePortugal,
            speed: 1,
            onPhrase: { _ in },
            onProgress: { _, _ in },
            completion: { _ in }
        )
        XCTAssertEqual(synthesizer.unloadCount, 2)
        XCTAssertEqual(synthesizer.texts, ["Hello.", "Olá."])
        session.stop()
        XCTAssertEqual(synthesizer.unloadCount, 3)
    }

    private func settle() async {
        await Task.yield()
        await MainActor.run {}
        await Task.yield()
        await Task.yield()
    }
}

private final class MockNeuralSynthesizer: NeuralSpeechSynthesizing {
    private(set) var texts: [String] = []
    private var pending: [(Result<(samples: [Float], sampleRate: Double), Error>) -> Void] = []
    var sampleCount = 82
    private(set) var constrained = false
    private(set) var unloadCount = 0

    func setConstrained(_ constrained: Bool) {
        self.constrained = constrained
    }

    func unload() {
        unloadCount += 1
    }

    func synthesize(
        text: String,
        engine: SpeechEngineID,
        speed: Float,
        completion: @escaping (Result<(samples: [Float], sampleRate: Double), Error>) -> Void
    ) {
        texts.append(text)
        pending.append(completion)
    }

    func complete() {
        let spoken = [Float(0.2), 0.1] + Array(repeating: Float(0.001), count: max(0, sampleCount - 2))
        pending.removeFirst()(.success((spoken, 1_000)))
    }

    func fail(_ error: Error) {
        pending.removeFirst()(.failure(error))
    }
}

private final class MockNeuralPlayer: NeuralSpeechScheduling {
    private(set) var scheduledCount = 0
    private(set) var scheduledSampleCounts: [Int] = []
    private(set) var pauseCount = 0
    private(set) var resumeCount = 0
    private(set) var keepAliveActive = false
    private(set) var completions: [() -> Void] = []
    var scheduleError: Error?
    var isPlaying: Bool { !completions.isEmpty || keepAliveActive }

    func reset() {
        scheduledCount = 0
        scheduledSampleCounts.removeAll()
        completions.removeAll()
    }

    func pause() { pauseCount += 1 }
    func resume() { resumeCount += 1 }
    func stop() { completions.removeAll() }
    func setKeepAliveActive(_ active: Bool, sampleRate: Double) {
        keepAliveActive = active
    }

    func schedule(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping () -> Void
    ) throws {
        if let scheduleError { throw scheduleError }
        scheduledCount += 1
        scheduledSampleCounts.append(samples.count)
        completions.append(completion)
    }

    func finishNext() {
        completions.removeFirst()()
    }

    func finishAllCurrentlyScheduled() {
        let scheduled = completions
        completions.removeAll()
        scheduled.forEach { $0() }
    }
}
