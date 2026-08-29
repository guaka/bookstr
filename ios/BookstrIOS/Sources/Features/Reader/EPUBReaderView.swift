import AVFoundation
import MediaPlayer
import SwiftUI
import WebKit

struct EPUBSection: Identifiable, Equatable {
    let index: Int
    let label: String
    let href: String

    var id: String { "\(index):\(href)" }
}

enum NativeSpeechFallback {
    static func chunks(_ text: String, maximumLength: Int = 240) -> [(text: String, offset: Int)] {
        let source = text as NSString
        let fullRange = NSRange(location: 0, length: source.length)
        guard fullRange.length > 0 else { return [] }
        var sentences: [NSRange] = []
        source.enumerateSubstrings(in: fullRange, options: [.bySentences, .substringNotRequired]) { _, range, _, _ in
            sentences.append(range)
        }
        if sentences.isEmpty { sentences = [fullRange] }
        var result: [(text: String, offset: Int)] = []
        var start = sentences[0].location
        var end = start

        func appendRange(_ range: NSRange) {
            var cursor = range.location
            while cursor < NSMaxRange(range) {
                let remaining = NSMaxRange(range) - cursor
                var length = min(maximumLength, remaining)
                if remaining > maximumLength {
                    let window = source.substring(with: NSRange(location: cursor, length: length)) as NSString
                    let softLength = min(180, length)
                    let preferredStart = Int(Double(softLength) * 0.55)
                    func phraseBreak(from startIndex: Int, to endIndex: Int, step: Int) -> Int? {
                        var index = startIndex
                        while (step < 0 && index >= endIndex) || (step > 0 && index < endIndex) {
                            let character = window.character(at: index)
                            if index + 1 < window.length, character == 0x2D, window.character(at: index + 1) == 0x2D {
                                return index + 2
                            }
                            if character == 0x2014 || character == 0x2013 || character == 0x29 {
                                return index + 1
                            }
                            if character == 0x2C || character == 0x3B || character == 0x3A {
                                if character == 0x2C,
                                   index > 0,
                                   (48...57).contains(window.character(at: index - 1)),
                                   index + 3 < window.length,
                                   (1...3).allSatisfy({ (48...57).contains(window.character(at: index + $0)) }) {
                                    index += step
                                    continue
                                }
                                let next = index + 1
                                if next >= window.length || window.character(at: next) == 32 {
                                    return next
                                }
                            }
                            index += step
                        }
                        return nil
                    }
                    if let breakAt = phraseBreak(from: softLength - 1, to: preferredStart, step: -1)
                        ?? phraseBreak(from: softLength, to: window.length, step: 1) {
                        length = breakAt
                    } else {
                        let beforeSoft = window.range(
                            of: " ",
                            options: .backwards,
                            range: NSRange(location: preferredStart, length: max(0, softLength - preferredStart))
                        )
                        if beforeSoft.location != NSNotFound {
                            length = beforeSoft.location
                        } else if softLength < window.length {
                            let afterSoft = window.range(
                                of: " ",
                                range: NSRange(location: softLength, length: window.length - softLength)
                            )
                            if afterSoft.location != NSNotFound { length = afterSoft.location }
                        }
                    }
                }
                let raw = source.substring(with: NSRange(location: cursor, length: length))
                let piece = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if !piece.isEmpty {
                    let leading = (raw as NSString).range(of: piece).location
                    result.append((piece, cursor + max(0, leading)))
                }
                cursor += max(1, length)
                while cursor < NSMaxRange(range), source.character(at: cursor) == 32 { cursor += 1 }
            }
        }

        for sentence in sentences {
            if end > start, NSMaxRange(sentence) - start > maximumLength {
                appendRange(NSRange(location: start, length: end - start))
                start = sentence.location
            }
            end = NSMaxRange(sentence)
            if end - start > maximumLength {
                appendRange(NSRange(location: start, length: end - start))
                start = end
            }
        }
        if end > start { appendRange(NSRange(location: start, length: end - start)) }

        if result.count >= 2,
           result[result.count - 1].text.split(whereSeparator: \.isWhitespace).count == 1 {
            let previousIndex = result.count - 2
            let previous = result[previousIndex]
            let previousText = previous.text as NSString
            let moveAt = previousText.range(of: " ", options: .backwards)
            if moveAt.location != NSNotFound {
                var movedStart = previous.offset + NSMaxRange(moveAt)
                let tailEnd = result[result.count - 1].offset + (result[result.count - 1].text as NSString).length
                while movedStart < tailEnd, source.character(at: movedStart) == 32 { movedStart += 1 }
                let previousRange = NSRange(location: previous.offset, length: moveAt.location)
                let tailRange = NSRange(location: movedStart, length: tailEnd - movedStart)
                let rebalancedPrevious = source.substring(with: previousRange)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                let rebalancedTail = source.substring(with: tailRange)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !rebalancedPrevious.isEmpty, (rebalancedTail as NSString).length <= maximumLength {
                    result[previousIndex] = (rebalancedPrevious, previous.offset)
                    result[result.count - 1] = (rebalancedTail, movedStart)
                }
            }
        }
        return result
    }
}

