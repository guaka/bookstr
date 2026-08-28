import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cli,
  invokeIfMain,
  parseArgs,
  renderAndroid,
  renderOutputs,
  renderSwift,
  renderWeb,
  run,
  validateTokens,
} from './generate.mjs';

function tokens() {
  return {
    version: 1,
    web: {
      root: { colorScheme: 'light' },
      themes: [
        { selector: 'body.theme-light', variables: { accent: '#112233' } },
        { selector: 'body.theme-dark', colorScheme: 'dark', variables: { accent: 'rgba(1, 2, 3, 0.4)' } },
      ],
    },
    android: {
      colors: [
        { name: 'Accent', value: '#112233' },
        { name: 'AccentAlias', alias: 'Accent' },
      ],
    },
    swift: {
      colors: [{ name: 'accent', value: '#112233' }],
      readerThemes: [
        { name: 'white', background: '#FFFFFF', primary: 'accent' },
        { name: 'paper', background: '#F7F3EA', primary: 'accent' },
        { name: 'night', background: '#121212', primary: 'accent' },
      ],
    },
  };
}

test('validates the complete cross-platform token document', () => {
  const value = tokens();
  assert.equal(validateTokens(value), value);
});

test('rejects invalid roots, web themes, Android colors, and Swift roles', () => {
  assert.throws(() => validateTokens(null), /version 1/);
  assert.throws(() => validateTokens({ version: 2, web: {}, android: {}, swift: {} }), /version 1/);
  assert.throws(() => validateTokens({ version: 1, web: null, android: {}, swift: {} }), /version 1/);
  assert.throws(() => validateTokens({ version: 1, web: {}, android: null, swift: {} }), /version 1/);
  assert.throws(() => validateTokens({ version: 1, web: {}, android: {}, swift: null }), /version 1/);

  const missingRoot = tokens();
  missingRoot.web.root = {};
  assert.throws(() => validateTokens(missingRoot), /root color scheme/);

  const absentRoot = tokens();
  absentRoot.web.root = null;
  assert.throws(() => validateTokens(absentRoot), /root color scheme/);

  const missingThemes = tokens();
  missingThemes.web.themes = [];
  assert.throws(() => validateTokens(missingThemes), /Web themes/);

  const nonArrayThemes = tokens();
  nonArrayThemes.web.themes = {};
  assert.throws(() => validateTokens(nonArrayThemes), /Web themes/);

  const invalidSelector = tokens();
  invalidSelector.web.themes[0].selector = '.theme-light';
  assert.throws(() => validateTokens(invalidSelector), /target body/);

  const missingSelector = tokens();
  missingSelector.web.themes[0].selector = null;
  assert.throws(() => validateTokens(missingSelector), /target body/);

  const missingVariables = tokens();
  missingVariables.web.themes[0].variables = [];
  assert.throws(() => validateTokens(missingVariables), /include variables/);

  const absentVariables = tokens();
  absentVariables.web.themes[0].variables = null;
  assert.throws(() => validateTokens(absentVariables), /include variables/);

  const emptyVariables = tokens();
  emptyVariables.web.themes[0].variables = {};
  assert.throws(() => validateTokens(emptyVariables), /include variables/);

  const invalidScheme = tokens();
  invalidScheme.web.themes[0].colorScheme = 'sepia';
  assert.throws(() => validateTokens(invalidScheme), /invalid color scheme/);

  const invalidVariable = tokens();
  invalidVariable.web.themes[0].variables = { Accent: '' };
  assert.throws(() => validateTokens(invalidVariable), /invalid variable/);

  const nonStringVariable = tokens();
  nonStringVariable.web.themes[0].variables = { accent: 1 };
  assert.throws(() => validateTokens(nonStringVariable), /invalid variable/);

  const missingAndroid = tokens();
  missingAndroid.android.colors = [];
  assert.throws(() => validateTokens(missingAndroid), /Android colors/);

  const duplicateAndroid = tokens();
  duplicateAndroid.android.colors.push({ name: 'Accent', value: '#445566' });
  assert.throws(() => validateTokens(duplicateAndroid), /unique Kotlin names/);

  const missingAndroidColor = tokens();
  missingAndroidColor.android.colors[0] = null;
  assert.throws(() => validateTokens(missingAndroidColor), /unique Kotlin names/);

  const invalidAndroidValue = tokens();
  invalidAndroidValue.android.colors[0].value = '#123';
  assert.throws(() => validateTokens(invalidAndroidValue), /six-digit hex/);

  const nonStringAndroidValue = tokens();
  nonStringAndroidValue.android.colors[0].value = null;
  assert.throws(() => validateTokens(nonStringAndroidValue), /six-digit hex/);

  const ambiguousAndroid = tokens();
  ambiguousAndroid.android.colors[0].alias = 'Accent';
  assert.throws(() => validateTokens(ambiguousAndroid), /exactly one/);

  const invalidAlias = tokens();
  invalidAlias.android.colors[1].alias = 'Missing';
  assert.throws(() => validateTokens(invalidAlias), /earlier color/);

  const nonStringAlias = tokens();
  nonStringAlias.android.colors[1].alias = 1;
  assert.throws(() => validateTokens(nonStringAlias), /earlier color/);

  const invalidSwiftName = tokens();
  invalidSwiftName.swift.colors[0].name = 'Accent';
  assert.throws(() => validateTokens(invalidSwiftName), /lower-camel-case/);

  const missingSwiftColor = tokens();
  missingSwiftColor.swift.colors[0] = null;
  assert.throws(() => validateTokens(missingSwiftColor), /lower-camel-case/);

  const missingSwiftThemes = tokens();
  missingSwiftThemes.swift.readerThemes = [];
  assert.throws(() => validateTokens(missingSwiftThemes), /Swift reader themes/);

  const duplicateSwiftTheme = tokens();
  duplicateSwiftTheme.swift.readerThemes[2].name = 'paper';
  assert.throws(() => validateTokens(duplicateSwiftTheme), /include white, paper, and night once/);

  const missingSwiftTheme = tokens();
  missingSwiftTheme.swift.readerThemes[2] = null;
  assert.throws(() => validateTokens(missingSwiftTheme), /include white, paper, and night once/);

  const incompleteSwiftThemes = tokens();
  incompleteSwiftThemes.swift.readerThemes.pop();
  assert.throws(() => validateTokens(incompleteSwiftThemes), /include white, paper, and night once/);

  const invalidSwiftBackground = tokens();
  invalidSwiftBackground.swift.readerThemes[0].background = '#fff';
  assert.throws(() => validateTokens(invalidSwiftBackground), /six-digit hex/);

  const missingSwiftPrimary = tokens();
  missingSwiftPrimary.swift.readerThemes[0].primary = 'missing';
  assert.throws(() => validateTokens(missingSwiftPrimary), /reference a Swift color/);
});

