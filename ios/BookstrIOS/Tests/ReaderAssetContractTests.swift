import CryptoKit
import XCTest
#if !SWIFT_PACKAGE
import JavaScriptCore
#endif
#if SWIFT_PACKAGE
@testable import BookstrLogic
#else
import PDFKit
import WebKit
@testable import BookstrIOS
#endif

final class ReaderAssetContractTests: XCTestCase {
#if !SWIFT_PACKAGE
    func testComicReaderResourcesAreBundled() throws {
        XCTAssertNotNil(Bundle.main.url(forResource: "comic-reader", withExtension: "html"))
        XCTAssertNotNil(Bundle.main.url(forResource: "jszip.min", withExtension: "js"))
        XCTAssertNotNil(
            Bundle.main.url(forResource: "libarchive", withExtension: "js", subdirectory: "vendor")
                ?? Bundle.main.url(forResource: "libarchive", withExtension: "js")
        )
        XCTAssertNotNil(
            Bundle.main.url(forResource: "libarchive", withExtension: "wasm", subdirectory: "vendor")
                ?? Bundle.main.url(forResource: "libarchive", withExtension: "wasm")
        )
    }

    func testComicLocatorRestoresPageIndex() {
        XCTAssertEqual(ComicReaderController.page(from: "comic:12:30"), 12)
        XCTAssertEqual(ComicReaderController.page(from: "epubcfi(/6/2)"), 0)
        XCTAssertEqual(ComicReaderController.page(from: "comic:-4:30"), 0)
    }
#endif

