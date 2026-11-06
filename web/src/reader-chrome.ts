(function <T extends object>(root: typeof globalThis & { BookstrReaderChrome?: unknown }, factory: () => T) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BookstrReaderChrome = api;
})((typeof globalThis !== 'undefined' ? globalThis : this) as unknown as typeof globalThis & { BookstrReaderChrome?: unknown }, function() {
  function themeBackgroundColor(theme: unknown): string {
    if (theme === "night") return "#121212";
    if (theme === "white") return "#ffffff";
    return "#f7f3ea";
  }

  function backgroundIsolateCss(background: unknown): string {
    const color = String(background || "#f7f3ea");
    return "html,body{background:" + color + "!important;background-color:" + color + "!important}" +
      "html.bookstr-reader-root.bookstr-bg-isolate body " +
      "*:not(img):not(svg):not(image):not(video):not(canvas){" +
      "background-color:transparent!important;background-image:none!important}";
  }

  function clearInlineBackgrounds(root: Element | null | undefined): number {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let cleared = 0;
    Array.prototype.forEach.call(root.querySelectorAll("*"), function(element: Element) {
      const styled = element as Element & { style?: CSSStyleDeclaration };
      if (!element || !styled.style) return;
      if (element.closest && element.closest("svg")) return;
      if (/^(IMG|SVG|IMAGE|VIDEO|CANVAS)$/i.test(element.tagName || "")) return;
      const before = styled.style.cssText;
      styled.style.removeProperty("background");
      styled.style.removeProperty("background-color");
      styled.style.removeProperty("background-image");
      if (styled.style.cssText !== before) cleared += 1;
    });
    return cleared;
  }

  function prepareContentDocument(contentDocument: Document | null | undefined, theme: unknown): boolean {
    if (!contentDocument || !contentDocument.documentElement) return false;
    const root = contentDocument.documentElement;
    root.classList.add("bookstr-reader-root", "bookstr-bg-isolate");
    let style = contentDocument.getElementById && contentDocument.getElementById("bookstr-bg-isolate");
    if (!style && contentDocument.createElement) {
      style = contentDocument.createElement("style");
      style.id = "bookstr-bg-isolate";
      (contentDocument.head || root).appendChild(style);
    }
    if (style) style.textContent = backgroundIsolateCss(themeBackgroundColor(theme));
    if (contentDocument.body) clearInlineBackgrounds(contentDocument.body);
    return true;
  }

  function paintShell(nodes: unknown, theme: unknown): string {
    const background = themeBackgroundColor(theme);
    const list: Array<{ style?: { background: string } }> = Array.isArray(nodes) ? nodes as Array<{ style?: { background: string } }> : [];
    list.forEach(function(node) {
      if (node && node.style) node.style.background = background;
    });
    return background;
  }

  return {
    themeBackgroundColor,
    backgroundIsolateCss,
    clearInlineBackgrounds,
    prepareContentDocument,
    paintShell,
  };
});

export interface ReaderChromeApi {
  themeBackgroundColor(theme: unknown): string;
  backgroundIsolateCss(background: unknown): string;
  clearInlineBackgrounds(root: Element | null | undefined): number;
  prepareContentDocument(contentDocument: Document | null | undefined, theme: unknown): boolean;
  paintShell(nodes: unknown, theme: unknown): string;
}
