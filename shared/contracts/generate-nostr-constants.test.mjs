import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cli,
  invokeIfMain,
  parseArgs,
  renderJavaScript,
  renderKotlin,
  renderSwift,
  run,
  validateConstants,
} from './generate-nostr-constants.mjs';

const constants = () => ({
  version: 1,
  kinds: { progress: 30078, favorites: 30003, blossomAuthorization: 24242 },
  dTags: { favorites: 'libvault-favorites', collectionIndex: 'bookstr-collections' },
  prefixes: {
    progress: 'app.bookstr.progress.',
    favoritesChunk: 'libvault-favorites-chunk',
    collectionChunk: 'bookstr-chunk',
    vocabulary: 'app.bookstr.vocabulary.',
    snippet: 'app.bookstr.snippet.',
  },
});

test('validates the complete versioned constant source', () => {
  const value = constants();
  assert.equal(validateConstants(value), value);
  assert.throws(() => validateConstants(null), /version must be 1/);
  assert.throws(() => validateConstants({ ...value, version: 2 }), /version must be 1/);
  assert.throws(() => validateConstants({ ...value, kinds: null }), /kinds must be an object/);
  assert.throws(() => validateConstants({ ...value, kinds: [] }), /kinds must be an object/);
  assert.throws(() => validateConstants({ ...value, kinds: { ...value.kinds, extra: 1 } }), /canonical keys/);
  assert.throws(() => validateConstants({ ...value, dTags: null }), /dTags must be an object/);
  assert.throws(() => validateConstants({ ...value, prefixes: [] }), /prefixes must be an object/);
  assert.throws(() => validateConstants({ ...value, kinds: { ...value.kinds, progress: 0 } }), /invalid value/);
  assert.throws(() => validateConstants({ ...value, kinds: { ...value.kinds, progress: '30078' } }), /invalid value/);
  assert.throws(() => validateConstants({ ...value, dTags: { ...value.dTags, favorites: '' } }), /invalid value/);
  assert.throws(() => validateConstants({ ...value, dTags: { ...value.dTags, favorites: 1 } }), /invalid value/);
  assert.throws(() => validateConstants({ ...value, prefixes: { ...value.prefixes, snippet: 1 } }), /invalid value/);
});

test('renders deterministic declarations for all three client languages', () => {
  const value = constants();
  assert.match(renderJavaScript(value), /BookstrNostrConstants/);
  assert.doesNotMatch(renderKotlin(value), /BLOSSOM/);
  assert.match(renderKotlin(value), /const val PROGRESS_KIND = 30078/);
  assert.match(renderKotlin(value), /const val FAVORITES_KIND = 30003/);
  assert.match(renderSwift(value), /blossomAuthorizationKind = 24242/);
  assert.match(renderSwift(value), /static let collectionIndexDTag = "bookstr-collections"/);
  assert.equal(renderJavaScript(value), renderJavaScript(value));
});

test('argument parsing and generation support deterministic stale checks', async () => {
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(['--check']), { check: true });
  assert.throws(() => parseArgs(['--invalid']), /Unknown arguments/);
  const files = new Map([['/repo/shared/contracts/nostr-constants-v1.json', JSON.stringify(constants())]]);
  const io = {
    async readFile(path) {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    async mkdir() {},
    async writeFile(path, value) { files.set(path, value); },
  };
  assert.equal(await run([], io, '/repo'), 'generated');
  assert.equal(files.size, 4);
  assert.equal(await run(['--check'], io, '/repo'), 'checked');
  files.set('/repo/web/generated/nostr-constants-v1.js', 'stale');
  await assert.rejects(() => run(['--check'], io, '/repo'), /is stale/);
  files.delete('/repo/web/generated/nostr-constants-v1.js');
  await assert.rejects(() => run(['--check'], io, '/repo'), /is stale/);
});

test('CLI reports failures and dispatches only the invoked module', async () => {
  const errors = [];
  let failed = false;
  assert.equal(await cli([], {
    run: async () => { throw new Error('boom'); },
    writeError: value => errors.push(value),
    fail: () => { failed = true; },
  }), 'failed');
  assert.deepEqual(errors, ['boom\n']);
  assert.equal(failed, true);
  assert.equal(await cli([], { run: async () => 'ok' }), 'ok');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/other.mjs'], async () => 'called'), 'imported');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/tool.mjs'], async () => 'called'), 'called');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node'], async () => 'called'), 'imported');
});

test('default CLI handlers report invalid arguments', async () => {
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const errors = [];
  process.stderr.write = value => { errors.push(value); return true; };
  process.exitCode = 0;
  try {
    assert.equal(await cli(['--invalid']), 'failed');
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, ['Unknown arguments: --invalid\n']);
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  }
});
