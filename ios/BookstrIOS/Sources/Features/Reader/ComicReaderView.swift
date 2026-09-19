import SwiftUI
import WebKit
import LibArchive

@MainActor
final class ComicReaderController: ObservableObject {
    static let fitZoom = 0.92
    static let minimumZoom = 0.25
    static let maximumZoom = 3.0

    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var pageIndex = 0
    @Published var pageCount = 0
    @Published var ready = false
    @Published var loadingStage = "Opening comic"
    @Published var errorMessage: String?
    @Published var zoomScale = fitZoom
    @Published var panX = 0
    @Published var panY = 0
    @Published var maximumPanX = 0
    @Published var maximumPanY = 0

    fileprivate weak var webView: WKWebView?

    func update(pageIndex: Int, pageCount: Int) {
        let count = max(pageCount, 0)
        let index = count > 0 ? min(max(pageIndex, 0), count - 1) : 0
        self.pageIndex = index
        self.pageCount = count
        progression = count > 1 ? Double(index) / Double(count - 1) : 0
        furthestProgression = max(furthestProgression, progression)
        ready = count > 0
        loadingStage = ready ? "Comic ready" : "Opening comic"
    }

    func zoomIn() { setZoom(zoomScale + 0.2) }
    func zoomOut() { setZoom(zoomScale - 0.2) }
    func fitPage() { setZoom(Self.fitZoom) }

    func updateZoom(_ value: Double) {
        zoomScale = min(max(value, Self.minimumZoom), Self.maximumZoom)
    }

    func updatePan(x: Int, y: Int, maximumX: Int, maximumY: Int) {
        panX = max(0, x)
        panY = max(0, y)
        maximumPanX = max(0, maximumX)
        maximumPanY = max(0, maximumY)
    }

    var accessibilityValue: String {
        "Page \(pageIndex + 1) of \(pageCount), zoom \(Int(round(zoomScale * 100))) percent, "
            + "horizontal scroll \(panX) of \(maximumPanX), vertical scroll \(panY) of \(maximumPanY)"
    }

    private func setZoom(_ value: Double) {
        let clamped = min(max(value, Self.minimumZoom), Self.maximumZoom)
        zoomScale = clamped
        webView?.evaluateJavaScript("window.BookstrComicZoom?.set(\(clamped)); null;")
    }

    nonisolated static func page(from locator: String?, fallbackProgression: Double = 0) -> Int {
        guard let locator, locator.hasPrefix("comic:") else {
            return max(0, Int(fallbackProgression.rounded(.down)))
        }
        let components = locator.split(separator: ":")
        guard components.count > 1, let page = Int(components[1]) else { return 0 }
        return max(0, page)
    }
}