test('renders deterministic web, Compose, and Swift declarations', () => {
  const value = tokens();
  const web = renderWeb(value);
  assert.match(web, /^\/\* Generated/);
  assert.match(web, /body\.theme-light \{\n  --accent: #112233;/);
  assert.match(web, /body\.theme-dark \{\n  color-scheme: dark;/);
  assert.equal(web, renderWeb(value));

  const android = renderAndroid(value);
  assert.match(android, /val Accent = Color\(0xFF112233\)/);
  assert.match(android, /val AccentAlias = Accent/);

  const swift = renderSwift(value);
  assert.match(swift, /static let accent = Color\(red: 17 \/ 255, green: 34 \/ 255, blue: 51 \/ 255\)/);
  assert.match(swift, /case \.white: return Color\(red: 1, green: 1, blue: 1\)/);
  assert.match(swift, /case \.night: return \.accent/);

  assert.deepEqual(Object.keys(renderOutputs(value)), [
    'web/design-tokens.css',
    'android/app/src/main/java/app/bookstr/ui/theme/Color.kt',
    'ios/BookstrIOS/Sources/Shared/Theme.swift',
  ]);
});

test('parses defaults, explicit inputs, and invalid arguments', () => {
  assert.deepEqual(parseArgs([]), { check: false, input: 'shared/design-tokens/tokens.json' });
  assert.deepEqual(parseArgs(['--check', '--input=other.json']), { check: true, input: 'other.json' });
  assert.throws(() => parseArgs(['--input=']), /requires a path/);
  assert.throws(() => parseArgs(['--output=x']), /Unknown argument/);
});

test('writes all outputs and checks every generated file for staleness', async () => {
  const files = new Map([['/repo/input.json', JSON.stringify(tokens())]]);
  const io = {
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    writeFile: async (path, value) => files.set(path, value),
  };
  assert.equal(await run(['--input=input.json'], io, '/repo'), 'generated');
  assert.equal(files.size, 4);
  assert.equal(await run(['--check', '--input=input.json'], io, '/repo'), 'checked');

  files.set('/repo/web/design-tokens.css', 'stale');
  files.delete('/repo/ios/BookstrIOS/Sources/Shared/Theme.swift');
  await assert.rejects(
    run(['--check', '--input=input.json'], io, '/repo'),
    /web\/design-tokens\.css, ios\/BookstrIOS\/Sources\/Shared\/Theme\.swift/,
  );
});

test('reports CLI errors and only invokes matching entrypoints', async () => {
  let errorText = '';
  let failed = false;
  assert.equal(await cli([], { run: async () => 'ok' }), 'ok');
  assert.equal(await cli(['--check']), 'checked');
  assert.equal(await cli([], {
    run: async () => { throw new Error('bad tokens'); },
    writeError: (message) => { errorText = message; },
    fail: () => { failed = true; },
  }), 'failed');
  assert.equal(errorText, 'bad tokens\n');
  assert.equal(failed, true);

  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let defaultError = '';
  process.stderr.write = (message) => { defaultError += message; return true; };
  process.exitCode = undefined;
  try {
    assert.equal(await cli([], { run: async () => { throw new Error('default handlers'); } }), 'failed');
    assert.equal(defaultError, 'default handlers\n');
    assert.equal(process.exitCode, 1);
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  }

  const script = new URL('./generate.mjs', import.meta.url);
  let received;
  assert.equal(await invokeIfMain(script.href, ['node', script.pathname, '--check'], async (args) => {
    received = args;
    return 'invoked';
  }), 'invoked');
  assert.deepEqual(received, ['--check']);
  assert.equal(await invokeIfMain(script.href, ['node'], async () => assert.fail('must not run')), 'imported');
  assert.equal(await invokeIfMain(script.href, ['node', '/different.mjs'], async () => assert.fail('must not run')), 'imported');
});
