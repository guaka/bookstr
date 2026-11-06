(function initBookstrVocabularyWire(root: typeof globalThis & { BookstrVocabularyWire?: unknown }) {
  type VocabularyRecord = Record<string, unknown>;
  function number(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parsePayload(value: unknown, fallbackUpdatedAt = 0): VocabularyRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as VocabularyRecord;
    const word = typeof payload.word === 'string' ? payload.word.trim().toLowerCase() : '';
    const language = typeof payload.language === 'string' ? payload.language.toLowerCase() : '';
    const syncId = typeof payload.syncId === 'string' ? payload.syncId : '';
    if (!word || !language || !syncId
      || typeof payload.bookId !== 'string' || typeof payload.bookTitle !== 'string') return null;
    const lastSeenAt = number(payload.lastSeenAt) || number(payload.updatedAt) || number(fallbackUpdatedAt);
    const definitions = Array.isArray(payload.definitions)
      ? (payload.definitions as unknown[]).filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
    return {
      ...value,
      key: typeof payload.key === 'string' && payload.key ? payload.key : `${language}:${word}`,
      word,
      language,
      syncId,
      bookId: payload.bookId,
      bookTitle: payload.bookTitle,
      cfi: typeof payload.cfi === 'string' ? payload.cfi : '',
      contextSentence: typeof payload.contextSentence === 'string' ? payload.contextSentence : '',
      partOfSpeech: typeof payload.partOfSpeech === 'string' ? payload.partOfSpeech : '',
      definitions,
      sourceUrl: typeof payload.sourceUrl === 'string' ? payload.sourceUrl : '',
      lookupCount: number(payload.lookupCount) || 1,
      firstSeenAt: number(payload.firstSeenAt) || lastSeenAt,
      lastSeenAt,
      updatedAt: number(payload.updatedAt) || lastSeenAt,
      deleted: payload.deleted === true,
    };
  }

  // The browser historically accepted local-storage-shaped vocabulary payloads.
  // Keep that compatibility at the web adapter boundary while the canonical wire
  // parser above remains aligned with the stricter native payload contract.
  function parseLegacyPayload(value: unknown, fallbackUpdatedAt = 0): VocabularyRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const payload = value as VocabularyRecord;
    const word = String(payload.word || '').trim().toLowerCase();
    if (!word) return null;
    const language = String(payload.sourceLanguage || payload.lang || payload.language || 'pt').toLowerCase();
    const updatedAt = number(payload.updatedAt) || number(payload.lastSeenAt) || number(fallbackUpdatedAt);
    return {
      ...value,
      key: payload.key || `${language}:${word}`,
      word,
      language,
      bookId: String(payload.bookId || ''),
      bookTitle: String(payload.bookTitle || ''),
      cfi: String(payload.cfi || ''),
      contextSentence: String(payload.contextSentence || ''),
      partOfSpeech: String(payload.partOfSpeech || ''),
      definitions: Array.isArray(payload.definitions) ? (payload.definitions as unknown[]).filter(Boolean) : [],
      sourceUrl: String(payload.sourceUrl || ''),
      lookupCount: number(payload.lookupCount) || 1,
      firstSeenAt: number(payload.firstSeenAt) || updatedAt,
      lastSeenAt: number(payload.lastSeenAt) || updatedAt,
      updatedAt,
      deleted: Boolean(payload.deleted),
    };
  }

  root.BookstrVocabularyWire = { parseLegacyPayload, parsePayload };
})(globalThis);
