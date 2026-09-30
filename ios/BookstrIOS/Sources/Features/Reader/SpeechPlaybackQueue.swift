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
    static func normalize(_ text: String) -> String { normalize(text, languageTag: nil) }

    static func normalize(_ text: String, languageTag: String?) -> String {
        let output = NSMutableString(string: text)
        let requestedLocale = languageTag.map(Locale.init(identifier:))
        if requestedLocale == nil || requestedLocale?.language.languageCode?.identifier == "en" {
            replace(pattern: #"\d{1,3}(?:,\d{3})+(?:\.\d+)?"#, in: output) { match in
                match.replacingOccurrences(of: ",", with: "")
            }
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
        let cleaned = spoken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let languageTag, !cleaned.isEmpty else { return cleaned }
        let locale = requestedLocale ?? Locale(identifier: languageTag)
        let prepared = locale.language.languageCode?.identifier == "en" ? expandEnglishAbbreviations(cleaned) : cleaned
        let numberFormatter = NumberFormatter()
        numberFormatter.locale = locale
        numberFormatter.numberStyle = .spellOut
        // Foundation's sentence enumeration is backed by the system ICU data.
        // Enumerating by sentence keeps number conversion scoped to natural
        // utterances while preserving the original punctuation and spacing.
        var result = ""
        prepared.enumerateSubstrings(in: prepared.startIndex..<prepared.endIndex, options: [.bySentences, .substringNotRequired]) { _, range, _, _ in
            let sentence = String(prepared[range])
            result += spellNumbers(sentence, formatter: numberFormatter)
        }
        return result.isEmpty ? prepared : result
    }

    private static func expandEnglishAbbreviations(_ text: String) -> String {
        let replacements: [(String, String)] = [
            (#"(?i)\bMrs\."#, "missus"),
            (#"(?i)\bMr\."#, "mister"),
            (#"(?i)\bDr\."#, "doctor"),
            (#"(?i)\be\.g\."#, "for example"),
            (#"(?i)\bU\.S\."#, "United States"),
        ]
        return replacements.reduce(text) { value, item in
            value.replacingOccurrences(of: item.0, with: item.1, options: .regularExpression)
        }
    }

    private static let numberPattern = #"(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?(?![\p{L}\p{N}])"#
    private static let europeanGroupedPattern = #"(?<![\p{L}\p{N}])\d{1,3}(?:\.\d{3})+(?:,\d+)?(?![\p{L}\p{N}])"#

    private static func spellNumbers(_ text: String, formatter: NumberFormatter) -> String {
        guard let regex = try? NSRegularExpression(pattern: numberPattern),
              let europeanRegex = try? NSRegularExpression(pattern: europeanGroupedPattern) else { return text }
        let locale = formatter.locale?.language.languageCode?.identifier ?? ""
        let european = NSMutableString(string: text)
        if locale == "nl" || locale == "pt" {
            let source = text as NSString
            for match in europeanRegex.matches(in: text, range: NSRange(location: 0, length: source.length)).reversed() {
                let raw = source.substring(with: match.range)
                let normalized = raw.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
                let replacement = Double(normalized).flatMap { formatter.string(from: NSNumber(value: $0)) } ?? raw
                european.replaceCharacters(in: match.range, with: replacement)
            }
        }
        let sourceText = european as String
        let nsText = sourceText as NSString
        let matches = regex.matches(in: sourceText, range: NSRange(location: 0, length: nsText.length))
        let result = NSMutableString(string: sourceText)
        for match in matches.reversed() {
            let raw = nsText.substring(with: match.range)
            let value = Double(raw.replacingOccurrences(of: ",", with: "."))
            let replacement = value.flatMap { formatter.string(from: NSNumber(value: $0)) } ?? raw
            result.replaceCharacters(in: match.range, with: replacement)
        }
        return result as String
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