    func testSpeechPlaybackQueueYieldsEveryChunkOnceInOrder() {
        var queue = SpeechPlaybackQueue()
        let chunks = [
            SpeechQueueChunk(text: "First.", offset: 0, pauseSeconds: 0),
            SpeechQueueChunk(text: "Second.", offset: 7, pauseSeconds: 0.18),
            SpeechQueueChunk(text: "Third.", offset: 15, pauseSeconds: 0.32),
        ]

        queue.beginRequest(id: "current")
        XCTAssertTrue(queue.accept(requestID: "current", chunks: chunks))
        XCTAssertFalse(queue.hasPendingRequest)
        XCTAssertEqual(queue.next(), chunks[0])
        XCTAssertEqual(queue.next(), chunks[1])
        XCTAssertEqual(queue.next(), chunks[2])
        XCTAssertNil(queue.next(), "A completed narration must not restart from the first chunk")
        XCTAssertTrue(queue.isEmpty)
        XCTAssertEqual(chunks[0].spokenEnd, 6)
        XCTAssertEqual(SpeechQueueChunk(text: "", offset: 12, pauseSeconds: 0).spokenEnd, 13)
        XCTAssertEqual(SpeechSpokenText.normalize("100,000"), "100000")
        XCTAssertEqual(SpeechSpokenText.normalize("There were 1,000,000.5 people."), "There were 1000000.5 people.")
        XCTAssertEqual(SpeechSpokenText.normalize("Wait, then go."), "Wait, then go.")
        XCTAssertEqual(SpeechSpokenText.normalize("100\u{00A0}000"), "100000")
        XCTAssertEqual(SpeechSpokenText.normalize("He left[1] at dawn."), "He left at dawn.")
        XCTAssertEqual(SpeechSpokenText.normalize("He left\u{00B9} at dawn."), "He left at dawn.")
        XCTAssertEqual(SpeechSpokenText.normalize("See chapter 12."), "See chapter 12.")
        XCTAssertEqual(SpeechSpokenText.normalize("word(1) next"), "word next")
        XCTAssertEqual(SpeechSpokenText.normalize("(1) First item"), "(1) First item")
        XCTAssertEqual(SpeechSpokenText.normalize("He walked home.\""), "He walked home.")
        XCTAssertEqual(SpeechSpokenText.normalize("\"Hello,\" she said."), "Hello, she said.")
        XCTAssertEqual(SpeechSpokenText.normalize("\""), "")
        XCTAssertEqual(SpeechSpokenText.normalize(".\""), ".")
        XCTAssertEqual(SpeechQueueChunk(text: "He left[1].", offset: 0, pauseSeconds: 0).speak, "He left.")
        XCTAssertEqual(
            SpeechQueueChunk(text: "100,000", offset: 0, pauseSeconds: 0, speak: "one hundred thousand").speak,
            "one hundred thousand"
        )
        XCTAssertEqual(
            SpeechQueueChunk(text: "100,000", offset: 0, pauseSeconds: 0, speak: "   ").speak,
            "100000"
        )
    }

#if !SWIFT_PACKAGE
    func testFB2ParserExtractsMetadataSectionsAndNestedMarkup() throws {
        let xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
          <description><title-info><book-title>Тест</book-title><lang>ru</lang><author><first-name>Анна</first-name><last-name>Автор</last-name></author></title-info></description>
          <body><section id="chapter-1"><title><p>Глава первая</p></title><p>Привет, <emphasis>мир</emphasis>!</p><section id="nested"><title><p>Вложенная</p></title><p>Текст.</p></section></section></body>
        </FictionBook>
        """
        let document = try FB2Parser.parse(data: Data(xml.utf8))
        XCTAssertEqual(document.title, "Тест")
        XCTAssertEqual(document.author, "Анна Автор")
        XCTAssertEqual(document.language, "ru")
        XCTAssertEqual(document.flatSections.map(\.id), ["chapter-1", "nested"])
        XCTAssertEqual(document.flatSections[0].title, "Глава первая")
        XCTAssertEqual(document.flatSections[0].paragraphs.first?.text, "Привет, мир!")
    }

    func testFB2ParserRejectsExternalEntitiesAndEmptyBodies() {
        XCTAssertThrowsError(try FB2Parser.parse(data: Data("<!DOCTYPE FictionBook [<!ENTITY x SYSTEM 'file:///tmp/x'>]><FictionBook/>".utf8))) { error in
            XCTAssertTrue(error is FB2ParseError)
        }
        XCTAssertThrowsError(try FB2Parser.parse(data: Data("<FictionBook><body/></FictionBook>".utf8))) { error in
            XCTAssertEqual(error as? FB2ParseError, .emptyBody)
        }
    }

    @MainActor
    func testFB2ReaderLoadsDeflatedZipAndEmitsFourPartLocator() async throws {
        let encoded = "UEsDBBQAAAAIAI+eHF2swOoxXQAAAJsAAAAIAAAAYm9vay5mYjJVjkEKgDAMBF9U8oGQg4gv8AO2jRAsTbE56O+tClKPOzssi5MEE82D6kYYuYZdyg0ITSyxk7wqoW+1ewCNvKbFOCJ0EKG34bfjNZ6ElcMbC818GEJp3gfhlaB/cwFQSwECFAMUAAAACACPnhxdrMDqMV0AAACbAAAACAAAAAAAAAAAAAAAgAEAAAAAYm9vay5mYjJQSwUGAAAAAAEAAQA2AAAAgwAAAAAA"
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".fb2.zip")
        defer { try? FileManager.default.removeItem(at: fileURL) }
        try XCTUnwrap(Data(base64Encoded: encoded)).write(to: fileURL)

        let controller = FB2ReaderController()
        await controller.load(fileURL: fileURL, initialLocator: nil)
        XCTAssertTrue(controller.ready)
        let section = try XCTUnwrap(controller.sections.first)
        XCTAssertEqual(controller.update(section: section.index, paragraph: 0, offset: 7), "fb2:\(section.id):0:7")
        await controller.load(fileURL: fileURL, initialLocator: "fb2:\(section.id):0:0")
        XCTAssertEqual(controller.sectionIndex, section.index)
    }

    func testEPUBSpeechPlannerKeepsShortTailAndParagraphPause() throws {
        let html = try bundledReaderHTML()
        let speechSource = try bundledAsset(named: "reader-speech", extension: "js")
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript(speechSource)
        let sentence = (0..<28).map { "word\($0)" }.joined(separator: " ") + "."
        let arguments = try JSONSerialization.data(withJSONObject: [sentence, "Second paragraph."])
        let json = try XCTUnwrap(String(data: arguments, encoding: .utf8))
        let result = try XCTUnwrap(
            context.evaluateScript("JSON.stringify(BookstrSpeech.buildPlan(\(json)))").toString()
        )
        let data = try XCTUnwrap(result.data(using: .utf8))
        let plan = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let chunks = try XCTUnwrap(plan["chunks"] as? [[String: Any]])

        XCTAssertEqual(sentence.count, 186)
        XCTAssertEqual(chunks.count, 2)
        XCTAssertEqual(chunks[0]["text"] as? String, sentence)
        XCTAssertEqual((chunks[0]["pauseMs"] as? NSNumber)?.intValue, 0)
        XCTAssertEqual(chunks[1]["text"] as? String, "Second paragraph.")
        XCTAssertEqual((chunks[1]["pauseMs"] as? NSNumber)?.intValue, 750)
        XCTAssertTrue(html.contains("<script src=\"reader-speech.js\"></script>"))
        XCTAssertEqual(html.components(separatedBy: "<script src=\"reader-speech.js\"></script>").count - 1, 1)
        XCTAssertTrue(html.contains("<script src=\"reader-typography.js\"></script>"))
        XCTAssertTrue(html.contains("window.BookstrSpeech.buildPlan(parts)"))
#if !SWIFT_PACKAGE
        let typographySource = try bundledAsset(named: "reader-typography", extension: "js")
        context.evaluateScript(typographySource)
        XCTAssertEqual(context.evaluateScript("BookstrTypography.normalizeFont('nope')").toString(), "arial")
        XCTAssertEqual(context.evaluateScript("BookstrTypography.normalizeAlignment(null)").toString(), "justified")
        XCTAssertTrue(context.evaluateScript("BookstrTypography.css()").toString()?.contains("text-align:justify") == true)
#endif
    }

    func testNativeSpeechFallbackPreservesTextOffsetsAndAvoidsFinalWordOrphans() {
        let text = (0..<75).map { "fallback\($0)" }.joined(separator: " ") + "."
        let chunks = NativeSpeechFallback.chunks(text)

        XCTAssertGreaterThan(chunks.count, 1)
        XCTAssertTrue(chunks.allSatisfy { ($0.text as NSString).length <= 240 })
        XCTAssertNotEqual(chunks.last?.text.split(whereSeparator: \.isWhitespace).count, 1)
        XCTAssertEqual(chunks.map(\.text).joined(separator: " "), text)
        for chunk in chunks {
            XCTAssertEqual((text as NSString).substring(
                with: NSRange(location: chunk.offset, length: (chunk.text as NSString).length)
            ), chunk.text)
        }

        XCTAssertTrue(NativeSpeechFallback.chunks("").isEmpty)
        XCTAssertTrue(NativeSpeechFallback.chunks("   ").isEmpty)

        let regression = (0..<28).map { "word\($0)" }.joined(separator: " ") + "."
        XCTAssertEqual(NativeSpeechFallback.chunks(regression).map(\.text), [regression])

        let sentenceBoundary = "A short first sentence. "
            + (0..<45).map { "sentence\($0)" }.joined(separator: " ") + "."
        XCTAssertEqual(
            NativeSpeechFallback.chunks(sentenceBoundary).map(\.text).joined(separator: " "),
            sentenceBoundary
        )

        let firstGroupedSentence = String(repeating: "Alpha ", count: 20) + "ends."
        let secondGroupedSentence = String(repeating: "Beta ", count: 24) + "ends."
        let groupedSentences = firstGroupedSentence + " " + secondGroupedSentence
        XCTAssertEqual(
            NativeSpeechFallback.chunks(groupedSentences).map(\.text),
            [firstGroupedSentence, secondGroupedSentence]
        )

        let afterSoftBoundary = "lead " + String(repeating: "x", count: 190)
            + " tail words continue until this fallback must split the text safely"
        XCTAssertEqual(
            NativeSpeechFallback.chunks(afterSoftBoundary).map(\.text).joined(separator: " "),
            afterSoftBoundary
        )

        let rebalanced = NativeSpeechFallback.chunks("aaaaa bbbbb ccccc ddddd", maximumLength: 20)
        XCTAssertEqual(rebalanced.map(\.text), ["aaaaa bbbbb", "ccccc ddddd"])
        XCTAssertEqual(rebalanced.map(\.offset), [0, 12])

        let unbroken = String(repeating: "z", count: 51)
        XCTAssertEqual(NativeSpeechFallback.chunks(unbroken, maximumLength: 20).map(\.text).joined(), unbroken)

        let clause = String(repeating: "before ", count: 22) + "break, " + String(repeating: "after ", count: 22) + "end."
        let clauseChunks = NativeSpeechFallback.chunks(clause)
        XCTAssertGreaterThan(clauseChunks.count, 1)
        XCTAssertTrue(clauseChunks.contains { $0.text.hasSuffix(",") || $0.text.contains("break,") })
    }
#endif

    func testSpeechPlaybackQueueRejectsStaleWebViewResponse() {
        var queue = SpeechPlaybackQueue()
        let stale = [SpeechQueueChunk(text: "Old narration", offset: 0, pauseSeconds: 0)]
        let current = [SpeechQueueChunk(text: "Current narration", offset: 20, pauseSeconds: 0)]

        queue.beginRequest(id: "old")
        queue.beginRequest(id: "current")

        XCTAssertFalse(queue.accept(requestID: "old", chunks: stale))
        XCTAssertTrue(queue.hasPendingRequest)
        XCTAssertTrue(queue.accept(requestID: "current", chunks: current))
        XCTAssertEqual(queue.next(), current[0])
        XCTAssertNil(queue.next())
    }

    func testSpeechPlaybackQueueRejectsDuplicateResponse() {
        var queue = SpeechPlaybackQueue()
        let chunks = [SpeechQueueChunk(text: "Only once", offset: 0, pauseSeconds: 0)]

        queue.beginRequest(id: "request")
        XCTAssertTrue(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertFalse(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertEqual(queue.next(), chunks[0])
        XCTAssertNil(queue.next())
    }

    func testSpeechPlaybackQueueCancellationRejectsDelayedResponseAndClearsAudio() {
        var queue = SpeechPlaybackQueue()
        let chunks = [SpeechQueueChunk(text: "Do not play", offset: 0, pauseSeconds: 0)]

        queue.beginRequest(id: "request")
        queue.cancel()

        XCTAssertFalse(queue.hasPendingRequest)
        XCTAssertTrue(queue.isEmpty)
        XCTAssertFalse(queue.accept(requestID: "request", chunks: chunks))
        XCTAssertNil(queue.next())
    }

    func testSpeechBridgeCarriesRequestIdentityBackToNativeCode() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.BookstrSpeech.visibleText(block)"))
        XCTAssertTrue(html.contains("window.setReaderTypography"))
        XCTAssertTrue(html.contains("<script src=\"reader-typography.js\"></script>"))
        XCTAssertTrue(html.contains("BookstrTypography.css"))
        XCTAssertTrue(html.contains("Arial, Helvetica, sans-serif"))
        XCTAssertTrue(html.contains("isSilentSpeechParent"))
        XCTAssertTrue(html.contains("requestID: requestID || null"))
    }

    func testAllEPUBRuntimeAssetsAreBundledInTheApplication() throws {
        let reader = try bundledAsset(named: "reader", extension: "html")
        let epub = try bundledAsset(named: "epub.min", extension: "js")
        let zip = try bundledAsset(named: "jszip.min", extension: "js")

        XCTAssertGreaterThan(reader.count, 20_000)
        XCTAssertGreaterThan(epub.count, 100_000)
        XCTAssertGreaterThan(zip.count, 50_000)
    }

    func testIOSReaderUsesOneContinuousScrollableDocument() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("manager: \"continuous\""))
        XCTAssertTrue(html.contains("flow: \"scrolled-doc\""))
        XCTAssertFalse(html.contains("manager: nativePaginated"))
        XCTAssertFalse(html.contains("flow: nativePaginated"))
    }

    func testFirstSpineItemIsNotAutomaticallyForcedIntoCoverLayout() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("href.includes(\"cover\")"))
        XCTAssertTrue(html.contains("properties.includes(\"cover\")"))
        XCTAssertFalse(html.contains("section.index === 0 || href.includes(\"cover\")"))
    }

    func testPageCommandsMoveTheViewportInOppositeDirections() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.nextPage = function() {\n      moveViewportPage(1);"))
        XCTAssertTrue(html.contains("window.prevPage = function() {\n      moveViewportPage(-1);"))
        XCTAssertTrue(html.contains("container.scrollBy({ top: direction * distance, behavior: \"auto\" })"))
    }

    func testPageMovementFallsBackToTheNextSpineSectionOnlyWhenScrollingDidNotMove() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("Math.abs(container.scrollTop - before) > 2"))
        XCTAssertTrue(html.contains("direction > 0 ? rendition.next() : rendition.prev()"))
        XCTAssertTrue(html.contains("if (direction < 0 && container && container.scrollTop <= 2) return"))
    }

    func testReaderForwardsKnownWordTapToNativeBridge() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("installKnownWordNavigation(contentDocument);"))
        XCTAssertTrue(html.contains("AndroidBridge.onKnownWordTapped(normalized);"))
    }

    func testReaderForwardsSavedWordAndMarkTapsToNativeBridge() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("activateSavedHighlight({ kind: resolvedKind, locator: cfi });"))
        XCTAssertTrue(html.contains("activeReaderHighlights[group].includes(cfi)"))
        XCTAssertTrue(html.contains("savedHighlightAtPoint(contentDocument, event.clientX, event.clientY)"))
        XCTAssertTrue(html.contains("window.activateSavedHighlightAtViewportPoint(event.clientX, event.clientY)"))
        XCTAssertTrue(html.contains("x - rect.left, y - rect.top"))
        XCTAssertTrue(html.contains("window.activateSavedHighlightAtViewportPoint = function(x, y)"))
        XCTAssertTrue(html.contains("lastSavedHighlightActivation"))
        XCTAssertTrue(html.contains("const range = contents.range(cfi);"))
        XCTAssertTrue(html.contains(#"{ kind: "mark", values: activeReaderHighlights.marks }"#))
    }

    func testReaderUsesPinchToResizeFontLikeAndroid() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("let pinchStartDistance = 0;"))
        XCTAssertTrue(html.contains("const ratio = distance / pinchStartDistance;"))
        XCTAssertTrue(html.contains("const dampedRatio = 1 + (ratio - 1) * 0.35;"))
        XCTAssertTrue(html.contains("const next = Math.max(75, Math.min(180, Math.round(pinchStartFontPercent * dampedRatio)));"))
    }

    func testReaderSwipeNavigationDetectsPinchGesture() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("gestureAxis = \"pinch\";"))
        XCTAssertTrue(html.contains("pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);"))
        XCTAssertTrue(html.contains("pinchStartFontPercent = readerFontPercent;"))
        XCTAssertTrue(html.contains("gestureAxis = null;"))
    }

    func testReaderSwipeNavigationResetsPinchStateOnEndAndCancel() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (gestureAxis === \"pinch\") {"))
        XCTAssertTrue(html.contains("if (event.touches.length < 2) {"))
        XCTAssertTrue(html.contains("gestureAxis = null;"))
        XCTAssertTrue(html.contains("pinchStartDistance = 0;"))
        XCTAssertTrue(html.contains("pinchAnchor = null;"))
        XCTAssertTrue(html.contains("target.addEventListener(\"touchcancel\""))
    }

    func testReaderSwipeNavigationUsesHorizontalSwipeThresholds() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (!gestureAxis && Math.max(absX, absY) > 8) {"))
        XCTAssertTrue(html.contains("else if (absX > 14 && absX > absY * 1.35) gestureAxis = \"horizontal\";"))
        XCTAssertTrue(html.contains("if (gestureAxis !== \"horizontal\" || Math.abs(dx) < 72) {"))
        XCTAssertTrue(html.contains("if (dx < 0) nextPage(); else prevPage();"))
    }

    func testReaderDoesNotDisableNativePinchByForcingTouchActionPanYInScript() throws {
        let html = try bundledReaderHTML()

        XCTAssertFalse(html.contains("target.documentElement.style.touchAction = \"pan-y\""))
        XCTAssertFalse(html.contains("target.body.style.touchAction = \"pan-y\""))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("target.addEventListener(\"touchend\", function(event)"))
    }

    func testReaderZoomAPICapsFontPercentRange() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.adjustReaderFont = function(delta) {"))
        XCTAssertTrue(html.contains("readerFontPercent = Math.max(75, Math.min(180, readerFontPercent + Number(delta || 0)));"))
        XCTAssertTrue(html.contains("localStorage.setItem(\"bookstr-reader-font-percent\", String(readerFontPercent));"))
    }

    func testKnownWordSetIsBuiltFromInputJSON() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.setKnownWords = function(wordsJson) {"))
        XCTAssertTrue(html.contains("window.highlightReaderCfi = function(cfi, kind)"))
        XCTAssertTrue(html.contains("window.highlightCurrentSelection = function(kind)"))
        XCTAssertTrue(html.contains("window.setReaderHighlights = function(highlightsJson)"))
        XCTAssertTrue(html.contains("\"bookstr-\" + resolvedKind + \"-highlight\""))
        XCTAssertTrue(html.contains("::highlight(bookstr-mark)"))
        XCTAssertTrue(html.contains("word: { background: \"#e7c766\""))
        XCTAssertTrue(html.contains("mark: { background: \"#efaa96\""))
        XCTAssertTrue(html.contains("word: { background: \"#68561f\""))
        XCTAssertTrue(html.contains("mark: { background: \"#713327\""))
        XCTAssertTrue(html.contains("function repaintReaderAnnotations()"))
        XCTAssertTrue(html.contains("rendition.annotations.remove(cfi, \"highlight\")"))
        XCTAssertTrue(html.contains("function captureLiveTextSelection()"))
        XCTAssertTrue(html.contains("function paintCurrentSelectionHighlight(kind)"))
        XCTAssertTrue(html.contains("knownWordSet = new Set(words.map(function(word) {"))
        XCTAssertTrue(html.contains("return String(word || \"\").normalize(\"NFC\").toLocaleLowerCase();"))
        XCTAssertTrue(html.contains("if (rendition && rendition.getContents) {"))
    }

    func testKnownWordNavigationIsGuardedAndCapturesClicks() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("function installKnownWordNavigation(contentDocument) {"))
        XCTAssertTrue(html.contains("if (contentDocument.__bookstrKnownWordNavigation) return;"))
        XCTAssertTrue(html.contains("contentDocument.addEventListener(\"click\", function(event)"))
        XCTAssertTrue(html.contains("}, true);"))
    }

    func testKnownWordTapRequiresExactKnownWordMatchInContent() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("if (knownWordSet.has(normalized) && window.AndroidBridge) {"))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("event.stopPropagation();"))
        XCTAssertTrue(html.contains("AndroidBridge.onKnownWordTapped(normalized);"))
    }

    func testDictionaryRequiresAnExplicitAddToWordsAction() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("id=\"dictionary-save\""))
        XCTAssertTrue(html.contains("aria-label=\"Add to Words\""))
        XCTAssertTrue(html.contains("function saveActiveDictionaryWord() {"))
        XCTAssertTrue(html.contains("AndroidBridge.onWordSelected(JSON.stringify(activeDictionary));"))
        XCTAssertTrue(html.contains("activeDictionary = Object.assign({}, activeDictionary, payload);"))
        XCTAssertTrue(html.contains("knownWordSet.add(normalized);"))
        XCTAssertTrue(html.contains("button.textContent = saved ? \"✓\" : \"＋\";"))
    }

    func testReaderReportsSelectedPassagesForSnippetActions() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("AndroidBridge.onTextSelected(JSON.stringify(payload))"))
        XCTAssertTrue(html.contains("function captureLiveTextSelection()"))
        XCTAssertTrue(html.contains("function installSelectionBridge(contentDocument)"))
        XCTAssertTrue(html.contains("text: cleanDictionaryText(selection).slice(0, 2000)"))
        XCTAssertTrue(html.contains("contextSentence: selectionContext(selectedRange)"))
        XCTAssertTrue(html.contains("if (window.bookstrNativeSwipeNavigation) return"))
        XCTAssertTrue(html.contains("event.preventDefault();"))
        XCTAssertTrue(html.contains("event.stopPropagation();"))
        XCTAssertFalse(html.contains("id=\"selection-actions\""))
    }

#if !SWIFT_PACKAGE
    @MainActor
    func testReaderViewsKeepTheSystemSelectionBubble() {
        let webView = BookstrReaderWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let pdfView = VocabularyPDFView()

        let paste = UIAction(title: "Paste", handler: { _ in })
        let copy = UIAction(title: "Copy", handler: { _ in })
        let lookUp = UIMenu(title: "Look Up", children: [UIAction(title: "Look Up", handler: { _ in })])
        XCTAssertEqual(
            ReaderEditMenu.copyOnly(from: [paste, copy, lookUp]).compactMap { ($0 as? UIAction)?.title },
            ["Copy"]
        )

        webView.editMenuSelection = { "hello" }
        XCTAssertEqual(
            ReaderEditMenu.extraActions(
                for: webView.editMenuSelection(),
                allowsSpeech: true,
                addWord: {},
                mark: {},
                readFromHere: {}
            ).compactMap { ($0 as? UIAction)?.title },
            ["Add Word", "Mark", "Read from here"]
        )
        XCTAssertEqual(
            ReaderEditMenu.extraActions(
                for: "",
                allowsSpeech: true,
                addWord: {},
                mark: {},
                readFromHere: {}
            ).compactMap { ($0 as? UIAction)?.title },
            ["Add Word", "Mark", "Read from here"]
        )
        pdfView.editMenuSelection = { "a longer marked passage here" }
        XCTAssertEqual(
            ReaderEditMenu.extraActions(
                for: pdfView.editMenuSelection(),
                allowsSpeech: false,
                addWord: {},
                mark: {},
                readFromHere: {}
            ).compactMap { ($0 as? UIAction)?.title },
            ["Mark"]
        )
        XCTAssertEqual(
            ReaderEditMenu.menu(
                defaultActions: [paste, copy, lookUp],
                selection: "hello",
                allowsSpeech: true,
                addWord: {},
                mark: {},
                readFromHere: {}
            ).children.compactMap { ($0 as? UIAction)?.title },
            ["Copy", "Add Word", "Mark", "Read from here"]
        )
        var added = false
        let addActions = ReaderEditMenu.extraActions(
            for: "hello",
            allowsSpeech: false,
            addWord: { added = true },
            mark: {},
            readFromHere: {}
        )
        XCTAssertEqual((addActions.first as? UIAction)?.title, "Add Word")
        (addActions.first as? UIAction)?.performWithSender(nil, target: nil)
        XCTAssertTrue(added)
    }

    @MainActor
    func testPDFProgressTracksCurrentAndFurthestPage() {
        let controller = PDFReaderController()

        controller.updatePage(index: 1, count: 3)
        XCTAssertEqual(controller.progression, 0.5, accuracy: 0.000_001)
        XCTAssertEqual(controller.furthestProgression, 0.5, accuracy: 0.000_001)

        controller.updatePage(index: 0, count: 3)
        XCTAssertEqual(controller.progression, 0, accuracy: 0.000_001)
        XCTAssertEqual(controller.furthestProgression, 0.5, accuracy: 0.000_001)
    }

    func testReaderClockAlwaysUses24HourTime() throws {
        let date = try XCTUnwrap(Calendar.current.date(from: DateComponents(
            year: 2026, month: 1, day: 15, hour: 13, minute: 7
        )))
        XCTAssertEqual(ReaderClockLabel.formattedTime(date), "13:07")
        XCTAssertEqual(ReaderClockLabel.labelText(for: date), "13:07")
    }

    func testReaderHeaderKeepsMetadataLeftOfTheCameraIsland() {
        XCTAssertEqual(ReaderTopBarLayout.metadataWidth(containerWidth: 320), 70)
        XCTAssertEqual(ReaderTopBarLayout.metadataWidth(containerWidth: 393), 78.6, accuracy: 0.001)
        XCTAssertEqual(ReaderTopBarLayout.metadataWidth(containerWidth: 430), 86, accuracy: 0.001)
        XCTAssertEqual(ReaderTopBarLayout.metadataWidth(containerWidth: 600), 100)
    }
#endif

    func testReaderSearchesEverySpineSectionAndCanOpenAResult() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("window.searchBook = async function(query) {"))
        XCTAssertTrue(html.contains("const sections = (book.spine && book.spine.spineItems) || [];"))
        XCTAssertTrue(html.contains("const matches = section.find(needle) || [];"))
        XCTAssertTrue(html.contains("AndroidBridge.onSearchResults(JSON.stringify(results));"))
        XCTAssertTrue(html.contains("window.displaySearchResult = function(cfi) {"))
        XCTAssertTrue(html.contains("window.persistSpeechLocation"))
        XCTAssertTrue(html.contains("window.setSpeechResumeCfi"))
        XCTAssertTrue(html.contains("locatorSkipDecision"))
        XCTAssertTrue(html.contains("payload.source = \"speech\""))
        XCTAssertTrue(html.contains("window.requestSpeechText = function(notifyNative, requestID, fromCfi)"))
        XCTAssertTrue(html.contains("if (speechActive) return"))
        XCTAssertTrue(html.contains("function reportRestoredLocation()"))
        XCTAssertTrue(html.contains("if (speechActive) {"))
        XCTAssertTrue(html.contains("reportSpeechLocator(lastSpeechCfi, false);"))
        XCTAssertTrue(html.contains("BookstrSpeech.relocationProgression"))
        XCTAssertTrue(html.contains("rangeToCfi(spokenRange) || elementBoundaryCfi(block.element, false)"))
        XCTAssertTrue(html.contains("if (!restore) reportLocation(rendition.currentLocation())"))
        XCTAssertTrue(html.contains("function spinePositionForCfi(cfi, fallbackIndex)"))
        XCTAssertTrue(html.contains("sectionCount: spine.sectionCount"))
        XCTAssertTrue(html.contains("box-shadow:inset 3px 0 0 #7fb8a7"))
        XCTAssertTrue(html.contains("::highlight(bookstr-speaking-word){background:rgba(47,93,80,.32)"))
        XCTAssertFalse(html.contains("::highlight(bookstr-speaking-word){background:#e7c766"))
    }

    func testReaderReportsWhetherARealTableOfContentsExists() throws {
        let html = try bundledReaderHTML()

        XCTAssertTrue(html.contains("collect(navigation && navigation.toc);"))
        XCTAssertTrue(html.contains("hasToc: labels.size > 0"))
    }

    func testEPUBReaderLoadsTypographySettingsIntoTheWebView() throws {
        let sourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/EPUBReaderView.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        XCTAssertTrue(source.contains("case \"/reader-typography.js\":"))
        XCTAssertTrue(source.contains("bundled(\"reader-typography\", extension: \"js\")"))
        XCTAssertTrue(source.contains("setReaderTypography(\\(font), \\(alignment))"))
        XCTAssertTrue(source.contains("window.setReaderTypography && window.setReaderTypography"))
        XCTAssertTrue(source.contains("window.requestSpeechText && window.requestSpeechText(true, \\(Self.js(requestID)), \\(Self.js(speechLocator)))"))
        XCTAssertTrue(source.contains("func speakFromLocator"))
        XCTAssertTrue(source.contains("buildMenu(with builder"))
        XCTAssertTrue(source.contains("writingToolsBehavior = .none"))
        XCTAssertTrue(source.contains("ReaderEditMenu.configure("))
        XCTAssertFalse(source.contains("UIMenuController.shared"))
        let editMenuURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/ReaderEditMenu.swift")
        let editMenu = try String(contentsOf: editMenuURL, encoding: .utf8)
        XCTAssertTrue(editMenu.contains("builder.remove(menu: .lookup)"))
        XCTAssertTrue(editMenu.contains("builder.remove(menu: .share)"))
        XCTAssertTrue(editMenu.contains("replaceChildren(ofMenu: .standardEdit)"))
        XCTAssertTrue(editMenu.contains("copyOnly(from: children) + extras"))
        XCTAssertTrue(editMenu.contains("title: \"Add Word\""))
        XCTAssertTrue(editMenu.contains("title: \"Mark\""))
        XCTAssertTrue(editMenu.contains("ReaderSelectionActions.readFromHereLabel"))
        XCTAssertTrue(editMenu.contains("copyOnly(from:"))
        XCTAssertTrue(editMenu.contains("menuItems(for:"))
        XCTAssertTrue(source.contains("bookstrCurrentTextSelection"))
        XCTAssertTrue(source.contains("withCurrentSelection"))
        XCTAssertTrue(source.contains("preferWeb: true"))
        XCTAssertTrue(source.contains("highlightCurrentSelectionInReader"))
        let html = try bundledReaderHTML()
        XCTAssertTrue(html.contains("window.bookstrCurrentTextSelection = function()"))
        XCTAssertTrue(html.contains("captureLiveTextSelection()"))
        XCTAssertTrue(html.contains("window.highlightCurrentSelection = function(kind)"))
        XCTAssertTrue(html.contains("window.__bookstrTextSelection = payload"))
        let hostURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/ReaderHostView.swift")
        let host = try String(contentsOf: hostURL, encoding: .utf8)
        XCTAssertTrue(host.contains("override func editMenu(for textRange"))
        XCTAssertTrue(host.contains("ReaderEditMenu.copyOnly(from: suggestedActions)"))
        XCTAssertTrue(host.contains("allowsSpeech: true"))
        let pdfURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/PDFReaderView.swift")
        let pdf = try String(contentsOf: pdfURL, encoding: .utf8)
        XCTAssertTrue(pdf.contains("buildMenu(with builder"))
        XCTAssertTrue(pdf.contains("allowsSpeech: false"))
        XCTAssertTrue(pdf.contains("highlightCurrentSelection"))
        XCTAssertTrue(source.contains("highlightReaderCfi"))
        XCTAssertTrue(source.contains("refreshKnownWordsInReader"))
        XCTAssertTrue(source.contains("applySavedHighlightsForBook"))
        XCTAssertTrue(source.contains("setReaderHighlights"))
        let wordsURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Words/WordsView.swift")
        let words = try String(contentsOf: wordsURL, encoding: .utf8)
        XCTAssertTrue(words.contains("WordSortKey"))
        XCTAssertTrue(words.contains("sortVocabularyWords"))
        XCTAssertTrue(words.contains("recordSeen(key:"))
        XCTAssertTrue(words.contains("Words you save while reading appear here."))
        XCTAssertTrue(words.contains("Passages you mark while reading appear here."))
        let sortURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Words/WordSortOrdering.swift")
        let sortSource = try String(contentsOf: sortURL, encoding: .utf8)
        XCTAssertTrue(sortSource.contains("case recentlyAdded"))
        XCTAssertTrue(sortSource.contains("\"Recently added\""))
        XCTAssertTrue(sortSource.contains("firstSeenAt > $1.firstSeenAt"))
        XCTAssertTrue(sortSource.contains("lastSeenAt > $1.lastSeenAt"))
        XCTAssertFalse(source.contains("item[\"progression\"] as? Double"))
        XCTAssertTrue(source.contains("ReaderRelocation.parse"))
        XCTAssertTrue(source.contains("willResignActiveNotification"))
        XCTAssertTrue(source.contains("persistCurrentLocator"))
        XCTAssertTrue(source.contains("controller.progression = item.progression"))
        XCTAssertTrue(source.contains("if item.source == \"speech\" { return }"))
        let rootURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/App/RootView.swift")
        let rootSource = try String(contentsOf: rootURL, encoding: .utf8)
        XCTAssertTrue(rootSource.contains("continuationLocator(for: book)"))
        XCTAssertTrue(rootSource.contains("progressRepository.get(bookId: book.id).cfi"))
        XCTAssertTrue(rootSource.contains("playback.item"))
        XCTAssertTrue(rootSource.contains("showsReaderChrome: playback.isVisible"))
        XCTAssertTrue(rootSource.contains("playback.requestClose()"))
        XCTAssertFalse(rootSource.contains("fullScreenCover(item: $continuation)"))
        XCTAssertTrue(source.contains("ReaderSpeechRetention.isRetained"))
        XCTAssertTrue(source.contains("refreshSpeechRetention()"))
        XCTAssertTrue(source.contains("neuralPaused: neuralSpeech.isPaused"))
        XCTAssertTrue(host.contains("reader-speech-toggle"))
        XCTAssertTrue(host.contains("showsReaderChrome"))
        XCTAssertTrue(host.contains("syncPlaybackSpeech()"))
        XCTAssertTrue(host.contains("epubController.isSpeechRetained"))
        XCTAssertTrue(host.contains("fb2Controller.isSpeechRetained"))
        XCTAssertTrue(host.contains("ReaderPlaybackSession.toggleSpeechNotification"))
        let libraryURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Library/LibraryView.swift")
        let library = try String(contentsOf: libraryURL, encoding: .utf8)
        XCTAssertTrue(library.contains("playback.present(book:"))
        XCTAssertFalse(library.contains("fullScreenCover(item: $selectedBook"))
        let searchURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Search/SearchView.swift")
        let search = try String(contentsOf: searchURL, encoding: .utf8)
        XCTAssertTrue(search.contains("playback.present(book: openedBook)"))
        XCTAssertFalse(search.contains("fullScreenCover(item: $openedBook)"))
        XCTAssertTrue(words.contains("highlightKind: highlightKind"))
        XCTAssertFalse(words.contains("navigationDestination(item: $destination)"))
        let chromeURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Shared/ScreenChrome.swift")
        let chrome = try String(contentsOf: chromeURL, encoding: .utf8)
        XCTAssertTrue(chrome.contains("app-speech-toggle"))
        XCTAssertTrue(chrome.contains("showsBackgroundSpeechControl"))
        XCTAssertTrue(source.contains("observeAudioSession()"))
        XCTAssertTrue(source.contains("AVAudioSession.interruptionNotification"))
        let sessionURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/NeuralSpeechSession.swift")
        let sessionSource = try String(contentsOf: sessionURL, encoding: .utf8)
        XCTAssertTrue(sessionSource.contains("setKeepAliveActive(true"))
        XCTAssertTrue(sessionSource.contains("keepAliveSilence"))
        XCTAssertTrue(sessionSource.contains("maxSpokenAhead"))
        let playbackURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Reader/NeuralSpeechPlayback.swift")
        let playbackSource = try String(contentsOf: playbackURL, encoding: .utf8)
        XCTAssertTrue(sessionSource.contains("NeuralSpeechProgress.highlightRange"))
        XCTAssertTrue(sessionSource.contains("tickNanoseconds"))
        XCTAssertTrue(sessionSource.contains("onProgress"))
        XCTAssertTrue(playbackSource.contains("beginBackgroundTask(withName: \"bookstr-neural-tts\""))
        XCTAssertTrue(playbackSource.contains("beginBackgroundTask(withName: \"bookstr-neural-playback\""))
        XCTAssertTrue(playbackSource.contains("keepAliveMixer"))
        XCTAssertTrue(sessionSource.contains("1e-4"))
        XCTAssertTrue(playbackSource.contains("options: .loops"))
        XCTAssertTrue(playbackSource.contains("NeuralSpeechBudget.onnxThreads"))
        XCTAssertTrue(playbackSource.contains("releaseSynthesizer()"))
        XCTAssertTrue(playbackSource.contains("synthesizer = nil"))
        XCTAssertTrue(playbackSource.contains("engineID = nil"))
        XCTAssertTrue(playbackSource.contains("autoreleasepool"))
        XCTAssertTrue(playbackSource.contains("generated.audio != nil"))
        XCTAssertTrue(playbackSource.contains("Array(generated.samples)"))
        XCTAssertTrue(playbackSource.contains("synthesisPhrases"))
        XCTAssertTrue(playbackSource.contains("withCString"))
        XCTAssertTrue(sessionSource.contains("NeuralSpeechInput.speakable"))
        XCTAssertTrue(sessionSource.contains("kokoroCharacterLimit"))
        XCTAssertTrue(sessionSource.contains("splitForKokoro"))
        XCTAssertTrue(sessionSource.contains("synth skip empty"))
        XCTAssertTrue(sessionSource.contains("func unload()"))
        XCTAssertTrue(sessionSource.contains("synthesizer.unload()"))
        XCTAssertTrue(playbackSource.contains("didEnterBackgroundNotification"))
        XCTAssertTrue(playbackSource.contains("qos=userInitiated"))
        XCTAssertTrue(sessionSource.contains("backgroundLookahead = 4"))
        XCTAssertTrue(sessionSource.contains("foregroundLookahead = 4"))
        XCTAssertTrue(sessionSource.contains("onnxThreads = 4"))
        XCTAssertTrue(sessionSource.contains(".userInitiated"))
    }

    func testSettingsExposesSpeechLogsAndStableRelayIdentifiers() throws {
        let settingsURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Settings/SettingsView.swift")
        let settings = try String(contentsOf: settingsURL, encoding: .utf8)
        XCTAssertTrue(settings.contains("accessibilityIdentifier(\"speech-debug-logs\")"))
        XCTAssertTrue(settings.contains("accessibilityIdentifier(\"settings-relays-editor\")"))
        XCTAssertTrue(settings.contains("accessibilityIdentifier(\"settings-save-relays\")"))
        XCTAssertTrue(settings.contains("SpeechDebugLogView()"))
        let relaysIndex = try XCTUnwrap(settings.range(of: "settings-relays-editor")?.lowerBound)
        let logsIndex = try XCTUnwrap(settings.range(of: "speech-debug-logs")?.lowerBound)
        XCTAssertLessThan(relaysIndex, logsIndex, "speech logs must sit below the relays editor")
        let logViewURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/Features/Settings/SpeechDebugLogView.swift")
        let logView = try String(contentsOf: logViewURL, encoding: .utf8)
        XCTAssertTrue(logView.contains("BookstrDebugLog.shared.exportText"))
        XCTAssertTrue(logView.contains("scrollTo(\"log-bottom\""))
        let uiTestURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("UITests/AppShellUITests.swift")
        let uiTest = try String(contentsOf: uiTestURL, encoding: .utf8)
        XCTAssertTrue(uiTest.contains("systemDefaultChoice.tap()"))
        XCTAssertTrue(uiTest.contains("Settings did not return from the English voice picker"))
    }

    func testBundledVendorAssetsMatchCanonicalSourcesAndLockedHashes() throws {
        let expectedHashes = [
            ("epub.min", "js", "06eae15745107b4aa508c95538275251f69bfb9f1175621fc458d9f42ed082d4"),
            ("jszip.min", "js", "acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e"),
        ]

        for (name, fileExtension, expectedHash) in expectedHashes {
            let bundled = try bundledAssetData(named: name, extension: fileExtension)
            let canonical = try Data(contentsOf: canonicalAssetURL(named: name, extension: fileExtension))
            XCTAssertEqual(bundled, canonical, "Bundled \(name).\(fileExtension) differs from shared/reader")
            XCTAssertEqual(sha256(bundled), expectedHash)
        }
    }

    private func bundledReaderHTML() throws -> String {
        try bundledAsset(named: "reader", extension: "html")
    }

    private func bundledAsset(named name: String, extension fileExtension: String) throws -> String {
        let data = try bundledAssetData(named: name, extension: fileExtension)
        return try XCTUnwrap(String(data: data, encoding: .utf8))
    }

    private func bundledAssetData(named name: String, extension fileExtension: String) throws -> Data {
#if SWIFT_PACKAGE
        let url = canonicalAssetURL(named: name, extension: fileExtension)
#else
        let url = try XCTUnwrap(
            Bundle.main.url(forResource: name, withExtension: fileExtension),
            "Missing bundled reader asset: \(name).\(fileExtension)"
        )
#endif
        return try Data(contentsOf: url)
    }

    private func canonicalAssetURL(named name: String, extension fileExtension: String) -> URL {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        if fileExtension == "js" && (name == "reader-speech" || name == "reader-typography") {
            return root.appendingPathComponent("web").appendingPathComponent("\(name).\(fileExtension)")
        }
        return root
            .appendingPathComponent("shared/reader")
            .appendingPathComponent("\(name).\(fileExtension)")
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
