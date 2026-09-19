(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BookstrReaderChrome = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function themeBackgroundColor(theme) {
    if (theme === "night") return "#121212";
    if (theme === "white") return "#ffffff";
    return "#f7f3ea";
  }

  function backgroundIsolateCss(background) {
    const color = String(background || "#f7f3ea");
    return "html,body{background:" + color + "!important;background-color:" + color + "!important}" +
      "html.bookstr-reader-root.bookstr-bg-isolate body " +
      "*:not(img):not(svg):not(image):not(video):not(canvas){" +
      "background-color:transparent!important;background-image:none!important}";
  }

  function clearInlineBackgrounds(root) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let cleared = 0;
    Array.prototype.forEach.call(root.querySelectorAll("*"), function(element) {
      if (!element || !element.style) return;
      if (element.closest && element.closest("svg")) return;
      if (/^(IMG|SVG|IMAGE|VIDEO|CANVAS)$/i.test(element.tagName || "")) return;
      const before = element.style.cssText;
      element.style.removeProperty("background");
      element.style.removeProperty("background-color");
      element.style.removeProperty("background-image");
      if (element.style.cssText !== before) cleared += 1;
    });
    return cleared;
  }

  function prepareContentDocument(contentDocument, theme) {
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

  function paintShell(nodes, theme) {
    const background = themeBackgroundColor(theme);
    const list = Array.isArray(nodes) ? nodes : [];
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
