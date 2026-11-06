interface ReaderMetadata { title?: unknown; creator?: unknown; author?: unknown; language?: unknown; rights?: unknown; [key: string]: unknown }
interface ReaderSection { idref?: string; href?: string; index?: number; load(bookLoad: (href: string) => Promise<Document>): Promise<Document>; unload?(): void }
interface ReaderContents { document?: Document; window?: Window; section?: ReaderSection; [key: string]: unknown }
interface ReaderLocation { start?: { cfi?: string; percentage?: number; index?: number }; end?: { cfi?: string; percentage?: number }; atStart?: boolean; atEnd?: boolean; [key: string]: unknown }
interface ReaderBook {
  ready: Promise<unknown>; packaging?: { metadata?: ReaderMetadata };
  spine: { spineItems: ReaderSection[]; items?: ReaderSection[] };
  load(href: string): Promise<Document>; destroy(): void;
  renderTo(target: string, options: Record<string, unknown>): ReaderRendition;
  locations: { generate(count: number): Promise<unknown>; length(): number; percentageFromCfi(cfi: string): number };
}
interface ReaderRendition {
  themes: { fontSize(size: string): void; select(theme: string): void; register(name: string, rules: Record<string, string | Record<string, string>>): void };
  hooks: { content: { register(callback: (contents: ReaderContents) => void): void } };
  annotations: { highlight(cfi: string, data?: unknown, callback?: (() => void) | null, className?: string, styles?: Record<string, string>): void; remove(cfi: string, type?: string): void };
  getContents(): ReaderContents[]; currentLocation(): ReaderLocation | null;
  display(cfi?: string): Promise<unknown>; destroy(): void; next(): Promise<unknown>; prev(): Promise<unknown>;
  on(event: 'rendered', callback: (section: ReaderSection, view: { element?: Element; contents?: ReaderContents }) => void): void;
  on(event: 'selected', callback: (cfi: string, contents: ReaderContents) => void): void;
  on(event: 'relocated', callback: (location: ReaderLocation) => void): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
}
interface DesktopBookMetadata {
  md5: string; readUrl: string; progression?: number; furthestProgression?: number; cfi?: string;
  title: string; authors: string; year: string; extension: string; source: string; sourceNativeId: string;
  sourceUrl: string; blossomUrl: string; blossomSha256: string; rights_status: string; license: string;
  license_url: string; rights_source: string; language?: string;
}
interface ActiveDictionary { word: string; language: string }
type ReaderSpeechPlan = import('./reader-speech.js').SpeechPlan & { language?: string };

