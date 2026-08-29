(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BookstrTypography = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";

  const FONTS = {
    arial: "Arial, Helvetica, sans-serif",
    georgia: "Georgia, 'Times New Roman', serif",
    palatino: "Palatino, 'Palatino Linotype', 'Iowan Old Style', serif",
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  };

  function normalizeFont(name) {
    const key = String(name || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(FONTS, key) ? key : "arial";
  }

  function normalizeAlignment(value) {
    return String(value || "").trim().toLowerCase() === "left" ? "left" : "justified";
  }

  function fontStack(name) {
    return FONTS[normalizeFont(name)];
  }

  function css(font, alignment) {
    const family = fontStack(font);
    const align = normalizeAlignment(alignment) === "left" ? "left" : "justify";
    const hyphens = align === "justify" ? "auto" : "manual";
    return "body, p, div, li, blockquote, td, span, h1, h2, h3, h4, h5, h6{" +
      "font-family:" + family + " !important;}" +
      "p, div, li, blockquote, td{text-align:" + align + " !important;hyphens:" + hyphens +
      " !important;-webkit-hyphens:" + hyphens + " !important;}" +
      "h1, h2, h3, h4, h5, h6, pre, code{text-align:start !important;}";
  }

  return {
    normalizeFont: normalizeFont,
    normalizeAlignment: normalizeAlignment,
    fontStack: fontStack,
    css: css
  };
});
