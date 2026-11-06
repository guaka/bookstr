"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEnabledReaderFormat = isEnabledReaderFormat;
exports.requireEnabledReaderFormat = requireEnabledReaderFormat;
const ENABLED_READER_FORMATS = new Set(['epub', 'pdf', 'cbz', 'cbr']);
function isEnabledReaderFormat(value) {
    return ENABLED_READER_FORMATS.has(String(value || '').trim().toLowerCase().replace(/^\./, ''));
}
function requireEnabledReaderFormat(value) {
    const format = String(value || '').trim().toLowerCase().replace(/^\./, '');
    if (!isEnabledReaderFormat(format))
        throw new TypeError('unsupported acquisition format');
    return format;
}
//# sourceMappingURL=reader-formats.js.map