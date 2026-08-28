(function initBookstrVocabularyWire(root) {
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parsePayload(value, fallbackUpdatedAt = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const word = typeof value.word === 'string' ? value.word.trim().toLowerCase() : '';
    const language = typeof value.language === 'string' ? value.language.toLowerCase() : '';
    const syncId = typeof value.syncId === 'string' ? value.syncId : '';
    if (!word || !language || !syncId
      || typeof value.bookId !== 'string' || typeof value.bookTitle !== 'string') return null;
    const lastSeenAt = number(value.lastSeenAt) || number(value.updatedAt) || number(fallbackUpdatedAt);
    const definitions = Array.isArray(value.definitions)
      ? value.definitions.filter(item => typeof item === 'string' && item)
      : [];
    return {
      ...value,
      key: typeof value.key === 'string' && value.key ? value.key : `${language}:${word}`,
      word,
      language,
      syncId,
      bookId: value.bookId,
      bookTitle: value.bookTitle,
      cfi: typeof value.cfi === 'string' ? value.cfi : '',
      contextSentence: typeof value.contextSentence === 'string' ? value.contextSentence : '',
      partOfSpeech: typeof value.partOfSpeech === 'string' ? value.partOfSpeech : '',
      definitions,
      sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : '',
      lookupCount: number(value.lookupCount) || 1,
      firstSeenAt: number(value.firstSeenAt) || lastSeenAt,
      lastSeenAt,
      updatedAt: number(value.updatedAt) || lastSeenAt,
      deleted: value.deleted === true,
    };
  }

  // The browser historically accepted local-storage-shaped vocabulary payloads.
  // Keep that compatibility at the web adapter boundary while the canonical wire
  // parser above remains aligned with the stricter native payload contract.
  function parseLegacyPayload(value, fallbackUpdatedAt = 0) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const word = String(value.word || '').trim().toLowerCase();
    if (!word) return null;
    const language = String(value.sourceLanguage || value.lang || value.language || 'pt').toLowerCase();
    const updatedAt = number(value.updatedAt) || number(value.lastSeenAt) || number(fallbackUpdatedAt);
    return {
      ...value,
      key: value.key || `${language}:${word}`,
      word,
      language,
      bookId: String(value.bookId || ''),
      bookTitle: String(value.bookTitle || ''),
      cfi: String(value.cfi || ''),
      contextSentence: String(value.contextSentence || ''),
      partOfSpeech: String(value.partOfSpeech || ''),
      definitions: Array.isArray(value.definitions) ? value.definitions.filter(Boolean) : [],
      sourceUrl: String(value.sourceUrl || ''),
      lookupCount: number(value.lookupCount) || 1,
      firstSeenAt: number(value.firstSeenAt) || updatedAt,
      lastSeenAt: number(value.lastSeenAt) || updatedAt,
      updatedAt,
      deleted: Boolean(value.deleted),
    };
  }

  root.BookstrVocabularyWire = { parseLegacyPayload, parsePayload };
})(globalThis);
