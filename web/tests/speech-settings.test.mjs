import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const speechSettings = require('../speech-settings.js');

const voices = [
  { name: 'Anna', voiceURI: 'anna', lang: 'de_DE', localService: true },
  { name: 'Online English', voiceURI: 'online-en', lang: 'en-GB', localService: false },
  { name: 'Kokoro Heart', voiceURI: 'kokoro', lang: 'en_US', localService: true },
];

test('lists every installed speech language with localized, sorted labels', () => {
  const names = { of: code => ({ de: 'German', en: 'English' })[code] };
  assert.deepEqual(speechSettings.languagesForVoices(voices, names), [
    { code: 'en', locale: 'en-gb', label: 'English' },
    { code: 'de', locale: 'de-de', label: 'German' },
  ]);
  assert.deepEqual(speechSettings.languagesForVoices([{ lang: 'xx' }], { of: () => { throw new Error('unsupported'); } }), [
    { code: 'xx', locale: 'xx', label: 'XX' },
  ]);
  assert.deepEqual(speechSettings.languagesForVoices(null, null), []);
  assert.deepEqual(speechSettings.languagesForVoices([{ lang: '' }, null, { lang: 'en-US' }, { lang: 'en-GB' }], null), [
    { code: 'en', locale: 'en-us', label: 'EN' },
  ]);
});

test('filters by language and puts preferred installed voices first', () => {
  assert.deepEqual(
    speechSettings.voicesForLanguage(voices, 'en-US', /kokoro/i).map(voice => voice.voiceURI),
    ['kokoro', 'online-en'],
  );
  assert.deepEqual(speechSettings.voicesForLanguage(voices, 'fr', /kokoro/i), []);
  assert.deepEqual(speechSettings.voicesForLanguage(null, 'fr'), []);
  assert.deepEqual(
    speechSettings.voicesForLanguage([
      { name: 'Zulu', voiceURI: 'z', lang: 'en', localService: true },
      { name: 'Alpha', voiceURI: 'a', lang: 'en', localService: false },
    ], 'en').map(voice => voice.voiceURI),
    ['z', 'a'],
  );
});

test('reads per-language selections and migrates legacy English and Portuguese values', () => {
  assert.equal(speechSettings.languageCode('PT_pt'), 'pt');
  assert.equal(speechSettings.savedVoice({ speechVoices: { de: 'anna' } }, 'de-DE'), 'anna');
  assert.equal(speechSettings.savedVoice({ speechVoiceEnglish: 'legacy-en' }, 'en'), 'legacy-en');
  assert.equal(speechSettings.savedVoice({ speechVoicePortuguese: 'legacy-pt' }, 'pt'), 'legacy-pt');
  assert.equal(speechSettings.savedVoice({}, 'fr'), '');
  assert.equal(speechSettings.savedVoice({ speechVoices: { fr: 3 } }, 'fr'), '');
});

test('exposes the helper in a browser without CommonJS', () => {
  const source = fs.readFileSync(require.resolve('../speech-settings.js'), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.BookstrSpeechSettings.languageCode('ES_es'), 'es');
});
