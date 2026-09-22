import Foundation

struct SpeechQueueChunk: Equatable {
    let text: String
    let speak: String
    let offset: Int
    let pauseSeconds: Double

    init(text: String, offset: Int, pauseSeconds: Double, speak: String? = nil) {
        self.text = text
        let spoken = speak?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.speak = spoken.isEmpty ? SpeechSpokenText.normalize(text) : spoken
        self.offset = offset
        self.pauseSeconds = pauseSeconds
    }

    var spokenEnd: Int {
        let end = offset + (text as NSString).length
        return max(end, offset + 1)
    }
}

enum SpeechSpokenText {
    static func normalize(_ text: String) -> String {
        let output = NSMutableString(string: text)
        replace(pattern: #"\d{1,3}(?:,\d{3})+(?:\.\d+)?"#, in: output) { match in
            match.replacingOccurrences(of: ",", with: "")
        }
        replace(pattern: #"\d{1,3}(?:[\u00A0\u202F ]\d{3})+(?:[.,]\d+)?"#, in: output) { match in
            match
                .replacingOccurrences(of: "\u{00A0}", with: "")
                .replacingOccurrences(of: "\u{202F}", with: "")
                .replacingOccurrences(of: " ", with: "")
        }
        replace(pattern: #"\[\d{1,3}\]"#, in: output) { _ in "" }
        replace(pattern: #"[\u00B9\u00B2\u00B3\u2070\u2074-\u2079]+"#, in: output) { _ in "" }
        replace(pattern: #"(?<=\S)\(\d{1,3}\)"#, in: output) { _ in "" }
        replace(pattern: #"["“”«»„]"#, in: output) { _ in "" }
        // Straight and curly apostrophes are quotes at word boundaries, but
        // must remain inside contractions and names (don't, O’Connor).
        replace(pattern: #"(?<![\p{L}\p{N}])['‘’]|['‘’](?![\p{L}\p{N}])"#, in: output) { _ in "" }
        var spoken = output as String
        while spoken.contains("  ") {
            spoken = spoken.replacingOccurrences(of: "  ", with: " ")
        }
        spoken = spoken.replacingOccurrences(of: " ,", with: ",")
        spoken = spoken.replacingOccurrences(of: " .", with: ".")
        return spoken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func replace(
        pattern: String,
        in output: NSMutableString,
        transform: (String) -> String
    ) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        let matches = regex.matches(
            in: output as String,
            range: NSRange(location: 0, length: output.length)
        )
        for match in matches.reversed() {
            output.replaceCharacters(in: match.range, with: transform(output.substring(with: match.range)))
        }
    }
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