struct ReaderTextSelection: Equatable {
    let text: String
    let locator: String
    let language: String
    let context: String
}

struct EPUBSearchResult: Identifiable, Equatable {
    let sectionIndex: Int
    let cfi: String
    let excerpt: String
    var id: String { cfi }
}

    @MainActor
final class EPUBReaderController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var sectionIndex = 0
    @Published var sectionCount = 1
    @Published var sections: [EPUBSection] = []
    @Published var hasTableOfContents = false
    @Published var errorMessage: String?
    @Published var ready = false
    @Published var isSpeaking = false
    @Published var loadingStage = "Starting reader"
    @Published var rights = BookRights()
    @Published var textSelection: ReaderTextSelection?
    @Published var searchResults: [EPUBSearchResult] = []
    @Published var searching = false

    fileprivate weak var webView: WKWebView?
    private let speech = AVSpeechSynthesizer()
    private let neuralSpeech = NeuralSpeechPlayback()
    private var utteranceOffsets: [ObjectIdentifier: Int] = [:]
    private var utteranceHighlightLengths: [ObjectIdentifier: Int] = [:]
    private var utteranceMapsSpokenRanges: [ObjectIdentifier: Bool] = [:]
    private var playbackQueue = SpeechPlaybackQueue()
    private var activeUtterance: ObjectIdentifier?
    private var activeSpeechEngine = SpeechEngineID.system
    private var neuralSpeechRate = SpeechLanguageSettings.defaultRate
    private var neuralChunkOffset: Int?
    private var nowPlayingTitle = "Bookstr"
    private var nowPlayingAuthor = ""
    private var nowPlayingParagraph = ""
    private var nowPlayingArtwork: MPMediaItemArtwork?
    private var nowPlayingIsPlaying = false
    private var remoteCommandsConfigured = false

    override init() {
        super.init()
        speech.delegate = self
    }

    func nextPage() { evaluate("window.nextPage && window.nextPage()") }
    func previousPage() { evaluate("window.prevPage && window.prevPage()") }
    func adjustReaderFont(by delta: Int) {
        evaluate("window.adjustReaderFont && window.adjustReaderFont(\(delta));")
    }
    func search(_ query: String) {
        searching = true
        searchResults = []
        evaluate("window.searchBook && window.searchBook(\(Self.js(query))); null;")
    }
    func display(_ result: EPUBSearchResult) {
        evaluate("window.displaySearchResult && window.displaySearchResult(\(Self.js(result.cfi))); null;")
    }

    func configureNowPlaying(book: CatalogBook) {
        nowPlayingTitle = book.title
        nowPlayingAuthor = book.author
        configureRemoteCommands()
        loadNowPlayingArtwork(from: book.coverUrl)
    }

    func endNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        center.playbackState = .stopped
        center.nowPlayingInfo = nil
        UIApplication.shared.endReceivingRemoteControlEvents()
    }

    func display(_ section: EPUBSection) {
        evaluate("window.displaySection && window.displaySection(\(Self.js(section.href)))")
    }

    func apply(theme: ReaderTheme) {
        evaluate("window.setReaderTheme && window.setReaderTheme(\(Self.js(theme.rawValue)))")
    }

    func applyTypography(font: ReaderFont, alignment: ReaderAlignment) {
        evaluate(
            "window.setReaderTypography && window.setReaderTypography(\(Self.js(font.rawValue)), \(Self.js(alignment.rawValue)))"
        )
    }

    func toggleSpeech() {
        if isSpeaking || speech.isSpeaking || speech.isPaused || neuralSpeech.isPlaying || playbackQueue.hasPendingRequest {
            stopSpeech()
        } else {
            guard ready else {
                errorMessage = "The reader is still preparing text for speech."
                return
            }
            requestSpeechText()
        }
    }

    fileprivate func speak(
        text: String,
        playback: SpeechPlaybackChoice,
        chunks: [(text: String, offset: Int, pauseSeconds: Double, speak: String)]? = nil,
        requestID: String? = nil
    ) {
        let preparedChunks = (chunks?.isEmpty == false ? chunks! : speechChunks(text).map {
            (text: $0.text, offset: $0.offset, pauseSeconds: 0.035, speak: SpeechSpokenText.normalize($0.text))
        }).map {
            SpeechQueueChunk(text: $0.text, offset: $0.offset, pauseSeconds: $0.pauseSeconds, speak: $0.speak)
        }
        guard playbackQueue.accept(requestID: requestID, chunks: preparedChunks) else { return }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            stopSpeech()
            errorMessage = "No readable text is visible here."
            return
        }
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(
                .playback,
                mode: .spokenAudio,
                options: []
            )
            try audioSession.setActive(true)
        } catch {
            stopSpeech()
            errorMessage = "Could not start text-to-speech audio: \(error.localizedDescription)"
            return
        }
        speech.stopSpeaking(at: .immediate)
        neuralSpeech.stop()
        neuralChunkOffset = nil
        utteranceOffsets.removeAll()
        utteranceHighlightLengths.removeAll()
        utteranceMapsSpokenRanges.removeAll()
        activeUtterance = nil
        isSpeaking = true
        updateNowPlaying(isPlaying: true)
        switch playback.engine {
        case .neural(let engine):
            guard engine.supports(language: playback.languageTag) else {
                stopSpeech()
                errorMessage = "\(engine.label) does not support this book's language."
                return
            }
            activeSpeechEngine = engine
            neuralSpeechRate = playback.rate
            var neuralChunks: [SpeechQueueChunk] = []
            while let chunk = playbackQueue.next() {
                neuralChunks.append(chunk)
            }
            neuralSpeech.play(
                chunks: neuralChunks,
                engine: engine,
                speed: Float(min(max(playback.rate / SpeechLanguageSettings.defaultRate, 0.73), 1.25)),
                onPhrase: { [weak self] chunk in
                    self?.neuralChunkOffset = chunk.offset
                    self?.updateSpeechProgress(start: chunk.offset, end: chunk.spokenEnd)
                },
                completion: { [weak self] result in
                    guard let self else { return }
                    self.neuralChunkOffset = nil
                    switch result {
                    case .success:
                        self.finishSpeech()
                    case .failure(let error):
                        self.stopSpeech()
                        self.errorMessage = error.localizedDescription
                    }
                }
            )
        case .apple:
            activeSpeechEngine = .system
            let selectedVoice = bestVoice(language: playback.languageTag, identifier: playback.voiceIdentifier)
            speakNextUtterance(voice: selectedVoice, rate: playback.rate, isFirst: true)
        }
        errorMessage = nil
    }

    private func speakNextUtterance(voice: AVSpeechSynthesisVoice?, rate: Double, isFirst: Bool = false) {
        guard activeUtterance == nil, !playbackQueue.isEmpty else {
            if activeUtterance == nil { finishSpeech() }
            return
        }
        guard let chunk = playbackQueue.next() else { return }
        let utterance = AVSpeechUtterance(string: chunk.speak)
        utterance.voice = voice
        utterance.rate = Float(min(max(rate, 0.35), 0.60))
        utterance.volume = 1
        utterance.preUtteranceDelay = isFirst ? 0 : chunk.pauseSeconds
        let identifier = ObjectIdentifier(utterance)
        activeUtterance = identifier
        utteranceOffsets[identifier] = chunk.offset
        utteranceHighlightLengths[identifier] = (chunk.text as NSString).length
        utteranceMapsSpokenRanges[identifier] = chunk.speak == chunk.text
        speech.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard let offset = utteranceOffsets[ObjectIdentifier(utterance)] else { return }
            if utteranceMapsSpokenRanges[ObjectIdentifier(utterance)] == false,
               let length = utteranceHighlightLengths[ObjectIdentifier(utterance)] {
                updateSpeechProgress(start: offset, end: offset + max(1, length))
                return
            }
            updateSpeechProgress(start: offset + characterRange.location, end: offset + NSMaxRange(characterRange))
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            finishUtterance(utterance)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            finishUtterance(utterance)
        }
    }

    private func finishUtterance(_ utterance: AVSpeechUtterance) {
        let identifier = ObjectIdentifier(utterance)
        guard activeUtterance == identifier else { return }
        activeUtterance = nil
        utteranceOffsets.removeValue(forKey: identifier)
        utteranceHighlightLengths.removeValue(forKey: identifier)
        utteranceMapsSpokenRanges.removeValue(forKey: identifier)
        if !playbackQueue.isEmpty {
            speakNextUtterance(voice: utterance.voice, rate: Double(utterance.rate))
            return
        }
        finishSpeech()
    }

    private func finishSpeech() {
        isSpeaking = false
        updateNowPlaying(isPlaying: false)
        deactivateAudioSession()
        evaluate("window.clearSpeechProgress && window.clearSpeechProgress()")
    }

    private func stopSpeech() {
        playbackQueue.cancel()
        activeUtterance = nil
        utteranceOffsets.removeAll()
        utteranceHighlightLengths.removeAll()
        utteranceMapsSpokenRanges.removeAll()
        neuralChunkOffset = nil
        neuralSpeech.stop()
        speech.stopSpeaking(at: .immediate)
        isSpeaking = false
        updateNowPlaying(isPlaying: false)
        deactivateAudioSession()
        evaluate("window.clearSpeechProgress && window.clearSpeechProgress()")
    }

    private func requestSpeechText(after delayMilliseconds: Int = 0) {
        let requestID = UUID().uuidString
        playbackQueue.beginRequest(id: requestID)
        isSpeaking = true
        updateNowPlaying(isPlaying: true)
        let request = "window.requestSpeechText && window.requestSpeechText(true, \(Self.js(requestID)))"
        if delayMilliseconds > 0 {
            evaluate("setTimeout(function(){\(request);}, \(delayMilliseconds))")
        } else {
            evaluate(request)
        }
    }

    private func bestVoice(language: String, identifier: String) -> AVSpeechSynthesisVoice? {
        if !identifier.isEmpty, let selected = AVSpeechSynthesisVoice(identifier: identifier) { return selected }
        return AVSpeechSynthesisVoice(language: language)
            ?? AVSpeechSynthesisVoice(language: SpeechLanguageSettings.baseLanguage(language))
            ?? AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first ?? "en")
    }

    private func speechChunks(_ text: String, maximumLength: Int = 240) -> [(text: String, offset: Int)] {
        NativeSpeechFallback.chunks(text, maximumLength: maximumLength)
    }

    fileprivate func parseSpeechChunks(_ value: Any?) -> [(text: String, offset: Int, pauseSeconds: Double, speak: String)] {
        let chunks = (value as? [[String: Any]]) ?? (value as? [Any] ?? [])
            .compactMap { $0 as? [String: Any] }
        var parsed: [(text: String, offset: Int, pauseSeconds: Double, speak: String)] = []
        for chunk in chunks {
            guard let text = chunk["text"] as? String else { continue }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let pauseMilliseconds = if let value = chunk["pauseMs"] as? NSNumber {
                value.intValue
            } else if let value = chunk["pauseMs"] as? Double {
                Int(value)
            } else {
                0
            }
            let pauseSeconds = Double(max(0, pauseMilliseconds)) / 1000.0
            let offset = (chunk["offset"] as? NSNumber)?.intValue
                ?? (chunk["start"] as? NSNumber)?.intValue
                ?? (chunk["offset"] as? Int)
                ?? (chunk["start"] as? Int)
                ?? 0
            let spoken = (chunk["spoken"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            parsed.append((
                text: trimmed,
                offset: max(0, offset),
                pauseSeconds: pauseSeconds,
                speak: spoken.isEmpty ? SpeechSpokenText.normalize(trimmed) : spoken
            ))
        }
        if !parsed.isEmpty {
            return parsed
        }
        return []
    }

    private func deactivateAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func configureRemoteCommands() {
        guard !remoteCommandsConfigured else { return }
        remoteCommandsConfigured = true
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.isEnabled = true
        commands.pauseCommand.isEnabled = true
        commands.nextTrackCommand.isEnabled = true
        commands.previousTrackCommand.isEnabled = true
        commands.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.speech.isPaused {
                    self.speech.continueSpeaking()
                    self.isSpeaking = true
                    self.updateNowPlaying(isPlaying: true)
                } else if self.activeSpeechEngine != .system, !self.neuralSpeech.isPlaying, self.neuralChunkOffset != nil {
                    self.neuralSpeech.resume()
                    self.isSpeaking = true
                    self.updateNowPlaying(isPlaying: true)
                } else if !self.isSpeaking && !self.playbackQueue.hasPendingRequest {
                    self.requestSpeechText()
                }
            }
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.speech.isSpeaking {
                    self.speech.pauseSpeaking(at: .word)
                    self.isSpeaking = false
                    self.updateNowPlaying(isPlaying: false)
                } else if self.neuralSpeech.isPlaying {
                    self.neuralSpeech.pause()
                    self.isSpeaking = false
                    self.updateNowPlaying(isPlaying: false)
                }
            }
            return .success
        }
        commands.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.skipSpokenPage(direction: 1)
            }
            return .success
        }
        commands.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.skipSpokenPage(direction: -1)
            }
            return .success
        }
    }

    private func skipSpokenPage(direction: Int) {
        playbackQueue.cancel()
        activeUtterance = nil
        utteranceOffsets.removeAll()
        utteranceHighlightLengths.removeAll()
        utteranceMapsSpokenRanges.removeAll()
        neuralChunkOffset = nil
        neuralSpeech.stop()
        speech.stopSpeaking(at: .immediate)
        nowPlayingParagraph = ""
        let move = direction > 0
            ? "window.nextPage && window.nextPage()"
            : "window.prevPage && window.prevPage()"
        evaluate(move)
        requestSpeechText(after: 340)
    }

    private func updateNowPlaying(isPlaying: Bool) {
        UIApplication.shared.beginReceivingRemoteControlEvents()
        nowPlayingIsPlaying = isPlaying
        let center = MPNowPlayingInfoCenter.default()
        center.playbackState = isPlaying ? .playing : .paused
        let paragraphLines = splitNowPlayingParagraph(nowPlayingParagraph)
        let bookByline = nowPlayingAuthor.isEmpty
            ? nowPlayingTitle
            : "\(nowPlayingTitle) — \(nowPlayingAuthor)"
        var information: [String: Any] = [
            MPMediaItemPropertyTitle: paragraphLines?.first ?? nowPlayingTitle,
            MPMediaItemPropertyArtist: paragraphLines?.continuation ?? nowPlayingAuthor,
            MPMediaItemPropertyAlbumTitle: paragraphLines == nil ? "Bookstr" : bookByline,
            MPMediaItemPropertyMediaType: MPMediaType.audioBook.rawValue,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]
        if let nowPlayingArtwork {
            information[MPMediaItemPropertyArtwork] = nowPlayingArtwork
        }
        center.nowPlayingInfo = information
    }

    private func splitNowPlayingParagraph(_ paragraph: String) -> (first: String, continuation: String)? {
        let compact = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !compact.isEmpty else { return nil }
        let preferredBreak = min(compact.count, 110)
        let boundary = compact.index(compact.startIndex, offsetBy: preferredBreak)
        let prefix = compact[..<boundary]
        let split = prefix.lastIndex(of: " ") ?? boundary
        let first = String(compact[..<split]).trimmingCharacters(in: .whitespaces)
        let remainderStart = split < compact.endIndex ? compact.index(after: split) : split
        let continuation = String(compact[remainderStart...].prefix(220))
            .trimmingCharacters(in: .whitespaces)
        return (first, continuation.isEmpty ? bookBylineFallback : continuation)
    }

    private var bookBylineFallback: String {
        nowPlayingAuthor.isEmpty ? nowPlayingTitle : "\(nowPlayingTitle) — \(nowPlayingAuthor)"
    }

    private func updateSpeechProgress(start: Int, end: Int) {
        let script = "window.showSpeechProgress && window.showSpeechProgress(\(start), \(end))"
        webView?.evaluateJavaScript(script) { [weak self] value, _ in
            guard let paragraph = value as? String else { return }
            Task { @MainActor in
                guard let self else { return }
                let compact = paragraph.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !compact.isEmpty, compact != self.nowPlayingParagraph else { return }
                self.nowPlayingParagraph = String(compact.prefix(600))
                self.updateNowPlaying(isPlaying: self.nowPlayingIsPlaying)
            }
        }
    }

    private func loadNowPlayingArtwork(from urlString: String?) {
        guard let urlString, let url = URL(string: urlString) else { return }
        Task { [weak self] in
            guard let (data, response) = try? await URLSession.shared.data(from: url),
                  let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode),
                  let image = UIImage(data: data), image.size.width > 0, image.size.height > 0
            else { return }
            guard let self else { return }
            self.nowPlayingArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            if MPNowPlayingInfoCenter.default().nowPlayingInfo != nil {
                self.updateNowPlaying(isPlaying: self.nowPlayingIsPlaying)
            }
        }
    }

    fileprivate func evaluate(_ script: String) {
        webView?.evaluateJavaScript(script)
    }

    fileprivate static func js(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let encoded = String(data: data, encoding: .utf8)
        else { return "\"\"" }
        return String(encoded.dropFirst().dropLast())
    }
}

