import XCTest
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
@testable import BookstrIOS
#endif

@MainActor
final class NeuralSpeechSessionTests: XCTestCase {
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
        let first = SpeechQueueChunk(text: "One.", offset: 0, pauseSeconds: 0.4)
        let second = SpeechQueueChunk(text: "Two!", offset: 5, pauseSeconds: 0.4)
        var phrases: [SpeechQueueChunk] = []
        var finished = false

        session.start(
            chunks: [first, second],
            engine: .kokoroEnglish,
            speed: 1,
            onPhrase: { phrases.append($0) },
            completion: { result in
                if case .success = result { finished = true }
            }
        )
        XCTAssertEqual(synthesizer.texts, ["One."])
        XCTAssertTrue(phrases.isEmpty)

        synthesizer.complete()
        await settle()
        XCTAssertEqual(phrases, [first])
        XCTAssertEqual(phrases[0].spokenEnd, 4)
        XCTAssertEqual(player.scheduledCount, 1)
        XCTAssertEqual(synthesizer.texts, ["One.", "Two!"], "the next phrase must start synthesizing before the current audio finishes")

        synthesizer.complete()
        await settle()
        XCTAssertEqual(player.scheduledCount, 2)
        XCTAssertEqual(phrases, [first], "the highlight stays on the playing phrase until its audio ends")

        player.finishNext()
        await settle()
        XCTAssertEqual(phrases, [first, second])
        XCTAssertEqual(phrases[1].offset, 5)
        XCTAssertEqual(phrases[1].spokenEnd, 9)

        player.finishNext()
        await settle()
        XCTAssertTrue(finished)
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
            completion: { result in
                if case .failure = result { failed = true }
            }
        )
        synthesizer.fail(NSError(domain: "test", code: 1))
        await settle()
        XCTAssertTrue(failed)
        XCTAssertEqual(player.scheduledCount, 0)
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
            completion: { _ in completed = true }
        )
        session.stop()
        synthesizer.complete()
        await settle()
        XCTAssertFalse(completed)
        XCTAssertEqual(player.scheduledCount, 0)
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
            completion: { result in
                if case .failure = result { failed = true }
            }
        )
        synthesizer.complete()
        await settle()
        XCTAssertTrue(failed)
    }

    private func settle() async {
        await Task.yield()
        await MainActor.run {}
        await Task.yield()
    }
}

private final class MockNeuralSynthesizer: NeuralSpeechSynthesizing {
    private(set) var texts: [String] = []
    private var pending: [(Result<(samples: [Float], sampleRate: Double), Error>) -> Void] = []

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
        pending.removeFirst()(.success(([0.2, 0.1], 24_000)))
    }

    func fail(_ error: Error) {
        pending.removeFirst()(.failure(error))
    }
}

private final class MockNeuralPlayer: NeuralSpeechScheduling {
    private(set) var scheduledCount = 0
    private(set) var pauseCount = 0
    private(set) var resumeCount = 0
    private var completions: [() -> Void] = []
    var scheduleError: Error?
    var isPlaying: Bool { !completions.isEmpty }

    func reset() {
        scheduledCount = 0
        completions.removeAll()
    }

    func pause() { pauseCount += 1 }
    func resume() { resumeCount += 1 }
    func stop() { completions.removeAll() }

    func schedule(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping () -> Void
    ) throws {
        if let scheduleError { throw scheduleError }
        scheduledCount += 1
        completions.append(completion)
    }

    func finishNext() {
        completions.removeFirst()()
    }
}
