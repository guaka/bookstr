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
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    roboto: "Roboto, 'Arial', sans-serif",
    "noto-serif": "'Noto Serif', Georgia, 'Times New Roman', serif"
  };

  function normalizeFont(name) {
    const key = String(name || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(FONTS, key) ? key : "arial";
  }

  function normalizeAlignment(value) {
    return String(value || "").trim().toLowerCase() === "left" ? "left" : "justified";
  }

  function normalizePadding(value) {
    const pixels = Number(value);
    if (!Number.isFinite(pixels)) return 24;
    if (pixels === 0) return 0;
    return Math.max(8, Math.min(64, Math.round(pixels)));
  }

  function fontStack(name) {
    return FONTS[normalizeFont(name)];
  }

  function css(font, alignment, padding) {
    const family = fontStack(font);
    const align = normalizeAlignment(alignment) === "left" ? "left" : "justify";
    const hyphens = align === "justify" ? "auto" : "manual";
    const horizontalPadding = normalizePadding(padding);
    return "html, body{box-sizing:border-box !important;}" +
      "body{padding-left:" + horizontalPadding + "px !important;padding-right:" + horizontalPadding + "px !important;}" +
      "body, p, div, li, blockquote, td, span, h1, h2, h3, h4, h5, h6{" +
      "font-family:" + family + " !important;}" +
      "p, div, li, blockquote, td{text-align:" + align + " !important;hyphens:" + hyphens +
      " !important;-webkit-hyphens:" + hyphens + " !important;}" +
      "h1, h2, h3, h4, h5, h6, pre, code{text-align:start !important;}";
  }

  return {
    normalizeFont: normalizeFont,
    normalizeAlignment: normalizeAlignment,
    normalizePadding: normalizePadding,
    fontStack: fontStack,
    css: css
  };
});
