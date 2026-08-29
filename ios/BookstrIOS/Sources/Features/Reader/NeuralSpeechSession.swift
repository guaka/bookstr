import Foundation

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
    func schedule(
        samples: [Float],
        sampleRate: Double,
        completion: @escaping () -> Void
    ) throws
}

@MainActor
final class NeuralSpeechSession {
    private let synthesizer: NeuralSpeechSynthesizing
    private let player: NeuralSpeechScheduling
    private var chunks: [SpeechQueueChunk] = []
    private var engine = SpeechEngineID.system
    private var speed: Float = 1
    private var generation = 0
    private var nextRender = 0
    private var nextSchedule = 0
    private var queuedOnPlayer = 0
    private var synthesizing = false
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
        synthesizing = false
        ready = [:]
        player.reset()
        prefetch()
    }

    func pause() { player.pause() }
    func resume() { player.resume() }

    func stop() {
        generation += 1
        synthesizing = false
        queuedOnPlayer = 0
        ready.removeAll()
        chunks.removeAll()
        onPhrase = nil
        onComplete = nil
        player.stop()
    }

    private func prefetch() {
        guard !synthesizing, nextRender < chunks.count else { return }
        synthesizing = true
        let index = nextRender
        let active = generation
        let chunk = chunks[index]
        synthesizer.synthesize(text: chunk.text, engine: engine, speed: speed) { [weak self] result in
            Task { @MainActor in
                guard let self, self.generation == active else { return }
                self.synthesizing = false
                switch result {
                case .failure(let error):
                    self.fail(error)
                case .success(let audio):
                    self.ready[index] = audio
                    self.nextRender = index + 1
                    self.scheduleReady()
                    self.prefetch()
                }
            }
        }
    }

    private func scheduleReady() {
        while nextSchedule < chunks.count, let audio = ready[nextSchedule] {
            let index = nextSchedule
            nextSchedule += 1
            ready[index] = nil
            let startsNow = queuedOnPlayer == 0
            queuedOnPlayer += 1
            if startsNow {
                onPhrase?(chunks[index])
            }
            let active = generation
            do {
                try player.schedule(samples: audio.samples, sampleRate: audio.sampleRate) { [weak self] in
                    Task { @MainActor in
                        guard let self, self.generation == active else { return }
                        self.queuedOnPlayer -= 1
                        if index + 1 < self.chunks.count, self.queuedOnPlayer > 0 {
                            self.onPhrase?(self.chunks[index + 1])
                        }
                        if index == self.chunks.count - 1 {
                            self.finish()
                            return
                        }
                        self.scheduleReady()
                    }
                }
            } catch {
                fail(error)
                return
            }
        }
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
