const ENABLED_READER_FORMATS = new Set(['epub', 'pdf', 'cbz', 'cbr']);

export function isEnabledReaderFormat(value: unknown): boolean {
  return ENABLED_READER_FORMATS.has(String(value || '').trim().toLowerCase().replace(/^\./, ''));
}

export function requireEnabledReaderFormat(value: unknown): string {
  const format = String(value || '').trim().toLowerCase().replace(/^\./, '');
  if (!isEnabledReaderFormat(format)) throw new TypeError('unsupported acquisition format');
  return format;
}
