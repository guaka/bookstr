(function <T extends object>(root: typeof globalThis & { BookstrSpeechSettings?: unknown }, factory: () => T) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BookstrSpeechSettings = api;
})((typeof globalThis !== 'undefined' ? globalThis : this) as unknown as typeof globalThis & { BookstrSpeechSettings?: unknown }, function () {
  const LANGUAGE_NAMES: Readonly<Record<string, string>> = Object.freeze({
    ar: 'Arabic', bn: 'Bengali', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
    es: 'Spanish', fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian',
    it: 'Italian', ja: 'Japanese', ko: 'Korean', nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese',
    ro: 'Romanian', ru: 'Russian', sv: 'Swedish', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese',
    zh: 'Chinese',
  });
  const LANGUAGE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    english: 'en', portuguese: 'pt', portugues: 'pt', 'português': 'pt',
    spanish: 'es', espanol: 'es', 'español': 'es', french: 'fr', german: 'de', italian: 'it',
  });
  function normalizeLocale(value: unknown): string {
    return String(value || '').trim().replace(/_/g, '-').toLowerCase();
  }

  function languageCode(value: unknown): string {
    const code = normalizeLocale(value).split('-')[0]!;
    return LANGUAGE_ALIASES[code] || code;
  }

  function languageName(locale: unknown, displayNames?: Pick<Intl.DisplayNames, 'of'> | null): string {
    const code = languageCode(locale);
    try {
      return displayNames?.of(code) || LANGUAGE_NAMES[code] || code.toUpperCase();
    } catch {
      return LANGUAGE_NAMES[code] || code.toUpperCase();
    }
  }

  function languagesForCodes(codes: readonly string[] | null | undefined, displayNames?: Pick<Intl.DisplayNames, 'of'> | null) {
    return languagesForVoices((codes || []).filter(Boolean).map(lang => ({ lang })), displayNames);
  }

  interface VoiceLike { lang?: string; name?: string; voiceURI?: string; localService?: boolean }
  function languagesForVoices(voices: readonly VoiceLike[] | null | undefined, displayNames?: Pick<Intl.DisplayNames, 'of'> | null) {
    const locales = new Map();
    for (const voice of voices || []) {
      const locale = normalizeLocale(voice?.lang);
      const code = languageCode(locale);
      if (code && !locales.has(code)) locales.set(code, locale);
    }
    return [...locales].map(([code, locale]) => ({ code, locale, label: languageName(locale, displayNames) }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  function voicesForLanguage(voices: readonly VoiceLike[] | null | undefined, language: unknown, preferredPattern?: RegExp) {
    const code = languageCode(language);
    return (voices || []).filter(voice => languageCode(voice?.lang) === code).sort((left, right) => {
      const leftPreferred = preferredPattern?.test(`${left.name} ${left.voiceURI}`) ? 0 : 1;
      const rightPreferred = preferredPattern?.test(`${right.name} ${right.voiceURI}`) ? 0 : 1;
      return leftPreferred - rightPreferred
        || Number(Boolean(right.localService)) - Number(Boolean(left.localService))
        || String(left.name).localeCompare(String(right.name));
    });
  }

  function savedVoice(settings: { speechVoices?: Record<string, unknown>; speechVoiceEnglish?: unknown; speechVoicePortuguese?: unknown } | null | undefined, language: unknown): string {
    const code = languageCode(language);
    if (settings?.speechVoices && typeof settings.speechVoices[code] === 'string') {
      return settings.speechVoices[code];
    }
    if (code === 'en') return String(settings?.speechVoiceEnglish || '');
    if (code === 'pt') return String(settings?.speechVoicePortuguese || '');
    return '';
  }

  return { languageCode, languagesForVoices, languagesForCodes, voicesForLanguage, savedVoice };
});

export interface SpeechSettingLanguage { code: string; locale: string; label: string }
export interface SpeechSettingsApi {
  languageCode(value: unknown): string;
  languagesForVoices(voices: readonly SpeechSynthesisVoice[] | null | undefined, displayNames?: Pick<Intl.DisplayNames, 'of'> | null): SpeechSettingLanguage[];
  languagesForCodes(codes: readonly string[] | null | undefined, displayNames?: Pick<Intl.DisplayNames, 'of'> | null): SpeechSettingLanguage[];
  voicesForLanguage(voices: readonly SpeechSynthesisVoice[] | null | undefined, language: unknown, preferredPattern?: RegExp): SpeechSynthesisVoice[];
  savedVoice(settings: { speechVoices?: Record<string, unknown>; speechVoiceEnglish?: unknown; speechVoicePortuguese?: unknown } | null | undefined, language: unknown): string;
}
