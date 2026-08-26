import Foundation

struct SpeechQueueChunk: Equatable {
    let text: String
    let offset: Int
    let pauseSeconds: Double
}

struct SpeechPlaybackQueue {
    private(set) var pendingRequestID: String?
    private var chunks: [SpeechQueueChunk] = []

    var hasPendingRequest: Bool { pendingRequestID != nil }
    var isEmpty: Bool { chunks.isEmpty }

    mutating func beginRequest(id: String) {
        chunks.removeAll()
        pendingRequestID = id
    }

    mutating func accept(requestID: String?, chunks: [SpeechQueueChunk]) -> Bool {
        guard let requestID, requestID == pendingRequestID else { return false }
        pendingRequestID = nil
        self.chunks = chunks
        return true
    }

    mutating func next() -> SpeechQueueChunk? {
        guard !chunks.isEmpty else { return nil }
        return chunks.removeFirst()
    }

    mutating func cancel() {
        pendingRequestID = nil
        chunks.removeAll()
    }
}