interface ReaderTypographyApi {
  normalizeFont(value: unknown): string;
  normalizeAlignment(value: unknown): string;
  normalizePadding(value: unknown): number;
  css(font: string, alignment: string, padding: number): string;
}
interface ReaderChromeApi {
  themeBackgroundColor(theme: string): string;
  paintShell(nodes: Element[], theme: string): void;
  prepareContentDocument(document: Document | undefined, theme: string): void;
}
interface ReaderNativeBridge {
  onMetadata?(payload: string): void;
  onReaderStage?(stage: string): void;
  onReaderReady?(): void;
  onRelocated?(payload: string): void;
  onReaderError?(message: string): void;
  onSpeechText?(payload: string): void;
  onSpeechProgress?(start: string, end: string): void;
  onTextSelected?(payload: string): void;
  onSections?(payload: string): void;
  onDictionaryResult?(payload: string): void;
  onLookupDictionary?(payload: string): void;
  onWordSelected?(payload: string): void;
  onSearchResults?(payload: string): void;
  onSavedHighlightTapped?(payload: string): void;
  onReaderInteracted?(): void;
  onProgress?(payload: string): void;
  onSpeechPlan?(payload: string): void;
  onSearchResult?(payload: string): void;
  onLongPress?(payload: string): void;
  onReaderLongPress?(payload: string): void;
  onKnownWordTapped?(payload: string): void;
}
declare global {
  interface Window {
    BookstrTypography: ReaderTypographyApi;
    BookstrReaderChrome: ReaderChromeApi;
    AndroidBridge?: ReaderNativeBridge;
    readerFontPercent?: number;
  }
  interface HTMLElement { __bookstrShellWatch?: boolean; __bookstrSwipeInstalled?: boolean }
  interface Document { __bookstrSelectionBridge?: boolean; __bookstrKnownWordNavigation?: boolean; __bookstrImageZoomInstalled?: boolean; __bookstrContextMenuInstalled?: boolean; __bookstrSwipeInstalled?: boolean }
}
declare const AndroidBridge: ReaderNativeBridge;
declare const nextPage: typeof window.nextPage;
declare const prevPage: typeof window.prevPage;

  const desktopBridge = (window.bookstrDesktop || window.parent?.bookstrDesktop || null) as
    (NonNullable<Window['bookstrDesktop']> & { focusLibrary?(): void; openPane?(pane?: string): void }) | null;
    if (desktopBridge) document.body.classList.add("desktop-reader");
    let book: ReaderBook | null = null;
    let rendition: ReaderRendition | null = null;
    let currentBookId = "";
    let currentReaderTheme = "paper";
    let lastSpeechCfi = "";
    let activeDictionary: ActiveDictionary | null = null;
    let bookLoadGeneration = 0;
    let discoveredRightsNotice = "";
    const READER_SETTINGS_KEY = "bookstr_reader_settings_v1";
    function storedReaderSettings() {
      try {
        const parsed = JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (_) {
        return {};
      }
    }
    let currentReaderSettings = storedReaderSettings();
    let readerFontPercent = Number(currentReaderSettings.readerFontPercent)
      || Number(localStorage.getItem("bookstr-reader-font-percent"))
      || 100;
    let readerFontFamily = window.BookstrTypography.normalizeFont(
      currentReaderSettings.readerFont || currentReaderSettings.readerFontFamily,
    );
    let readerAlignment = window.BookstrTypography.normalizeAlignment(
      currentReaderSettings.readerAlignment
        || (currentReaderSettings.readerTextAlign === "justify" ? "justified" : currentReaderSettings.readerTextAlign),
    );
    let readerPadding = window.BookstrTypography.normalizePadding(currentReaderSettings.readerPadding);
    let desktopReaderBook: DesktopBookMetadata | null = null;
    let desktopReaderFurthestProgress = 0;
    let desktopReaderProgress: DesktopBookMetadata | null = null;
    const readerSpeechControls = (document.getElementById("reader-speech-controls") as HTMLElement);
    const readerSpeechPlayButton = (document.getElementById("reader-speech-play") as HTMLButtonElement);
    const readerSpeechPauseButton = (document.getElementById("reader-speech-pause") as HTMLButtonElement);
    const readerSpeechStopButton = (document.getElementById("reader-speech-stop") as HTMLButtonElement);
    const readerHeaderTitle = (document.getElementById("reader-header-title") as HTMLElement);
    const readerHeaderByline = (document.getElementById("reader-header-byline") as HTMLElement);
    const readerHeaderRights = (document.getElementById("reader-header-rights") as HTMLElement);
    let readerSpeechState = "stopped";
    let readerSpeechPlayer: import('./reader-speech.js').SpeechPlayer | null = null;

    function selectedSpeechVoice(language: string) {
      const languageCode = String(language || "").replace("_", "-").toLowerCase().split("-")[0]!;
      return String(currentReaderSettings.speechVoices?.[languageCode]
        || (languageCode === "pt" ? currentReaderSettings.speechVoicePortuguese : "")
        || (languageCode === "en" ? currentReaderSettings.speechVoiceEnglish : ""));
    }

    function applyReaderSettings(settings = storedReaderSettings()) {
      currentReaderSettings = settings && typeof settings === "object" ? { ...settings } : {};
      const nextPercent = Number(currentReaderSettings.readerFontPercent);
      if (Number.isFinite(nextPercent)) readerFontPercent = Math.max(75, Math.min(180, nextPercent));
      readerFontFamily = window.BookstrTypography.normalizeFont(
        currentReaderSettings.readerFont || currentReaderSettings.readerFontFamily,
      );
      readerAlignment = window.BookstrTypography.normalizeAlignment(
        currentReaderSettings.readerAlignment
          || (currentReaderSettings.readerTextAlign === "justify" ? "justified" : currentReaderSettings.readerTextAlign),
      );
      readerPadding = window.BookstrTypography.normalizePadding(currentReaderSettings.readerPadding);
      if (rendition) {
        rendition!.themes.fontSize(readerFontPercent + "%");
        applyTypography();
      }
      if (readerSpeechState !== "stopped") stopReaderSpeech();
    }
    window.applyReaderSettings = applyReaderSettings;

    (document.getElementById("reader-back") as HTMLElement).addEventListener("click", () => {
      desktopBridge?.focusLibrary?.();
    });
    const readerMenuToggle = (document.getElementById("reader-menu-toggle") as HTMLElement);
    const readerMenu = (document.getElementById("reader-menu") as HTMLElement);
    readerMenuToggle.addEventListener("click", () => {
      const open = readerMenu.hidden;
      readerMenu.hidden = !open;
      readerMenuToggle.setAttribute("aria-expanded", String(open));
    });
    readerMenu.querySelectorAll<HTMLButtonElement>("[data-reader-pane]").forEach(button => {
      button.addEventListener("click", () => desktopBridge?.openPane?.(button.dataset.readerPane));
    });

    function updateReaderHeader(metadata: Record<string, unknown> | DesktopBookMetadata | null | undefined) {
      const details = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
      const title = String(details.title || details.name || "Book");
      const byline = [details.authors || details.author || "", details.year || ""].filter(Boolean).join(" · ");
      const rights = String(details.license || details.rights || "");
      readerHeaderTitle.textContent = title;
      readerHeaderTitle.title = title;
      readerHeaderByline.textContent = byline;
      readerHeaderRights.textContent = rights;
      readerHeaderRights.title = rights;
    }

    function metadataText(value: unknown): string {
      if (Array.isArray(value)) return value.map(metadataText).filter(Boolean).join(", ");
      if (value && typeof value === "object") {
        const objectValue = value as Record<string, unknown>;
        return metadataText(objectValue.name || objectValue.value || objectValue.label);
      }
      return String(value || "").trim();
    }

    function reportBookMetadata(rightsOverride = "", rightsSource = "") {
      const metadata = book && book!.packaging && book!.packaging.metadata;
      if (!metadata) return;
      const payload = {
        type: "bookstr-reader-metadata",
        bookId: currentBookId,
        title: metadataText(metadata.title),
        author: metadataText(metadata.creator || metadata.author),
        rights: rightsOverride || metadataText(metadata.rights),
        rights_source: rightsSource || (metadataText(metadata.rights) ? "epub_opf" : "")
      };
      if (window.parent !== window) window.parent.postMessage(payload, window.location.origin);
      if (window.AndroidBridge && AndroidBridge.onMetadata) {
        AndroidBridge.onMetadata!(JSON.stringify(payload));
      }
    }

    function creativeCommonsNotice(value: unknown): string {
      const text = String(value || "");
      const url = text.match(/https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/[a-z-]+|publicdomain\/zero)\/\d(?:\.\d)?\/?/i);
      if (url) return url[0];
      const phrase = text.match(/creative\s*commons.{0,80}?(attribution|noncommercial|sharealike|no derivatives).{0,80}?(\d(?:\.\d)?)/i);
      return phrase ? phrase[0] : "";
    }

    function reportDiscoveredRights(notice: string, generation = bookLoadGeneration) {
      if (!notice || notice === discoveredRightsNotice || generation !== bookLoadGeneration) return;
      discoveredRightsNotice = notice;
      if (desktopReaderBook) Object.assign(desktopReaderBook, {
        rights_status: "unknown",
        license: notice,
        license_url: "",
        rights_source: "epub_content"
      });
      reportBookMetadata(notice, "epub_content");
    }

    async function discoverSpineRights() {
      const sections = Array.from(book?.spine?.spineItems || []);
      if (!sections.length) return "";
      const named = sections.filter(section => /(?:copy(?:right)?|rights?|licen[cs]e|legal|colophon)/i.test(`${section?.idref || ""} ${section?.href || ""}`));
      const candidates = [...new Set([...named, ...sections.slice(0, 3), ...sections.slice(-3)])].slice(0, 8);
      for (const section of candidates) {
        try {
          const document = await section.load(book!.load.bind(book));
          const links = Array.from(document?.querySelectorAll?.("a[href]") || [], link => link.getAttribute("href") || "").join(" ");
          const notice = creativeCommonsNotice(`${links} ${document?.documentElement?.textContent || ""}`);
          section.unload!();
          if (notice) return notice;
        } catch {
          section.unload!();
        }
      }
      return "";
    }

    function normalizeDesktopBookMetadata(payloadBook: unknown, readUrl = ""): DesktopBookMetadata {
      const bookPayload = payloadBook && typeof payloadBook === "object" ? payloadBook as Record<string, unknown> : {};
      return {
        md5: String(bookPayload.md5 || "").trim().toLowerCase(),
        title: String(bookPayload.title || bookPayload.name || "Book"),
        authors: String(bookPayload.authors || bookPayload.author || ""),
        year: String(bookPayload.year || ""),
        language: String(bookPayload.language || ""),
        extension: String(bookPayload.extension || bookPayload.format || "epub").toLowerCase(),
        readUrl: String(readUrl || bookPayload.readUrl || bookPayload.url || ""),
        source: String(bookPayload.source || ""),
        sourceNativeId: String(bookPayload.sourceNativeId || bookPayload.source_native_id || ""),
        sourceUrl: String(bookPayload.sourceUrl || ""),
        blossomUrl: String(bookPayload.blossomUrl || ""),
        blossomSha256: String(bookPayload.blossomSha256 || ""),
		rights_status: String(bookPayload.rights_status || bookPayload.rightsStatus || "unknown"),
		license: String(bookPayload.license || bookPayload.rights || ""),
		license_url: String(bookPayload.license_url || bookPayload.licenseUrl || ""),
		rights_source: String(bookPayload.rights_source || bookPayload.rightsSource || ""),
      };
    }

    function clampProgress(value: unknown): number {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return 0;
      return Math.max(0, Math.min(1, numericValue));
    }

    function normalizeDesktopReaderPayload(payload: unknown) {
      if (!payload || typeof payload !== "object") return null;
      const record = payload as Record<string, unknown>;
      const base64 = String(record.base64 || "").trim();
      if (!base64) return null;
      return {
        base64,
        theme: String(record.theme || "paper").toLowerCase(),
        font: String(record.font || "arial").toLowerCase(),
        alignment: String(record.alignment || "justified").toLowerCase(),
        padding: window.BookstrTypography.normalizePadding(record.padding ?? currentReaderSettings.readerPadding),
        cfi: String(record.cfi || ""),
        readUrl: String(record.readUrl || ""),
        book: normalizeDesktopBookMetadata(record.book, String(record.readUrl || "")),
      };
    }

    function reportDesktopProgress(cfi: string, progression: number, furthestProgression: number) {
      const bookId = String(desktopReaderBook?.md5 || currentBookId || "").trim().toLowerCase();
      if (!bookId) return;
      const normalizedProgress = clampProgress(progression);
      const safeFurthest = Number.isFinite(Number(furthestProgression)) ? clampProgress(Number(furthestProgression)) : normalizedProgress;
      const payload = {
        type: "bookstr-reader-progress",
        bookId,
        md5: bookId,
        readUrl: String(desktopReaderBook?.readUrl || ""),
        progression: normalizedProgress,
        furthestProgression: Math.max(clampProgress(safeFurthest), desktopReaderFurthestProgress),
        cfi: String(cfi || ""),
        title: String(desktopReaderBook?.title || ""),
        authors: String(desktopReaderBook?.authors || ""),
        year: String(desktopReaderBook?.year || ""),
        extension: String(desktopReaderBook?.extension || "epub"),
        language: String(desktopReaderBook?.language || ""),
        source: String(desktopReaderBook?.source || ""),
        sourceNativeId: String(desktopReaderBook?.sourceNativeId || ""),
        sourceUrl: String(desktopReaderBook?.sourceUrl || ""),
        blossomUrl: String(desktopReaderBook?.blossomUrl || ""),
        blossomSha256: String(desktopReaderBook?.blossomSha256 || ""),
		rights_status: String(desktopReaderBook?.rights_status || "unknown"),
		license: String(desktopReaderBook?.license || ""),
		license_url: String(desktopReaderBook?.license_url || ""),
		rights_source: String(desktopReaderBook?.rights_source || ""),
      };
      payload.furthestProgression = Math.max(payload.furthestProgression, desktopReaderFurthestProgress);
      desktopReaderFurthestProgress = payload.furthestProgression;
      desktopReaderProgress = payload;
      if (window.parent !== window) {
        window.parent.postMessage(payload, window.location.origin);
      } else if (desktopBridge?.reportProgress) {
        desktopBridge.reportProgress(payload);
      }
    }

    function base64ToArrayBuffer(base64: string): ArrayBuffer {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }

    function applyTheme(theme: string) {
      currentReaderTheme = theme === "night" ? "night" : (theme === "white" ? "white" : "paper");
      const desktop = document.body.classList.contains("desktop-reader");
      document.body.className = theme === "night" ? "night" : (theme === "white" ? "white" : "");
      if (desktop) document.body.classList.add("desktop-reader");
      if (rendition) {
        rendition!.themes.select(theme === "night" ? "night" : (theme === "white" ? "white" : "paper"));
        rendition!.getContents().forEach(function(contents) {
          isolateAuthorBackgrounds(contents && contents.document);
        });
      }
      applyTypography();
      applyContinuousShellBackground();
    }

    function themeBackgroundColor(theme: string) {
      return window.BookstrReaderChrome.themeBackgroundColor(theme);
    }
    void themeBackgroundColor;

    function applyContinuousShellBackground() {
      const nodes = [document.documentElement, document.body, (document.getElementById("viewer") as HTMLElement)]
        .concat(Array.from(document.querySelectorAll(".epub-container, .epub-view, .epub-view iframe")));
      window.BookstrReaderChrome.paintShell(nodes.filter(Boolean), currentReaderTheme);
    }

    function installContinuousShellWatch() {
      const viewer = (document.getElementById("viewer") as HTMLElement);
      if (!viewer || viewer.__bookstrShellWatch) return;
      viewer.__bookstrShellWatch = true;
      const observer = new MutationObserver(function() {
        applyContinuousShellBackground();
      });
      observer.observe(viewer, { childList: true, subtree: true });
      applyContinuousShellBackground();
    }

    // Author figure wrappers often paint white across the rest of a section.
    function isolateAuthorBackgrounds(contentDocument: Document | undefined) {
      window.BookstrReaderChrome.prepareContentDocument(contentDocument, currentReaderTheme);
    }

    function typographyCSS() {
      return window.BookstrTypography.css(readerFontFamily, readerAlignment, readerPadding);
    }

    function applyTypographyToDocument(contentDocument: Document | undefined) {
      if (!contentDocument) return;
      let style = contentDocument.getElementById("bookstr-typography");
      if (!style) {
        style = contentDocument.createElement("style");
        style.id = "bookstr-typography";
        (contentDocument.head || contentDocument.documentElement).appendChild(style);
      }
      style.textContent = typographyCSS();
    }

    function applyTypography() {
      if (!rendition || typeof rendition!.getContents !== "function") return;
      rendition!.getContents().forEach(function(contents) {
        applyTypographyToDocument(contents && contents.document);
      });
    }

    function registerThemes() {
      const shared = {
        "font-family": "Arial, Helvetica, sans-serif !important",
        "font-size": "1.04em !important",
        "line-height": "1.6 !important",
        "box-sizing": "border-box",
        "width": "100% !important",
        "max-width": "none !important",
        "margin-left": "0 !important",
        "margin-right": "0 !important",
        "padding-left": "0.12rem !important",
        "padding-right": "0.12rem !important"
      };
      const media = {
        "max-width": "100% !important",
        "max-height": "88vh !important",
        "width": "auto !important",
        "height": "auto !important",
        "object-fit": "contain !important",
        "display": "block",
        "margin-left": "auto !important",
        "margin-right": "auto !important"
      };
      const coverPage = {
        "width": "100% !important",
        "height": "100% !important",
        "max-width": "none !important",
        "max-height": "none !important",
        "margin": "0 !important",
        "padding": "0 !important",
        "overflow": "hidden !important"
      };
      const coverMedia = {
        "display": "block !important",
        "width": "100% !important",
        "height": "100% !important",
        "max-width": "none !important",
        "max-height": "none !important",
        "margin": "0 !important",
        "object-fit": "contain !important"
      };
      const coverRules = {
        "html.bookstr-cover, html.bookstr-cover body": coverPage,
        "html.bookstr-cover body > *": coverPage,
        "html.bookstr-cover img, html.bookstr-cover svg": coverMedia
      };
      const contentReset = {
        "background-color": "transparent !important",
        "background-image": "none !important"
      };
      const contentBlocks =
        "p, div, span, li, blockquote, td, th, h1, h2, h3, h4, h5, h6, section, article, aside, header, footer, main, nav, figure, figcaption, table, tr, thead, tbody, tfoot";
      rendition!.themes.register("white", {
        "html, body": { background: "#ffffff !important", color: "#1c1916 !important" },
        body: Object.assign({}, shared, { background: "#ffffff !important", color: "#1c1916 !important" }),
        [contentBlocks]: contentReset,
        a: { color: "#2f5d50 !important", "text-decoration-color": "#7fb8a7 !important" },
        "a:visited": { color: "#634779 !important" },
        "img, svg, video": media,
        ...coverRules
      });
      rendition!.themes.register("paper", {
        "html, body": { background: "#f7f3ea !important", color: "#1c1916 !important" },
        body: Object.assign({}, shared, { background: "#f7f3ea !important", color: "#1c1916 !important" }),
        [contentBlocks]: contentReset,
        a: { color: "#2f5d50 !important", "text-decoration-color": "#7fb8a7 !important" },
        "a:visited": { color: "#6c4c70 !important" },
        "img, svg, video": media,
        ...coverRules
      });
      rendition!.themes.register("night", {
        "html, body": { background: "#121212 !important", color: "#e8e4dc !important" },
        body: Object.assign({}, shared, { background: "#121212 !important", color: "#e8e4dc !important" }),
        [contentBlocks]: Object.assign({}, contentReset, { color: "#e8e4dc !important" }),
        a: { color: "#7fb8a7 !important", "text-decoration-color": "#4f786c !important" },
        "a:visited": { color: "#d0a8e8 !important" },
        "img, svg, video": media,
        ...coverRules
      });
    }

    function identifyCoverPage(contents: ReaderContents) {
      const document = contents && contents.document;
      if (!document || !document.documentElement || !document.body) return;
      const explicitCover = document.querySelector(
        '[epub\\:type~="cover"], [role~="doc-cover"], .cover, [id*="cover" i], img[src*="cover" i], img[alt*="cover" i]'
      );
      const images = document.querySelectorAll("img, svg");
      const sparseImagePage = images.length === 1 && document.body.textContent.trim().length < 80;
      if (explicitCover || sparseImagePage) document.documentElement.classList.add("bookstr-cover");
      const scrollbarStyle = document.createElement("style");
      scrollbarStyle.textContent = "html, body { scrollbar-width: none !important; } html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }";
      document.head.appendChild(scrollbarStyle);
    }

    function installWheelNavigation(target: Document) {
      target.addEventListener("wheel", function(event) {
        document.querySelector<HTMLElement>(".epub-container")!.scrollBy({ top: event.deltaY });
        event.preventDefault();
      }, { passive: false });
    }

    function openBook(source: string | ArrayBuffer, cfi: string, theme: string, highlightCfi: string | null, bookId: string, desktopPayloadBook: unknown = null) {
      const generation = ++bookLoadGeneration;
      discoveredRightsNotice = "";
      desktopReaderBook = desktopPayloadBook && typeof desktopPayloadBook === "object" ? normalizeDesktopBookMetadata(desktopPayloadBook) : null;
      desktopReaderFurthestProgress = 0;
      desktopReaderProgress = null;
      stopReaderSpeech();
      currentBookId = String(bookId || "");
      lastSpeechCfi = String(cfi || "").trim();
      document.body.dataset.bookId = currentBookId;
      applyTheme(theme || "paper");
      if (rendition) rendition!.destroy();
      if (book) book!.destroy();
      rendition = null;
      book = null;
      (document.getElementById("viewer") as HTMLElement).replaceChildren();
      document.body.removeAttribute("data-location");
      updateReaderProgress(0);
      let nextBook;
      try {
        nextBook = ePub(source) as unknown as ReaderBook;
      } catch (error) {
        return Promise.reject(error);
      }
      return nextBook.ready.then(function() {
        if (generation !== bookLoadGeneration) {
          nextBook.destroy();
          return Promise.reject(new DOMException("A newer book was opened.", "AbortError"));
        }
        book = nextBook;
        reportBookMetadata();
        const embeddedRights = String(book!.packaging?.metadata?.rights || "").trim();
        if (embeddedRights) {
          if (desktopReaderBook) Object.assign(desktopReaderBook, {
              rights_status: "unknown",
              license: embeddedRights,
              license_url: "",
              rights_source: "epub_opf"
            });
        } else {
          void discoverSpineRights().then(discoveredRights => {
            reportDiscoveredRights(discoveredRights, generation);
          });
        }
        rendition = nextBook.renderTo("viewer", {
          width: "100%",
          height: "100%",
          spread: "none",
          manager: "continuous",
          flow: "scrolled-doc"
        });
        installContinuousShellWatch();
        if (rendition!.hooks && rendition!.hooks.content && typeof rendition!.hooks.content.register === "function") {
          rendition!.hooks.content.register(function(contents) {
            isolateAuthorBackgrounds(contents && contents.document);
            applyTypographyToDocument(contents && contents.document);
            applyContinuousShellBackground();
          });
        }
        rendition!.hooks.content.register(identifyCoverPage);
        rendition!.on("rendered", function(_, view) {
          const contentDocument = view && view.contents && view.contents.document;
          if (contentDocument) {
            if (!embeddedRights) {
              const links = Array.from(contentDocument.querySelectorAll("a[href]"), link => link.getAttribute("href") || "").join(" ");
              reportDiscoveredRights(creativeCommonsNotice(`${links} ${contentDocument.documentElement?.textContent || ""}`), generation);
            }
            isolateAuthorBackgrounds(contentDocument);
            installSwipeNavigation(contentDocument);
            installWheelNavigation(contentDocument);
            applyTypographyToDocument(contentDocument);
          }
          applyContinuousShellBackground();
        });
        rendition!.on("selected", function(cfi, contents) {
          const selectedRange = contents && contents.window && contents.window.getSelection();
          const selection = selectedRange ? selectedRange.toString() : "";
          const language = ((contents && contents.document && contents.document.documentElement.lang) ||
            (book!.packaging && book!.packaging.metadata && book!.packaging.metadata.language) || "en") as string;
          keepHighlight(cfi);
          showDictionary(selection, language, cfi, selectionContext(selectedRange));
        });
        registerThemes();
        applyTheme(theme || "paper");
        rendition!.themes.fontSize(readerFontPercent + "%");
        rendition!.on("relocated", function(location) {
          reportLocation(location);
        });
        return rendition!.display(cfi || undefined);
      }).then(function() {
        if (generation !== bookLoadGeneration) return;
        restoredHighlights(highlightCfi).forEach(applyHighlight);
        if (window.AndroidBridge) AndroidBridge.onReaderReady!();
        reportLocation(rendition!.currentLocation());
        book!.locations.generate(100).then(function() {
          reportLocation(rendition!.currentLocation());
        }).catch(function(error) {
          console.warn("Could not generate EPUB locations", error);
        });
      });
    }

    function reportLocation(location: ReaderLocation | null) {
      if (!location) return;
      const start = location && location.start;
      if (!start || !start.cfi) return;
      document.body.dataset.location = start.cfi;
      let progression = Number.isFinite(start.percentage) ? start.percentage as number : 0;
      try {
        const generated = book && book!.locations && book!.locations.length() > 0;
        if (generated) progression = book!.locations.percentageFromCfi(start.cfi);
      } catch (error) {
        console.warn("Could not calculate EPUB progress", error);
      }
      if (!Number.isFinite(progression)) progression = 0;
      lastSpeechCfi = start.cfi;
      updateReaderProgress(progression);
      reportDesktopProgress(start.cfi, progression, progression);
      if (!window.AndroidBridge) return;
      AndroidBridge.onRelocated!(JSON.stringify({
        cfi: start.cfi,
        progression: Math.max(0, Math.min(1, progression))
      }));
    }

    function updateReaderProgress(progression: number) {
      const normalized = Math.max(0, Math.min(1, Number(progression) || 0));
      const percent = Math.floor(normalized * 100);
      (document.getElementById("reader-progress-value") as HTMLElement).style.width = (normalized * 100) + "%";
      (document.getElementById("reader-progress-track") as HTMLElement).setAttribute("aria-valuenow", String(percent));
      (document.getElementById("reader-progress-text") as HTMLElement).textContent = percent + "% read";
    }

    function reportReaderError(error: unknown) {
      const errorMessage = error as { message?: unknown } | null;
      const message = errorMessage && errorMessage.message ? errorMessage.message : String(error || "Unknown reader error");
      if (window.AndroidBridge) AndroidBridge.onReaderError!(message as string);
    }

    function setReaderSpeechState(state: string) {
      readerSpeechState = state;
      if (!readerSpeechControls) return;
      readerSpeechPlayButton.disabled = state === "playing";
      readerSpeechPauseButton.disabled = state === "stopped";
      readerSpeechStopButton.disabled = state === "stopped";
      readerSpeechPlayButton.setAttribute("aria-label", state === "stopped" ? "Start reading" : "Reading");
      readerSpeechPauseButton.textContent = state === "paused" ? "▶" : "▮▮";
      if (state === "paused") {
        readerSpeechPauseButton.setAttribute("aria-label", "Resume reading");
      } else {
        readerSpeechPauseButton.setAttribute("aria-label", "Pause reading");
      }
    }

    function hasSpeechSupport() {
      return Boolean(
        desktopBridge &&
        window.BookstrSpeech &&
        typeof window.speechSynthesis === "object" &&
        typeof window.SpeechSynthesisUtterance === "function"
      );
    }

    function collectReaderSpeechPlan(): ReaderSpeechPlan {
      if (!rendition || typeof rendition!.getContents !== "function" || !window.BookstrSpeech) {
        return { text: "", chunks: [], language: "en" };
      }
      const speechFeatures = window.BookstrSpeech as Partial<import('./reader-speech.js').SpeechApi>;
      const paragraphs = [];
      let language = "";
      let resumeCfi = String(lastSpeechCfi || "").trim();
      const contentViews = rendition!.getContents();

      function collectFromViews(activeResumeCfi: string) {
        const collected = [];
        let found = false;
        for (const view of contentViews) {
          const contentDocument = view && view.document;
          if (!contentDocument) continue;
          const location = rendition!.currentLocation && rendition!.currentLocation();
          const earlySection = !location || !location.start || location.start.index! <= 4;
          if (window.BookstrSpeech!.isOpeningNavigationDocument(contentDocument, earlySection)) continue;
          if (!language) language = String(contentDocument.documentElement.lang || "").trim();
          const frame = contentDocument.defaultView && contentDocument.defaultView.frameElement;
          const frameTop = frame && frame.getBoundingClientRect ? frame.getBoundingClientRect().top : 0;
          let elements = speechFeatures.speakableBlocks
            ? window.BookstrSpeech!.speakableBlocks(contentDocument)
            : Array.from(contentDocument.querySelectorAll(
              "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, dt, dd"
            ));
          for (const element of elements) {
            let text = String(
              speechFeatures.visibleText
                ? window.BookstrSpeech!.visibleText(element)
                : ((element as HTMLElement).innerText || element.textContent || "")
            )
              .replace(/\s+/g, " ")
              .trim();
            if (!text) continue;
            if (activeResumeCfi && typeof view.cfiFromRange === "function" && speechFeatures.locatorSkipDecision) {
              const startRange = contentDocument.createRange();
              const endRange = contentDocument.createRange();
              startRange.selectNodeContents(element);
              startRange.collapse(true);
              endRange.selectNodeContents(element);
              endRange.collapse(false);
              let startCfi = "";
              let endCfi = "";
              try { startCfi = String(view.cfiFromRange(startRange) || ""); } catch (_) {}
              try { endCfi = String(view.cfiFromRange(endRange) || ""); } catch (_) {}
              const decision = window.BookstrSpeech!.locatorSkipDecision(startCfi, endCfi, activeResumeCfi);
              if (decision === "skip") continue;
              if (decision === "resume" && typeof view.range === "function") {
                try {
                  const point = view.range(activeResumeCfi);
                  if (point && element.contains(point.startContainer)) {
                    const walker = contentDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                    let remaining = "";
                    let seen = false;
                    let node;
                    while ((node = walker.nextNode())) {
                      if (!seen) {
                        if (node !== point.startContainer) continue;
                        seen = true;
                        remaining += String(node.nodeValue || "").slice(point.startOffset);
                        continue;
                      }
                      remaining += String(node.nodeValue || "");
                    }
                    text = remaining.replace(/\s+/g, " ").trim();
                    if (!text) continue;
                  }
                } catch (_) {}
              }
            } else {
              const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { bottom: 1 };
              if (!found && frameTop + rect.bottom <= 0) continue;
            }
            found = true;
            collected.push(text);
          }
        }
        return collected;
      }

      let collectedParagraphs = collectFromViews(resumeCfi);
      if (!collectedParagraphs.length && resumeCfi) {
        lastSpeechCfi = "";
        resumeCfi = "";
        collectedParagraphs = collectFromViews("");
      }
      paragraphs.push(...collectedParagraphs);
      if (!language && book && book!.packaging && book!.packaging.metadata) {
        language = String(book!.packaging.metadata.language || "");
      }
      const speechLanguage = window.BookstrSpeech!.normalizeLocale(language);
      const plan = window.BookstrSpeech!.buildPlan(paragraphs, {
        language: speechLanguage,
        normalizeEnglish: true,
      }) as ReaderSpeechPlan;
      plan.language = speechLanguage;
      return plan;
    }

    function stopReaderSpeech() {
      if (readerSpeechPlayer) readerSpeechPlayer.stop();
      else setReaderSpeechState("stopped");
    }

    function startReaderSpeech() {
      if (!hasSpeechSupport() || !readerSpeechPlayer) return;
      stopReaderSpeech();
      const plan = collectReaderSpeechPlan();
      readerSpeechPlayer.start(plan, {
        language: plan.language!,
        rate: Number(currentReaderSettings.speechRate) || 1,
        voiceIdentifier: selectedSpeechVoice(plan.language!),
      });
    }

    function pauseReaderSpeech() {
      if (!hasSpeechSupport() || !readerSpeechPlayer) return;
      if (readerSpeechState === "paused") {
        readerSpeechPlayer.resume();
        return;
      }
      readerSpeechPlayer.pause();
    }

    function handleDesktopOpenReader(payload: unknown) {
      const normalized = normalizeDesktopReaderPayload(payload);
      if (!normalized) return;
      setupReaderSpeechControls();
      const bookMetadata = normalized.book;
      updateReaderHeader(bookMetadata);
      if (!bookMetadata.md5) {
        desktopReaderBook = null;
      } else {
        desktopReaderBook = bookMetadata;
      }
      desktopReaderFurthestProgress = 0;
      desktopReaderProgress = null;
      const bookId = desktopReaderBook ? desktopReaderBook.md5 : "";
      window.setReaderTypography!(normalized.font, normalized.alignment, normalized.padding);
      void reportPromise(window.loadBook(
        normalized.base64,
        normalized.cfi,
        normalized.theme,
        bookId,
        desktopReaderBook
      ));
    }

    if (desktopBridge?.onOpenReader) {
      desktopBridge.onOpenReader(handleDesktopOpenReader);
    }

    function setupReaderSpeechControls() {
      if (!readerSpeechControls || readerSpeechPlayer) return Boolean(readerSpeechPlayer);
      if (!hasSpeechSupport()) {
        readerSpeechControls.classList.add("hidden");
        return false;
      }
      readerSpeechPlayer = window.BookstrSpeech!.createPlayer({
        speechSynthesis: window.speechSynthesis,
        Utterance: window.SpeechSynthesisUtterance,
        onStateChange: setReaderSpeechState,
      });
      readerSpeechControls.classList.remove("hidden");
      setReaderSpeechState("stopped");
      readerSpeechPlayButton.addEventListener("click", startReaderSpeech);
      readerSpeechPauseButton.addEventListener("click", pauseReaderSpeech);
      readerSpeechStopButton.addEventListener("click", stopReaderSpeech);
      return true;
    }

    if (!setupReaderSpeechControls() && desktopBridge) {
      let speechSupportAttempts = 0;
      const retryReaderSpeechSetup = function() {
        if (setupReaderSpeechControls() || speechSupportAttempts >= 20) return;
        speechSupportAttempts += 1;
        window.setTimeout(retryReaderSpeechSetup, 50);
      };
      window.setTimeout(retryReaderSpeechSetup, 0);
    }

    window.loadBook = (function(base64: string, cfi: string, theme: string, bookId: string, desktopPayloadBook: unknown = null) {
      return reportPromise(openBook(base64ToArrayBuffer(base64), cfi, theme, null, bookId, desktopPayloadBook));
    }) as typeof window.loadBook;

    window.loadBookUrl = function(url, cfi, theme, highlightCfi, bookId) {
      const loading = fetch(url, { cache: "no-store" }).then(function(response) {
        if (!response.ok) throw new Error("EPUB request failed: HTTP " + response.status);
        return response.arrayBuffer();
      }).then(function(buffer) {
        if (!buffer.byteLength) throw new Error("Downloaded EPUB is empty");
        return openBook(buffer, cfi, theme, highlightCfi, bookId);
      });
      return reportPromise(withTimeout(loading, 30000, "EPUB reader timed out"));
    };

    function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>(function(_, reject) {
        timer = setTimeout(function() { reject(new Error(message)); }, milliseconds);
      });
      return Promise.race([promise, timeout]).finally(function() { clearTimeout(timer); });
    }

    function reportPromise(promise: Promise<unknown>) {
      return promise.catch(function(error) {
        reportReaderError(error);
        throw error;
      });
    }

    function installSwipeNavigation(target: Document) {
      if (target.__bookstrSwipeInstalled) return;
      target.__bookstrSwipeInstalled = true;
      let startX = 0;
      let startY = 0;
      let pinchStartDistance = 0;
      let pinchStartFontPercent = readerFontPercent;
      target.addEventListener("touchstart", function(event) {
        if (event.touches.length === 1) {
          startX = event.touches[0]!.clientX;
          startY = event.touches[0]!.clientY;
        } else if (event.touches.length === 2) {
          pinchStartDistance = touchDistance(event.touches[0]!, event.touches[1]!);
          pinchStartFontPercent = readerFontPercent;
        }
      }, { passive: true });
      target.addEventListener("touchmove", function(event) {
        if (event.touches.length !== 2 || pinchStartDistance <= 0) return;
        const distance = touchDistance(event.touches[0]!, event.touches[1]!);
        const ratio = distance / pinchStartDistance;
        const dampedRatio = 1 + (ratio - 1) * 0.35;
        const next = Math.max(75, Math.min(180, Math.round(pinchStartFontPercent * dampedRatio)));
        if (next !== readerFontPercent) {
          readerFontPercent = next;
          rendition!.themes.fontSize(readerFontPercent + "%");
          localStorage.setItem("bookstr-reader-font-percent", String(readerFontPercent));
        }
        event.preventDefault();
      }, { passive: false });
      target.addEventListener("touchend", function(event) {
        if (!event.changedTouches.length) return;
        const endX = event.changedTouches[0]!.clientX;
        const endY = event.changedTouches[0]!.clientY;
        const dx = endX - startX;
        const dy = endY - startY;
        const selectedText = target.defaultView?.getSelection()?.toString().trim() || "";
        if (selectedText) return;
        if (Math.abs(dx) < 18 && Math.abs(dy) < 18) {
          closeDictionary();
          return;
        }
        if (Math.abs(dx) < 85 || Math.abs(dx) < Math.abs(dy) * 1.65) return;
        if (dx < 0) nextPage(); else prevPage();
      }, { passive: true });
      target.addEventListener("keydown", function(event) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          prevPage();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nextPage();
        }
      });
    }

    function touchDistance(first: Touch, second: Touch): number {
      const dx = second.clientX - first.clientX;
      const dy = second.clientY - first.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function normalizeSelectedWord(selection: string): string | null {
      const word = String(selection || "").normalize("NFC").trim()
        .replace(/^\P{L}+|\P{L}+$/gu, "").toLocaleLowerCase();
      return word && word.length <= 64 && /^\p{L}+(?:['’-]\p{L}+)*$/u.test(word) ? word : null;
    }

    function selectionContext(selection: Selection | null | undefined): string {
      if (!selection || !selection.anchorNode) return "";
      let node: Element | null = selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode as Element : selection.anchorNode.parentElement;
      const block = node && node.closest ? node.closest("p, li, blockquote, dd, dt, figcaption") : null;
      const text = cleanDictionaryText((block || node)!.textContent || "");
      if (text.length <= 360) return text;
      const selected = cleanDictionaryText(selection.toString());
      const index = text.toLocaleLowerCase().indexOf(selected.toLocaleLowerCase());
      if (index < 0) return text.slice(0, 357) + "…";
      const start = Math.max(0, index - 150);
      const end = Math.min(text.length, index + selected.length + 150);
      return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    }

    function cleanDictionaryText(value: unknown): string {
      return String(value || "").replace(/\s+/g, " ").replace(/\[editar\]/gi, "").trim();
    }

    function closeDictionary() {
      (document.getElementById("dictionary-card") as HTMLElement).hidden = true;
      activeDictionary = null;
    }

    function applyHighlight(cfi: string) {
      if (!cfi || !rendition || !rendition.annotations) return;
      try {
        rendition!.annotations.highlight(
          cfi, {}, null, "bookstr-word-highlight",
          { fill: "#e7c766", "fill-opacity": "0.62", "mix-blend-mode": "multiply" }
        );
      } catch (error) { console.warn("Could not highlight word", error); }
    }

    function highlightStorageKey() {
      return "bookstr-highlights:" + currentBookId;
    }

    function restoredHighlights(extraCfi: string | null) {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(highlightStorageKey()) || "[]"); } catch (_) {}
      if (extraCfi && !saved.includes(extraCfi)) saved.push(extraCfi);
      return saved.filter(Boolean).slice(-500);
    }

    function keepHighlight(cfi: string) {
      if (!cfi) return;
      const saved = restoredHighlights(cfi);
      try { localStorage.setItem(highlightStorageKey(), JSON.stringify(saved)); } catch (_) {}
      applyHighlight(cfi);
    }

    function renderContext(node: HTMLElement, context: string, word: string) {
      node.replaceChildren();
      if (!context) { node.hidden = true; return; }
      node.hidden = false;
      const index = context.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
      if (index < 0) { node.textContent = context; return; }
      node.append(document.createTextNode(context.slice(0, index)));
      const mark = document.createElement("mark");
      mark.textContent = context.slice(index, index + word.length);
      node.append(mark, document.createTextNode(context.slice(index + word.length)));
    }

    async function showDictionary(selection: string, language: string, cfi: string, contextSentence: string) {
      const word = normalizeSelectedWord(selection);
      if (!word) return;
      const dictionaryLanguage = String(language).toLowerCase().startsWith("pt") ? "pt" : "en";
      if (window.AndroidBridge) AndroidBridge.onWordSelected!(JSON.stringify({
        word: word,
        language: dictionaryLanguage,
        cfi: cfi || "",
        contextSentence: contextSentence || ""
      }));
      const card = (document.getElementById("dictionary-card") as HTMLElement);
      const wordNode = (document.getElementById("dictionary-word") as HTMLElement);
      const kindNode = (document.getElementById("dictionary-kind") as HTMLElement);
      const statusNode = (document.getElementById("dictionary-status") as HTMLElement);
      const definitionsNode = (document.getElementById("dictionary-definitions") as HTMLUListElement);
      const sourceNode = (document.getElementById("dictionary-source") as HTMLAnchorElement);
      const contextNode = (document.getElementById("dictionary-context") as HTMLElement);
      card.hidden = false;
      wordNode.textContent = word;
      kindNode.textContent = "";
      statusNode.textContent = "Looking up…";
      definitionsNode.replaceChildren();
      renderContext(contextNode, contextSentence || "", word);
      sourceNode.hidden = true;
      activeDictionary = { word: word, language: dictionaryLanguage };
      if (window.AndroidBridge && AndroidBridge.onLookupDictionary) {
        AndroidBridge.onLookupDictionary(JSON.stringify(activeDictionary));
        return;
      }
      try {
        const cacheKey = "bookstr-dictionary-" + dictionaryLanguage + ":" + word;
        let entry = null;
        try { entry = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch (_) {}
        if (!entry || !Array.isArray(entry.definitions) || !entry.definitions.length) {
          entry = await lookupDictionary(word, dictionaryLanguage);
          try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch (_) {}
        }
        if (card.hidden || wordNode.textContent !== word) return;
        kindNode.textContent = entry.partOfSpeech || "";
        statusNode.textContent = "";
        entry.definitions.slice(0, 4).forEach(function(definition: string) {
          const item = document.createElement("li");
          item.textContent = definition;
          definitionsNode.appendChild(item);
        });
        sourceNode.href = entry.sourceUrl;
        sourceNode.hidden = false;
        if (window.AndroidBridge) AndroidBridge.onDictionaryResult!(JSON.stringify({
          word: word,
          language: dictionaryLanguage,
          partOfSpeech: entry.partOfSpeech || "",
          definitions: entry.definitions.slice(0, 4),
          sourceUrl: entry.sourceUrl || ""
        }));
      } catch (error) {
        console.warn("Dictionary lookup failed", error);
        const detail = error as { message?: unknown } | null;
        statusNode.textContent = detail?.message ? detail.message as string : "Definition unavailable";
      }
    }

    window.receiveDictionaryResult = function(payloadJson) {
      let payload;
      try { payload = JSON.parse(payloadJson); } catch (_) { return; }
      if (!activeDictionary || payload.word !== activeDictionary.word) return;
      const statusNode = (document.getElementById("dictionary-status") as HTMLElement);
      const kindNode = (document.getElementById("dictionary-kind") as HTMLElement);
      const definitionsNode = (document.getElementById("dictionary-definitions") as HTMLUListElement);
      const sourceNode = (document.getElementById("dictionary-source") as HTMLAnchorElement);
      if (payload.error) {
        statusNode.textContent = payload.error;
        return;
      }
      statusNode.textContent = "";
      kindNode.textContent = payload.partOfSpeech || "";
      definitionsNode.replaceChildren();
      (payload.definitions || []).slice(0, 4).forEach(function(definition: string) {
        const item = document.createElement("li");
        item.textContent = definition;
        definitionsNode.appendChild(item);
      });
      sourceNode.textContent = String(payload.partOfSpeech || "").startsWith("WikDict")
        ? "WikDict" : "Wiktionary";
      sourceNode.href = payload.sourceUrl || "";
      sourceNode.hidden = !payload.sourceUrl;
      if (window.AndroidBridge) AndroidBridge.onDictionaryResult!(JSON.stringify(payload));
    };

    async function lookupDictionary(word: string, language: string) {
      const languages = [language, language === "pt" ? "en" : "pt"];
      for (const candidateLanguage of languages) {
        const host = candidateLanguage === "pt" ? "pt.wiktionary.org" : "en.wiktionary.org";
        const params = new URLSearchParams({
          action: "query", prop: "extracts", explaintext: "1", redirects: "1",
          titles: word, format: "json", formatversion: "2", origin: "*"
        });
        const response = await fetch("https://" + host + "/w/api.php?" + params.toString());
        if (!response.ok) continue;
        const payload = await response.json();
        const pages = payload.query && payload.query.pages;
        const extract = Array.isArray(pages) && pages[0] && pages[0].extract || "";
        const parsed = parseDictionaryExtract(extract, candidateLanguage, word);
        if (parsed.definitions.length) {
          return {
            partOfSpeech: parsed.partOfSpeech,
            definitions: parsed.definitions,
            sourceUrl: "https://" + host + "/wiki/" + encodeURIComponent(word)
          };
        }
      }
      throw new Error("No definition found for “" + word + "”");
    }

    function extractHeading(line: string) {
      const match = String(line || "").match(/^(=+)\s*(.*?)\s*\1$/);
      return match ? { level: match[1]!.length, text: match[2]!.trim() } : null;
    }

    function parseDictionaryExtract(extract: string, language: string, word: string) {
      const lines = String(extract || "").split(/\r?\n/).map(function(line) { return line.trim(); });
      const wanted = language === "pt" ? "português" : "english";
      let languageIndex = -1;
      let languageLevel = 0;
      for (let index = 0; index < lines.length; index++) {
        const heading = extractHeading(lines[index]!);
        if (heading && heading.text.toLocaleLowerCase() === wanted) {
          languageIndex = index;
          languageLevel = heading.level;
          break;
        }
      }
      if (languageIndex < 0) return { partOfSpeech: "", definitions: [] };
      const ignored = /^(Etimologia|Pronúncia|Tradução|Ver também|Ligações externas|Etymology.*|Pronunciation|Translations|Related terms|Derived terms|See also|Further reading|Anagrams)$/i;
      let accepting = false;
      let partOfSpeech = "";
      let skipHeadword = false;
      const definitions: string[] = [];
      for (let index = languageIndex + 1; index < lines.length; index++) {
        const line = lines[index]!;
        const heading = extractHeading(line);
        if (heading && heading.level <= languageLevel) break;
        if (heading) {
          accepting = Boolean(heading.text) && !ignored.test(heading.text);
          skipHeadword = accepting;
          if (accepting && !partOfSpeech) partOfSpeech = heading.text;
          continue;
        }
        if (!accepting || !line) continue;
        const lettersOnly = line.replace(/[^\p{L}]/gu, "").toLocaleLowerCase();
        const wordLetters = word.replace(/[^\p{L}]/gu, "").toLocaleLowerCase();
        if (skipHeadword || lettersOnly === wordLetters) {
          skipHeadword = false;
          continue;
        }
        if (/^(IPA|Rhymes:|Hyphenation:)/i.test(line) || line.length < 3) continue;
        if (!definitions.includes(line)) definitions.push(line);
        if (definitions.length === 4) break;
      }
      return { partOfSpeech: partOfSpeech, definitions: definitions };
    }

    function parseDictionaryHtml(html: string, language: string) {
      const parsedDocument = new DOMParser().parseFromString(html, "text/html");
      const wanted = language === "pt" ? "português" : "english";
      const heading = Array.from(parsedDocument.querySelectorAll("h1, h2")).find(function(node) {
        return cleanDictionaryText(node.textContent).toLocaleLowerCase().includes(wanted);
      });
      const headingRow = heading && heading.parentElement;
      if (!headingRow) return { definitions: [] };
      const levelClass = Array.from(headingRow.classList).find(function(name) { return /^mw-heading\d$/.test(name); });
      const nodes = [];
      let sibling = headingRow.nextElementSibling;
      while (sibling) {
        if (levelClass && sibling.classList.contains(levelClass)) break;
        nodes.push(sibling);
        sibling = sibling.nextElementSibling;
      }
      let partOfSpeech = "";
      const definitions: string[] = [];
      nodes.forEach(function(node) {
        const subheading = node.matches(".mw-heading") ? node.querySelector("h2, h3, h4") : null;
        if (!partOfSpeech && subheading) {
          const candidate = cleanDictionaryText(subheading.textContent);
          if (!/^(Etimologia|Pronúncia|Ver também|Etymology|Pronunciation)$/i.test(candidate)) {
            partOfSpeech = candidate;
          }
        }
        node.querySelectorAll("ol > li").forEach(function(item) {
          const definition = cleanDictionaryText(item.textContent);
          if (definition && !definitions.includes(definition) && definitions.length < 4) definitions.push(definition);
        });
      });
      return { partOfSpeech: partOfSpeech, definitions: definitions };
    }
    void parseDictionaryHtml;

    (document.getElementById("dictionary-close") as HTMLElement).addEventListener("click", closeDictionary);
    document.addEventListener("pointerdown", function(event) {
      if (!(document.getElementById("dictionary-card") as HTMLElement).contains(event.target as Node | null)) closeDictionary();
    });

    window.nextPage = function() {
      moveViewportPage(1);
    };

    window.prevPage = function() {
      moveViewportPage(-1);
    };

    function moveViewportPage(direction: number) {
      if (!rendition) return;
      if (readerSpeechState === "playing" || readerSpeechState === "paused") {
        stopReaderSpeech();
      }
      const container = document.querySelector(".epub-container");
      if (container && container.scrollBy) {
        const before = container.scrollTop;
        const distance = Math.max(180, container.clientHeight * 0.88);
        container.scrollBy({ top: direction * distance, behavior: "smooth" });
        setTimeout(function() {
          if (Math.abs(container.scrollTop - before) > 2) return;
          const movement = direction > 0 ? rendition!.next() : rendition!.prev();
          if (movement && typeof movement.catch === "function") movement.catch(reportReaderError);
        }, 260);
      } else {
        const movement = direction > 0 ? rendition!.next() : rendition!.prev();
        if (movement && typeof movement.catch === "function") movement.catch(reportReaderError);
      }
    }

    (document.getElementById("reader-prev") as HTMLElement).addEventListener("click", window.prevPage);
    (document.getElementById("reader-next") as HTMLElement).addEventListener("click", window.nextPage);
    document.addEventListener("keydown", function(event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        window.prevPage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        window.nextPage();
      }
    });

    window.setReaderTheme = function(theme) {
      applyTheme(theme);
    };

    window.setReaderTypography = function(font, alignment, padding) {
      readerFontFamily = window.BookstrTypography.normalizeFont(font);
      readerAlignment = window.BookstrTypography.normalizeAlignment(alignment);
      readerPadding = window.BookstrTypography.normalizePadding(padding);
      applyTypography();
    };

    function flushDesktopProgress() {
      if (!desktopReaderProgress) return;
      if (window.parent !== window) {
        window.parent.postMessage(desktopReaderProgress, window.location.origin);
      } else if (desktopBridge?.reportProgress) {
        desktopBridge.reportProgress(desktopReaderProgress);
      }
    }

    window.addEventListener("visibilitychange", function() {
      if (document.hidden && (readerSpeechState === "playing" || readerSpeechState === "paused")) {
        stopReaderSpeech();
      }
    });
    window.addEventListener("beforeunload", function() {
      stopReaderSpeech();
      flushDesktopProgress();
    });
    window.addEventListener("pagehide", function() {
      stopReaderSpeech();
      flushDesktopProgress();
    });
