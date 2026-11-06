import { present } from './test-values.mts';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import type { SpeechSettingsApi } from '../src/speech-settings.js';
import type { SpeechSettingLanguage } from '../src/speech-settings.js';

const require = createRequire(import.meta.url);
const speechSettings = require('../speech-settings.js') as SpeechSettingsApi;

function fixture<T>(value: unknown): T { return value as T; }
function voicesForLanguage(value: unknown, language: unknown, pattern?: RegExp) {
  return speechSettings.voicesForLanguage(fixture<readonly SpeechSynthesisVoice[] | null>(value), language, pattern);
}
function languagesForVoices(value: unknown, names?: Pick<Intl.DisplayNames, 'of'> | null): SpeechSettingLanguage[] {
  return speechSettings.languagesForVoices(fixture<readonly SpeechSynthesisVoice[] | null>(value), names);
}
function languagesForCodes(value: unknown, names?: Pick<Intl.DisplayNames, 'of'> | null): SpeechSettingLanguage[] {
  return speechSettings.languagesForCodes(fixture<readonly string[] | null>(value), names);
}

const voices = [
  { name: 'Anna', voiceURI: 'anna', lang: 'de_DE', localService: true },
  { name: 'Online English', voiceURI: 'online-en', lang: 'en-GB', localService: false },
  { name: 'Kokoro Heart', voiceURI: 'kokoro', lang: 'en_US', localService: true },
];

test('lists every installed speech language with localized, sorted labels', () => {
  const names: Pick<Intl.DisplayNames, 'of'> = { of: (code: string) => ({ de: 'German', en: 'English' }[code as 'de' | 'en'] || undefined) };
  assert.deepEqual(languagesForVoices(voices, names), [
    { code: 'en', locale: 'en-gb', label: 'English' },
    { code: 'de', locale: 'de-de', label: 'German' },
  ]);
  assert.deepEqual(languagesForVoices([{ lang: 'xx' }], { of: () => { throw new Error('unsupported'); } }), [
    { code: 'xx', locale: 'xx', label: 'XX' },
  ]);
  assert.deepEqual(languagesForVoices([{ lang: 'en' }], { of: () => { throw new Error('unsupported'); } }), [
    { code: 'en', locale: 'en', label: 'English' },
  ]);
  assert.deepEqual(languagesForVoices(null, null), []);
  assert.deepEqual(languagesForVoices([{ lang: '' }, null, { lang: 'en-US' }, { lang: 'en-GB' }], null), [
    { code: 'en', locale: 'en-us', label: 'English' },
  ]);
});

test('shows readable, deduplicated languages for codes and common metadata names', () => {
  const languages = languagesForCodes(['english', 'Portuguese', 'en-US', 'pt_PT', '', null], null);
  assert.equal(present(languages.find(language => language.code === 'en')).label, 'English');
  assert.equal(present(languages.find(language => language.code === 'pt')).label, 'Portuguese');
  assert.deepEqual(languages.map(language => language.code).sort(), ['en', 'pt']);
  assert.equal(speechSettings.languageCode('Português'), 'pt');
  assert.deepEqual(languagesForCodes(null, null), []);
});

test('filters by language and puts preferred installed voices first', () => {
  assert.deepEqual(
    voicesForLanguage(voices, 'en-US', /kokoro/i).map(voice => voice.voiceURI),
    ['kokoro', 'online-en'],
  );
  assert.deepEqual(voicesForLanguage(voices, 'fr', /kokoro/i), []);
  assert.deepEqual(voicesForLanguage(null, 'fr'), []);
  assert.deepEqual(
    voicesForLanguage([
      { name: 'Zulu', voiceURI: 'z', lang: 'en', localService: true },
      { name: 'Alpha', voiceURI: 'a', lang: 'en', localService: false },
    ], 'en').map(voice => voice.voiceURI),
    ['z', 'a'],
  );
  assert.deepEqual(
    voicesForLanguage([
      { name: 'Zulu', voiceURI: 'z', lang: 'en', localService: true },
      { name: 'Alpha', voiceURI: 'a', lang: 'en', localService: true },
    ], 'en', /never-matches/).map(voice => voice.voiceURI),
    ['a', 'z'],
  );
  assert.deepEqual(
    voicesForLanguage([
      { name: 'Kokoro Zulu', voiceURI: 'z', lang: 'en', localService: false },
      { name: 'Alpha', voiceURI: 'a', lang: 'en', localService: true },
    ], 'en', /kokoro/i).map(voice => voice.voiceURI),
    ['z', 'a'],
  );
});

test('reads per-language selections and migrates legacy English and Portuguese values', () => {
  assert.equal(speechSettings.languageCode('PT_pt'), 'pt');
  assert.equal(speechSettings.savedVoice({ speechVoices: { de: 'anna' } }, 'de-DE'), 'anna');
  assert.equal(speechSettings.savedVoice({ speechVoiceEnglish: 'legacy-en' }, 'en'), 'legacy-en');
  assert.equal(speechSettings.savedVoice({ speechVoicePortuguese: 'legacy-pt' }, 'pt'), 'legacy-pt');
  assert.equal(speechSettings.savedVoice({}, 'fr'), '');
  assert.equal(speechSettings.savedVoice(null, 'fr'), '');
  assert.equal(speechSettings.savedVoice({ speechVoices: { fr: 3 } }, 'fr'), '');
});

test('exposes the helper in a browser without CommonJS', () => {
  const source = fs.readFileSync(require.resolve('../speech-settings.js'), 'utf8');
  const context = {} as { BookstrSpeechSettings?: SpeechSettingsApi };
  vm.runInNewContext(source, context);
  assert.equal(context.BookstrSpeechSettings!.languageCode('ES_es'), 'es');
});
