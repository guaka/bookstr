import SwiftUI
import WebKit

@MainActor
final class ComicReaderController: ObservableObject {
    @Published var progression = 0.0
    @Published var furthestProgression = 0.0
    @Published var pageIndex = 0
    @Published var pageCount = 0
    @Published var ready = false
    @Published var loadingStage = "Opening comic"
    @Published var errorMessage: String?

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
        webView.accessibilityLabel = "(format.rawValue.uppercased()) comic reader"
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
    }

    static let bridgeScript = """
    (() => {
      document.documentElement.classList.add('bookstr-native-chrome');
      const send = (method, value) => window.webkit.messageHandlers.bookstrComic.postMessage({ method, value });
      window.BookstrComic = {
        onComicProgress: (pageIndex, pageCount) => send('progress', { pageIndex, pageCount }),
        onComicError: value => send('error', String(value || 'Could not open comic archive.'))
      };
    })();
    """

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKURLSchemeHandler {
        private let book: CatalogBook
        private let format: BookFormat
        private let fileURL: URL
        private let controller: ComicReaderController
        private let initialLocator: String?
        private let onProgress: (Double, String) -> Void

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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            controller.loadingStage = "Extracting pages"
            let initialPage = ComicReaderController.page(
                from: initialLocator,
                fallbackProgression: controller.furthestProgression
            )
            let archivePath = "/books/current.\(format.rawValue)"
            let options: [String: Any] = [
                "format": format.rawValue,
                "bookTitle": book.title,
                "bookId": book.id,
                "archiveURL": "bookstr-comic://app\(archivePath)",
                "initialPage": initialPage
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: options),
                  let json = String(data: data, encoding: .utf8) else {
                controller.errorMessage = "Could not configure the comic reader."
                return
            }
            webView.evaluateJavaScript("[typeof loadComic,typeof JSZip,typeof libarchive].join('|')") {
                [weak self, weak webView] value, error in
                guard let self else { return }
                if let error {
                    self.controller.errorMessage = "Could not initialize the comic reader: \(error.localizedDescription)"
                    return
                }
                guard value as? String == "function|function|function" else {
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
    }
}