final class BookstrReaderWebView: WKWebView {
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        false
    }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        builder.remove(menu: .standardEdit)
        builder.remove(menu: .lookup)
        builder.remove(menu: .share)
        builder.remove(menu: .replace)
    }
}

struct EPUBReaderView: UIViewRepresentable {
    @EnvironmentObject private var container: AppContainer
    let book: CatalogBook
    let fileURL: URL
    @ObservedObject var controller: EPUBReaderController
    let initialCFI: String?
    let highlightCFI: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(container: container, book: book, fileURL: fileURL, controller: controller,
                    initialCFI: initialCFI, highlightCFI: highlightCFI)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.setURLSchemeHandler(context.coordinator, forURLScheme: "bookstr-reader")
        configuration.userContentController.add(context.coordinator, name: "bookstrReader")
        configuration.userContentController.addUserScript(
            WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        // The bundled custom-scheme page can finish before SwiftUI's first layout.
        // EPUB.js cannot complete rendition.display() against a 0x0 viewport.
        let webView = BookstrReaderWebView(frame: UIScreen.main.bounds, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.verticalScrollIndicatorInsets = .zero
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.backgroundColor = container.settingsRepository.theme.uiBackground
        webView.isOpaque = false
        webView.accessibilityIdentifier = "epub-reader-webview"
        webView.accessibilityLabel = "EPUB reader"
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        let gesture = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePagePan(_:)))
        gesture.cancelsTouchesInView = false
        gesture.delegate = context.coordinator
        webView.addGestureRecognizer(gesture)
        let pinchGesture = UIPinchGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleFontPinch(_:))
        )
        pinchGesture.cancelsTouchesInView = false
        pinchGesture.delegate = context.coordinator
        webView.addGestureRecognizer(pinchGesture)
        controller.webView = webView
        controller.rights = book.rights
        controller.configureNowPlaying(book: book)

        guard let readerURL = URL(string: "bookstr-reader://app/reader.html") else {
            controller.errorMessage = "The EPUB reader could not be initialized."
            return webView
        }
        webView.load(URLRequest(url: readerURL, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        controller.webView = webView
        controller.apply(theme: container.settingsRepository.theme)
    }

    static let bridgeScript = """
    (() => {
      window.bookstrNativeSwipeNavigation = true;
      const send = (method, value) => window.webkit.messageHandlers.bookstrReader.postMessage({ method, value });
      window.AndroidBridge = {
        onReaderReady: () => send('onReaderReady', null),
        onMetadata: value => send('onMetadata', value),
        onSections: value => send('onSections', value),
        onRelocated: value => send('onRelocated', value),
        onReaderError: value => send('onReaderError', value),
        onWordSelected: value => send('onWordSelected', value),
        onTextSelected: value => send('onTextSelected', value),
        onSearchResults: value => send('onSearchResults', value),
        onDictionaryResult: value => send('onDictionaryResult', value),
        onLookupDictionary: value => send('onLookupDictionary', value),
        onKnownWordTapped: value => send('onKnownWordTapped', value),
        onReaderInteracted: () => send('onReaderInteracted', null),
        onSpeechText: value => send('onSpeechText', value)
        ,onReaderStage: value => send('onReaderStage', value)
      };
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKURLSchemeHandler, UIGestureRecognizerDelegate {
        private let container: AppContainer
        private let book: CatalogBook
        private let fileURL: URL
        private let controller: EPUBReaderController
        private let initialCFI: String?
        private let highlightCFI: String?

        init(container: AppContainer, book: CatalogBook, fileURL: URL, controller: EPUBReaderController,
             initialCFI: String?, highlightCFI: String?) {
            self.container = container
            self.book = book
            self.fileURL = fileURL
            self.controller = controller
            self.initialCFI = initialCFI
            self.highlightCFI = highlightCFI
        }

        @objc func handlePagePan(_ gesture: UIPanGestureRecognizer) {
            guard let view = gesture.view else { return }
            let offset = gesture.translation(in: view).x
            switch gesture.state {
            case .began:
                controller.evaluate("window.beginNativePageSwipe && window.beginNativePageSwipe()")
            case .changed:
                controller.evaluate("window.updateNativePageSwipe && window.updateNativePageSwipe(\(offset))")
            case .ended:
                let velocity = gesture.velocity(in: view).x
                let commits = abs(offset) > view.bounds.width * 0.22 || abs(velocity) > 520
                let direction = commits ? (offset < 0 ? 1 : -1) : 0
                controller.evaluate("window.endNativePageSwipe && window.endNativePageSwipe(\(direction))")
            case .cancelled, .failed:
                controller.evaluate("window.endNativePageSwipe && window.endNativePageSwipe(0)")
            default:
                break
            }
        }

        @objc func handleFontPinch(_ gesture: UIPinchGestureRecognizer) {
            switch gesture.state {
            case .began:
                controller.evaluate("window.beginNativeFontPinch && window.beginNativeFontPinch()")
            case .changed:
                controller.evaluate("window.updateNativeFontPinch && window.updateNativeFontPinch(\(gesture.scale))")
            case .ended, .cancelled, .failed:
                controller.evaluate("window.endNativeFontPinch && window.endNativeFontPinch()")
            default:
                break
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer,
                  let view = pan.view else { return true }
            let velocity = pan.velocity(in: view)
            return abs(velocity.x) > abs(velocity.y) * 1.2
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            let progress = container.progressRepository.get(bookId: book.id)
            let requestedCFI = initialCFI?.isEmpty == false ? initialCFI! : progress.cfi
            let cfi = requestedCFI.isEmpty ? "null" : EPUBReaderController.js(requestedCFI)
            let highlight = highlightCFI?.isEmpty == false ? EPUBReaderController.js(highlightCFI!) : "null"
            let theme = EPUBReaderController.js(container.settingsRepository.theme.rawValue)
            let font = EPUBReaderController.js(container.settingsRepository.readerFont.rawValue)
            let alignment = EPUBReaderController.js(container.settingsRepository.readerAlignment.rawValue)
            let bookID = EPUBReaderController.js(book.id)
            guard let publicationData = try? Data(contentsOf: fileURL, options: .mappedIfSafe),
                  !publicationData.isEmpty else {
                controller.errorMessage = "Could not read the downloaded EPUB."
                return
            }
            let publication = EPUBReaderController.js(publicationData.base64EncodedString())
            let knownWords = container.vocabularyRepository.all().map(\.word)
            let knownData = (try? JSONSerialization.data(withJSONObject: knownWords)) ?? Data("[]".utf8)
            let knownJSON = String(data: knownData, encoding: .utf8) ?? "[]"
            let knownArgument = EPUBReaderController.js(knownJSON)
            let loadScript = "setReaderTheme(\(theme)); setReaderTypography(\(font), \(alignment)); setKnownWords(\(knownArgument)); " +
                "loadBook(\(publication), \(cfi), \(theme), \(highlight), \(bookID)); null;"
            webView.evaluateJavaScript(
                "[typeof window.loadBook, typeof window.ePub, typeof window.JSZip, " +
                    "typeof window.BookstrSpeech?.buildPlan].join('|')"
            ) {
                [weak controller, weak webView] value, error in
                if let error {
                    controller?.errorMessage = "Could not initialize the EPUB reader: \(error.localizedDescription)"
                    return
                }
                guard value as? String == "function|function|function|function" else {
                    controller?.errorMessage = "The EPUB reader resources did not load (\(value as? String ?? "unknown"))."
                    return
                }
                webView?.evaluateJavaScript(loadScript) { [weak controller] _, error in
                    guard let error else { return }
                    controller?.errorMessage = "Could not start the EPUB reader: \(error.localizedDescription)"
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            controller.errorMessage = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            controller.errorMessage = error.localizedDescription
        }

        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            let url = urlSchemeTask.request.url
            do {
                let data: Data
                let mimeType: String
                switch url?.path {
                case "/reader.html":
                    data = try bundled("reader", extension: "html")
                    mimeType = "text/html"
                case "/epub.min.js":
                    data = try bundled("epub.min", extension: "js")
                    mimeType = "text/javascript"
                case "/jszip.min.js":
                    data = try bundled("jszip.min", extension: "js")
                    mimeType = "text/javascript"
                case "/reader-speech.js":
                    data = try bundled("reader-speech", extension: "js")
                    mimeType = "text/javascript"
                case "/reader-typography.js":
                    data = try bundled("reader-typography", extension: "js")
                    mimeType = "text/javascript"
                case "/books/current.epub":
                    data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
                    mimeType = "application/epub+zip"
                default:
                    throw URLError(.fileDoesNotExist)
                }
                guard let responseURL = url,
                      let response = HTTPURLResponse(
                        url: responseURL,
                        statusCode: 200,
                        httpVersion: "HTTP/1.1",
                        headerFields: [
                            "Content-Type": mimeType + (mimeType.hasPrefix("text/") ? "; charset=utf-8" : ""),
                            "Content-Length": String(data.count),
                            "Cache-Control": "no-store"
                        ]
                      )
                else { throw URLError(.badServerResponse) }
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                urlSchemeTask.didFailWithError(error)
            }
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

        private func bundled(_ name: String, extension fileExtension: String) throws -> Data {
            guard let url = Bundle.main.url(forResource: name, withExtension: fileExtension) else {
                throw NSError(
                    domain: "BookstrEPUBReader",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Missing reader resource \(name).\(fileExtension)"]
                )
            }
            return try Data(contentsOf: url, options: .mappedIfSafe)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "bookstrReader",
                  let body = message.body as? [String: Any],
                  let method = body["method"] as? String
            else { return }
            let value = body["value"]
            switch method {
            case "onReaderReady":
                controller.ready = true
                controller.errorMessage = nil
            case "onReaderStage":
                controller.loadingStage = value as? String ?? "Preparing EPUB"
            case "onReaderError":
                let detail = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                controller.errorMessage = detail?.isEmpty == false
                    ? "Could not open this book: \(detail!)"
                    : "Could not open this EPUB. The file may be damaged or unsupported."
            case "onMetadata": handleMetadata(value as? String)
            case "onRelocated": handleRelocation(value as? String)
            case "onSections": handleSections(value as? String)
            case "onWordSelected": handleWordSelection(value as? String)
            case "onTextSelected": handleTextSelection(value as? String)
            case "onSearchResults": handleSearchResults(value as? String)
            case "onKnownWordTapped": requestKnownWord(value as? String)
            case "onLookupDictionary": lookupDictionary(value as? String)
            case "onDictionaryResult": saveDictionaryResult(value as? String)
            case "onSpeechText": handleSpeech(value as? String)
            default: break
            }
        }

        private func object(from json: String?) -> [String: Any]? {
            guard let json, let data = json.data(using: .utf8) else { return nil }
            return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }

        private func handleRelocation(_ json: String?) {
            guard let item = object(from: json),
                  let progression = item["progression"] as? Double,
                  let cfi = item["cfi"] as? String
            else { return }
            controller.progression = min(max(progression, 0), 1)
            controller.furthestProgression = max(controller.furthestProgression, controller.progression)
            controller.sectionIndex = item["sectionIndex"] as? Int ?? 0
            controller.sectionCount = max(item["sectionCount"] as? Int ?? 1, 1)
            container.progressRepository.save(bookId: book.id, progression: progression, cfi: cfi)
            container.settingsRepository.saveReaderSession(
                ReaderSession(bookId: book.id, bookTitle: book.title, format: .epub, author: book.author,
                              year: book.year, locator: cfi, pageIndex: 0, pageOffset: 0,
                              rightsStatus: controller.rights.status.rawValue,
                              license: controller.rights.license, licenseUrl: controller.rights.licenseURL,
                              rightsSource: controller.rights.source)
            )
            var progressBook = book
            progressBook.rightsStatus = controller.rights.status.rawValue
            progressBook.license = controller.rights.license
            progressBook.licenseUrl = controller.rights.licenseURL
            progressBook.rightsSource = controller.rights.source
            Task { await container.nostrSyncService.pushProgress(book: progressBook, progression: progression, cfi: cfi) }
        }

        private func handleMetadata(_ json: String?) {
            guard let item = object(from: json) else { return }
            let statement = (item["rights"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard statement?.isEmpty == false else { return }
            controller.rights = container.catalogRepository.rememberEmbeddedRights(book: book, statement: statement)
        }

        private func handleSections(_ json: String?) {
            guard let json, let data = json.data(using: .utf8),
                  let values = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
            controller.hasTableOfContents = values.contains { $0["hasToc"] as? Bool == true }
            controller.sections = values.compactMap { item in
                guard let href = item["href"] as? String, !href.isEmpty else { return nil }
                let index = item["index"] as? Int ?? 0
                return EPUBSection(index: index,
                                   label: (item["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Section \(index + 1)",
                                   href: href)
            }
        }

        private func handleWordSelection(_ json: String?) {
            guard let item = object(from: json), let word = item["word"] as? String, !word.isEmpty else { return }
            _ = container.vocabularyRepository.saveSelection(
                word: word, language: item["language"] as? String ?? "en", bookId: book.id,
                bookTitle: book.title, cfi: item["cfi"] as? String ?? "",
                context: item["contextSentence"] as? String ?? ""
            )
            NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
        }

        private func handleTextSelection(_ json: String?) {
            guard let item = object(from: json),
                  let text = item["text"] as? String,
                  !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return }
            controller.textSelection = ReaderTextSelection(
                text: String(text.prefix(2_000)),
                locator: item["cfi"] as? String ?? "",
                language: item["language"] as? String ?? "en",
                context: item["contextSentence"] as? String ?? ""
            )
        }

        private func handleSearchResults(_ json: String?) {
            defer { controller.searching = false }
            guard let json, let data = json.data(using: .utf8),
                  let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else {
                controller.searchResults = []
                return
            }
            controller.searchResults = rows.compactMap { row in
                guard let cfi = row["cfi"] as? String, !cfi.isEmpty else { return nil }
                return EPUBSearchResult(
                    sectionIndex: row["sectionIndex"] as? Int ?? 0,
                    cfi: cfi,
                    excerpt: row["excerpt"] as? String ?? ""
                )
            }
        }

        private func requestKnownWord(_ json: String?) {
            container.wordNavigation.request(word: json ?? "")
        }

        private func lookupDictionary(_ json: String?) {
            guard let item = object(from: json), let word = item["word"] as? String, !word.isEmpty else { return }
            let language = item["language"] as? String ?? "en"
            Task { @MainActor in
                do {
                    let result = try await container.dictionaryRepository.lookup(word: word, language: language, context: "")
                    _ = container.vocabularyRepository.saveDefinition(
                        key: "\(language.lowercased()):\(word.lowercased())", partOfSpeech: result.partOfSpeech,
                        definitions: result.definitions, translation: result.translation, sourceUrl: result.sourceUrl
                    )
                    var payload: [String: Any] = ["word": word, "language": language,
                        "partOfSpeech": result.partOfSpeech, "definitions": result.definitions, "sourceUrl": result.sourceUrl]
                    if let translation = result.translation { payload["translation"] = translation }
                    sendDictionary(payload)
                    NotificationCenter.default.post(name: .bookstrVocabularyDidChange, object: nil)
                } catch {
                    sendDictionary(["word": word, "language": language, "error": error.localizedDescription])
                }
            }
        }

        private func saveDictionaryResult(_ json: String?) {
            guard let item = object(from: json), let word = item["word"] as? String else { return }
            let language = item["language"] as? String ?? "en"
            _ = container.vocabularyRepository.saveDefinition(
                key: "\(language.lowercased()):\(word.lowercased())",
                partOfSpeech: item["partOfSpeech"] as? String ?? "",
                definitions: item["definitions"] as? [String] ?? [], translation: item["translation"] as? String,
                sourceUrl: item["sourceUrl"] as? String ?? ""
            )
        }

        private func sendDictionary(_ payload: [String: Any]) {
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let json = String(data: data, encoding: .utf8)
            else { return }
            controller.evaluate("window.receiveDictionaryResult && window.receiveDictionaryResult(\(EPUBReaderController.js(json)))")
        }

        private func handleSpeech(_ json: String?) {
            guard let item = object(from: json), let text = item["text"] as? String else { return }
            let chunks = controller.parseSpeechChunks(item["chunks"])
            controller.speak(
                text: text,
                playback: container.settingsRepository.speechChoice(for: item["language"] as? String ?? "en"),
                chunks: chunks.isEmpty ? nil : chunks,
                requestID: item["requestID"] as? String
            )
        }
    }
}