struct ComicReaderView: UIViewRepresentable {
    let book: CatalogBook
    let format: BookFormat
    let fileURL: URL
    @ObservedObject var controller: ComicReaderController
    let initialLocator: String?
    var onProgress: (Double, String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            book: book,
            format: format,
            fileURL: fileURL,
            controller: controller,
            initialLocator: initialLocator,
            onProgress: onProgress
        )
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.setURLSchemeHandler(context.coordinator, forURLScheme: "bookstr-comic")
        configuration.userContentController.add(context.coordinator, name: "bookstrComic")
        configuration.userContentController.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        let webView = WKWebView(frame: UIScreen.main.bounds, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.accessibilityIdentifier = "comic-reader-webview"
        webView.accessibilityLabel = "\(format.rawValue.uppercased()) comic reader"
        webView.accessibilityValue = controller.accessibilityValue
        controller.webView = webView

        if let readerURL = URL(string: "bookstr-comic://app/comic-reader.html") {
            webView.load(URLRequest(url: readerURL, cachePolicy: .reloadIgnoringLocalCacheData))
        } else {
            controller.errorMessage = "The comic reader could not be initialized."
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        controller.webView = webView
        webView.accessibilityValue = controller.accessibilityValue
    }

    static let bridgeScript = """
    (() => {
      document.documentElement.classList.add('bookstr-native-chrome');
      const send = (method, value) => window.webkit.messageHandlers.bookstrComic.postMessage({ method, value });
      window.BookstrComic = {
        onComicProgress: (pageIndex, pageCount) => send('progress', { pageIndex, pageCount }),
        onComicZoom: value => send('zoom', Number(value)),
        onComicPan: value => send('pan', value),
        onComicError: value => send('error', String(value || 'Could not open comic archive.'))
      };
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKURLSchemeHandler {
        private struct NativePage: Sendable {
            let name: String
            let url: URL
        }

        private let book: CatalogBook
        private let format: BookFormat
        private let fileURL: URL
        private let controller: ComicReaderController
        private let initialLocator: String?
        private let onProgress: (Double, String) -> Void
        private var nativePages: [NativePage] = []
        private var extractionDirectory: URL?
        private var hasStartedLoading = false

        init(
            book: CatalogBook,
            format: BookFormat,
            fileURL: URL,
            controller: ComicReaderController,
            initialLocator: String?,
            onProgress: @escaping (Double, String) -> Void
        ) {
            self.book = book
            self.format = format
            self.fileURL = fileURL
            self.controller = controller
            self.initialLocator = initialLocator
            self.onProgress = onProgress
        }

        deinit {
            if let extractionDirectory {
                try? FileManager.default.removeItem(at: extractionDirectory)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !hasStartedLoading else { return }
            hasStartedLoading = true
            controller.loadingStage = "Opening comic"
            let initialPage = ComicReaderController.page(
                from: initialLocator,
                fallbackProgression: controller.furthestProgression
            )
            var options: [String: Any] = [
                "format": format.rawValue,
                "bookTitle": book.title,
                "bookId": book.id,
                "initialPage": initialPage
            ]
            if format == .cbr {
                Task { [weak self, weak webView] in
                    guard let self else { return }
                    do {
                        let prepared = try await Self.extractRARPages(from: self.fileURL)
                        self.extractionDirectory = prepared.directory
                        self.nativePages = prepared.pages
                        options["pages"] = prepared.pages.enumerated().map { index, page in
                            ["name": page.name, "url": "bookstr-comic://app/pages/\(index)"]
                        }
                        self.startComic(options: options, in: webView)
                    } catch {
                        self.controller.errorMessage = error.localizedDescription
                    }
                }
            } else {
                options["archiveURL"] = "bookstr-comic://app/books/current.cbz"
                startComic(options: options, in: webView)
            }
        }

        private func startComic(options: [String: Any], in webView: WKWebView?) {
            guard let data = try? JSONSerialization.data(withJSONObject: options),
                  let json = String(data: data, encoding: .utf8) else {
                controller.errorMessage = "Could not configure the comic reader."
                return
            }
            webView?.evaluateJavaScript("[typeof loadComic,typeof JSZip].join('|')") {
                [weak self, weak webView] value, error in
                guard let self else { return }
                if let error {
                    self.controller.errorMessage = "Could not initialize the comic reader: \(error.localizedDescription)"
                    return
                }
                guard value as? String == "function|function" else {
                    self.controller.errorMessage = "The comic reader resources did not load."
                    return
                }
                webView?.evaluateJavaScript("loadComic(\(json)); null;") { [weak self] _, error in
                    if let error {
                        self?.controller.errorMessage = "Could not start the comic reader: \(error.localizedDescription)"
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            controller.errorMessage = error.localizedDescription
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            controller.errorMessage = error.localizedDescription
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "bookstrComic",
                  let body = message.body as? [String: Any],
                  let method = body["method"] as? String else { return }
            switch method {
            case "progress":
                guard let value = body["value"] as? [String: Any],
                      let pageIndex = (value["pageIndex"] as? NSNumber)?.intValue,
                      let pageCount = (value["pageCount"] as? NSNumber)?.intValue else { return }
                controller.update(pageIndex: pageIndex, pageCount: pageCount)
                let locator = "comic:\(controller.pageIndex):\(controller.pageCount)"
                onProgress(controller.progression, locator)
            case "error":
                controller.errorMessage = body["value"] as? String ?? "Could not open comic archive."
            case "zoom":
                guard let value = body["value"] as? NSNumber else { return }
                controller.updateZoom(value.doubleValue)
            case "pan":
                guard let value = body["value"] as? [String: Any],
                      let x = (value["x"] as? NSNumber)?.intValue,
                      let y = (value["y"] as? NSNumber)?.intValue,
                      let maximumX = (value["maximumX"] as? NSNumber)?.intValue,
                      let maximumY = (value["maximumY"] as? NSNumber)?.intValue else { return }
                controller.updatePan(x: x, y: y, maximumX: maximumX, maximumY: maximumY)
            default:
                break
            }
        }

        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            let url = urlSchemeTask.request.url
            do {
                let data: Data
                let mimeType: String
                switch url?.path {
                case "/comic-reader.html":
                    data = try bundled("comic-reader", extension: "html")
                    mimeType = "text/html"
                case "/jszip.min.js":
                    data = try bundled("jszip.min", extension: "js")
                    mimeType = "text/javascript"
                case "/vendor/libarchive.js":
                    data = try bundled("libarchive", extension: "js", subdirectory: "vendor")
                    mimeType = "text/javascript"
                case "/vendor/libarchive.wasm":
                    data = try bundled("libarchive", extension: "wasm", subdirectory: "vendor")
                    mimeType = "application/wasm"
                case "/books/current.cbr", "/books/current.cbz":
                    data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
                    mimeType = "application/octet-stream"
                case let path? where path.hasPrefix("/pages/"):
                    guard let index = Int(path.dropFirst("/pages/".count)),
                          nativePages.indices.contains(index) else { throw URLError(.fileDoesNotExist) }
                    let page = nativePages[index]
                    data = try Data(contentsOf: page.url, options: .mappedIfSafe)
                    mimeType = Self.imageMIMEType(for: page.url.pathExtension)
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
                      ) else { throw URLError(.badServerResponse) }
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch {
                urlSchemeTask.didFailWithError(error)
            }
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

        private func bundled(_ name: String, extension fileExtension: String, subdirectory: String? = nil) throws -> Data {
            let url = Bundle.main.url(forResource: name, withExtension: fileExtension, subdirectory: subdirectory)
                ?? Bundle.main.url(forResource: name, withExtension: fileExtension)
            guard let url else {
                throw NSError(
                    domain: "BookstrComicReader",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Missing comic reader resource \(name).\(fileExtension)"]
                )
            }
            return try Data(contentsOf: url, options: .mappedIfSafe)
        }

        private static func extractRARPages(from archiveURL: URL) async throws -> (directory: URL, pages: [NativePage]) {
            try await Task.detached(priority: .userInitiated) {
                let fileManager = FileManager.default
                let directory = fileManager.temporaryDirectory
                    .appendingPathComponent("bookstr-cbr-\(UUID().uuidString)", isDirectory: true)
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)

                do {
                    var pages: [NativePage] = []
                    var activeHandle: FileHandle?
                    var activeEntryPath: String?
                    var activeURL: URL?
                    var expectedSize: Int64 = 0
                    var receivedSize: Int64 = 0
                    var seenEntries = 0

                    try ArchiveReader().readDataBlocks(
                        in: archiveURL,
                        selecting: { entry in
                            seenEntries += 1
                            guard seenEntries <= PublicationUtilities.maxComicEntries else {
                                throw comicError("The archive contains too many entries.")
                            }
                            guard entry.fileType == .regular,
                                  !entry.isDataEncrypted, !entry.isMetadataEncrypted,
                                  entry.size > 0,
                                  entry.size <= Int64(PublicationUtilities.maxComicPageBytes),
                                  isSafeImagePath(entry.path) else { return .skip }

                            let fileExtension = URL(fileURLWithPath: entry.path).pathExtension.lowercased()
                            let outputURL = directory.appendingPathComponent(
                                String(format: "page-%04d.%@", pages.count, fileExtension)
                            )
                            guard fileManager.createFile(atPath: outputURL.path, contents: nil),
                                  let handle = try? FileHandle(forWritingTo: outputURL) else {
                                throw comicError("Could not prepare a comic page.")
                            }
                            activeHandle = handle
                            activeEntryPath = entry.path
                            activeURL = outputURL
                            expectedSize = entry.size
                            receivedSize = 0
                            return .read
                        },
                        didFinishEntry: { entry, consumedToEOF in
                            guard activeEntryPath == entry.path else { return }
                            try activeHandle?.close()
                            if consumedToEOF, receivedSize == expectedSize, let activeURL {
                                pages.append(NativePage(name: entry.path, url: activeURL))
                            } else if let activeURL {
                                try? fileManager.removeItem(at: activeURL)
                            }
                            activeHandle = nil
                            activeEntryPath = nil
                            activeURL = nil
                        },
                        { entry, block in
                            guard activeEntryPath == entry.path, let activeHandle else { return .finishEntry }
                            guard block.offset >= 0,
                                  block.offset + Int64(block.data.count) <= expectedSize else {
                                return .finishEntry
                            }
                            try activeHandle.seek(toOffset: UInt64(block.offset))
                            try activeHandle.write(contentsOf: block.data)
                            receivedSize += Int64(block.data.count)
                            return .continueReading
                        }
                    )
                    try activeHandle?.close()
                    guard !pages.isEmpty else {
                        throw comicError("The CBR archive contains no readable comic pages.")
                    }
                    pages.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                    return (directory, pages)
                } catch {
                    try? fileManager.removeItem(at: directory)
                    throw error
                }
            }.value
        }

        private static func isSafeImagePath(_ path: String) -> Bool {
            let normalized = path.replacingOccurrences(of: "\\", with: "/")
            let components = normalized.split(separator: "/", omittingEmptySubsequences: false)
            guard !normalized.hasPrefix("/"), !components.contains(".."), !components.contains("") else { return false }
            let lower = normalized.lowercased()
            guard !lower.hasPrefix("__macosx/"), !lower.contains("/__macosx/") else { return false }
            return ["jpg", "jpeg", "png", "gif", "webp"].contains(URL(fileURLWithPath: lower).pathExtension)
        }

        private static func imageMIMEType(for fileExtension: String) -> String {
            switch fileExtension.lowercased() {
            case "jpg", "jpeg": return "image/jpeg"
            case "png": return "image/png"
            case "gif": return "image/gif"
            case "webp": return "image/webp"
            default: return "application/octet-stream"
            }
        }

        private static func comicError(_ message: String) -> NSError {
            NSError(
                domain: "BookstrComicReader",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }
    }
}
