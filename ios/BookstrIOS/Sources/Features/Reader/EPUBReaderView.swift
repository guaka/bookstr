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

    @MainActor
final class EPUBReaderController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var sectionIndex = 0
    @Published var sectionCount = 1
    @Published var sections: [EPUBSection] = []
    @Published var errorMessage: String?
    @Published var ready = false
    @Published var isSpeaking = false
    @Published var loadingStage = "Starting reader"

    fileprivate weak var webView: WKWebView?
    private let speech = AVSpeechSynthesizer()
    private var utteranceOffsets: [ObjectIdentifier: Int] = [:]
    private var playbackQueue = SpeechPlaybackQueue()
    private var activeUtterance: ObjectIdentifier?
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

    func toggleSpeech() {
        if isSpeaking || speech.isSpeaking || speech.isPaused || playbackQueue.hasPendingRequest {
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
        language: String,
        voiceIdentifier: String,
        rate: Double,
        chunks: [(text: String, offset: Int, pauseSeconds: Double)]? = nil,
        requestID: String? = nil
    ) {
        let preparedChunks = (chunks?.isEmpty == false ? chunks! : speechChunks(text).map {
            (text: $0.text, offset: $0.offset, pauseSeconds: 0.035)
        }).map {
            SpeechQueueChunk(text: $0.text, offset: $0.offset, pauseSeconds: $0.pauseSeconds)
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
        utteranceOffsets.removeAll()
        activeUtterance = nil
        isSpeaking = true
        updateNowPlaying(isPlaying: true)
        let selectedVoice = bestVoice(language: language, identifier: voiceIdentifier)
        speakNextUtterance(voice: selectedVoice, rate: rate, isFirst: true)
        errorMessage = nil
    }

    private func speakNextUtterance(voice: AVSpeechSynthesisVoice?, rate: Double, isFirst: Bool = false) {
        guard activeUtterance == nil, !playbackQueue.isEmpty else {
            if activeUtterance == nil { finishSpeech() }
            return
        }
        guard let chunk = playbackQueue.next() else { return }
        let utterance = AVSpeechUtterance(string: chunk.text)
        utterance.voice = voice
        utterance.rate = Float(min(max(rate, 0.35), 0.60))
        utterance.volume = 1
        utterance.preUtteranceDelay = isFirst ? 0 : chunk.pauseSeconds
        let identifier = ObjectIdentifier(utterance)
        activeUtterance = identifier
        utteranceOffsets[identifier] = chunk.offset
        speech.speak(utterance)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard let offset = utteranceOffsets[ObjectIdentifier(utterance)] else { return }
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
        let requested = language.replacingOccurrences(of: "_", with: "-").lowercased()
        let base = requested.split(separator: "-").first.map(String.init) ?? "en"
        let matches = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.language.lowercased() == requested || $0.language.lowercased().hasPrefix(base + "-")
        }
        return matches.max { left, right in left.quality.rawValue < right.quality.rawValue }
            ?? AVSpeechSynthesisVoice(language: language)
            ?? AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first ?? "en")
    }

    private func speechChunks(_ text: String, maximumLength: Int = 700) -> [(text: String, offset: Int)] {
        let source = text as NSString
        let fullRange = NSRange(location: 0, length: source.length)
        var sentences: [NSRange] = []
        source.enumerateSubstrings(in: fullRange, options: [.bySentences, .substringNotRequired]) { _, range, _, _ in
            sentences.append(range)
        }
        if sentences.isEmpty { sentences = [fullRange] }
        var result: [(String, Int)] = []
        var start = sentences[0].location
        var end = start
        func appendRange(_ range: NSRange) {
            var cursor = range.location
            while cursor < NSMaxRange(range) {
                let length = min(maximumLength, NSMaxRange(range) - cursor)
                let piece = NSRange(location: cursor, length: length)
                result.append((source.substring(with: piece), cursor))
                cursor += length
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
        return result.filter { !$0.0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    fileprivate func parseSpeechChunks(_ value: Any?) -> [(text: String, offset: Int, pauseSeconds: Double)] {
        let chunks = (value as? [[String: Any]]) ?? (value as? [Any] ?? [])
            .compactMap { $0 as? [String: Any] }
        var parsed: [(text: String, offset: Int, pauseSeconds: Double)] = []
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
            parsed.append((text: trimmed, offset: max(0, offset), pauseSeconds: pauseSeconds))
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
                } else if !self.isSpeaking && !self.playbackQueue.hasPendingRequest {
                    self.requestSpeechText()
                }
            }
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self, self.speech.isSpeaking else { return }
                self.speech.pauseSpeaking(at: .word)
                self.isSpeaking = false
                self.updateNowPlaying(isPlaying: false)
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
        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
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
        let gesture = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePagePan(_:)))
        gesture.cancelsTouchesInView = false
        gesture.delegate = context.coordinator
        webView.addGestureRecognizer(gesture)
        controller.webView = webView
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
            let loadScript = "setReaderTheme(\(theme)); setKnownWords(\(knownArgument)); " +
                "loadBook(\(publication), \(cfi), \(theme), \(highlight), \(bookID)); null;"
            webView.evaluateJavaScript("[typeof window.loadBook, typeof window.ePub, typeof window.JSZip].join('|')") {
                [weak controller, weak webView] value, error in
                if let error {
                    controller?.errorMessage = "Could not initialize the EPUB reader: \(error.localizedDescription)"
                    return
                }
                guard value as? String == "function|function|function" else {
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
            case "onRelocated": handleRelocation(value as? String)
            case "onSections": handleSections(value as? String)
            case "onWordSelected": handleWordSelection(value as? String)
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
                              year: book.year, locator: cfi, pageIndex: 0, pageOffset: 0)
            )
            Task { await container.nostrSyncService.pushProgress(book: book, progression: progression, cfi: cfi) }
        }

        private func handleSections(_ json: String?) {
            guard let json, let data = json.data(using: .utf8),
                  let values = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
            else { return }
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
            controller.speak(text: text, language: item["language"] as? String ?? "en",
                             voiceIdentifier: container.settingsRepository.speechVoiceIdentifier,
                             rate: container.settingsRepository.speechRate,
                             chunks: chunks.isEmpty ? nil : chunks,
                             requestID: item["requestID"] as? String)
        }
    }
}
