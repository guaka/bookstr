(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BookstrSpeechSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeLocale(value) {
    return String(value || '').trim().replace(/_/g, '-').toLowerCase();
  }

  function languageCode(value) {
    return normalizeLocale(value).split('-')[0];
  }

  function languageName(locale, displayNames) {
    const code = languageCode(locale);
    try {
      return displayNames?.of(code) || code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  }

  function languagesForVoices(voices, displayNames) {
    const locales = new Map();
    for (const voice of voices || []) {
      const locale = normalizeLocale(voice?.lang);
      const code = languageCode(locale);
      if (code && !locales.has(code)) locales.set(code, locale);
    }
    return [...locales].map(([code, locale]) => ({ code, locale, label: languageName(locale, displayNames) }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  function voicesForLanguage(voices, language, preferredPattern) {
    const code = languageCode(language);
    return (voices || []).filter(voice => languageCode(voice?.lang) === code).sort((left, right) => {
      const leftPreferred = preferredPattern?.test(`${left.name} ${left.voiceURI}`) ? 0 : 1;
      const rightPreferred = preferredPattern?.test(`${right.name} ${right.voiceURI}`) ? 0 : 1;
      return leftPreferred - rightPreferred
        || Number(Boolean(right.localService)) - Number(Boolean(left.localService))
        || String(left.name).localeCompare(String(right.name));
    });
  }

  function savedVoice(settings, language) {
    const code = languageCode(language);
    if (settings?.speechVoices && typeof settings.speechVoices[code] === 'string') {
      return settings.speechVoices[code];
    }
    if (code === 'en') return String(settings?.speechVoiceEnglish || '');
    if (code === 'pt') return String(settings?.speechVoicePortuguese || '');
    return '';
  }

  return { languageCode, languagesForVoices, voicesForLanguage, savedVoice };
});
