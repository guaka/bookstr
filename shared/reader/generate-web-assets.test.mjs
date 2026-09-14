import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assets,
  cli,
  invokeIfMain,
  parseArgs,
  run,
  sha256,
} from './generate-web-assets.mjs';

const canonical = {
  'epub.min.js': Buffer.from('epub'),
  'jszip.min.js': Buffer.from('zip'),
};

function fakeIO({ outputs = true, missing = null } = {}) {
  const files = new Map();
  for (const [name, value] of Object.entries(canonical)) {
    files.set(`/repo/shared/reader/${name}`, value);
    if (outputs && name !== missing) files.set(`/repo/web/${name}`, value);
  }
  return {
    files,
    io: {
      readFile: async (path) => {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
      writeFile: async (path, value) => files.set(path, value),
    },
  };
}

test('parses check mode and rejects unknown options', () => {
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(['--check']), { check: true });
  assert.throws(() => parseArgs(['--write']), /Unknown argument/);
});

test('copies canonical bytes and accepts identical generated assets', async () => {
  const originalAssets = { ...assets };
  try {
    for (const [name, value] of Object.entries(canonical)) assets[name] = sha256(value);
    const { files, io } = fakeIO({ outputs: false });
    assert.equal(await run([], io, '/repo'), 'generated');
    assert.deepEqual(files.get('/repo/web/epub.min.js'), canonical['epub.min.js']);
    assert.equal(await run(['--check'], io, '/repo'), 'checked');
  } finally {
    Object.assign(assets, originalAssets);
  }
});

test('rejects changed canonical bytes and missing or stale outputs', async () => {
  const originalAssets = { ...assets };
  try {
    for (const [name, value] of Object.entries(canonical)) assets[name] = sha256(value);
    assets['epub.min.js'] = sha256('different');
    await assert.rejects(run(['--check'], fakeIO().io, '/repo'), /unexpected SHA-256: epub/);

    assets['epub.min.js'] = sha256(canonical['epub.min.js']);
    const missing = fakeIO({ missing: 'epub.min.js' });
    missing.files.set('/repo/web/jszip.min.js', Buffer.from('stale'));
    await assert.rejects(
      run(['--check'], missing.io, '/repo'),
      /web\/epub\.min\.js, web\/jszip\.min\.js/,
    );
  } finally {
    Object.assign(assets, originalAssets);
  }
});

test('reports CLI failures and invokes only the matching entrypoint', async () => {
  const errors = [];
  let failures = 0;
  assert.equal(await cli([], { run: async () => 'ok' }), 'ok');
  assert.equal(await cli([], {
    run: async () => { throw new Error('broken'); },
    writeError: (message) => errors.push(message),
    fail: () => { failures += 1; },
  }), 'failed');
  assert.deepEqual(errors, ['broken\n']);
  assert.equal(failures, 1);
  assert.equal(await invokeIfMain('file:///module.mjs', ['node', '/other.mjs']), 'imported');
  assert.equal(await invokeIfMain('file:///module.mjs', ['node']), 'imported');
  assert.equal(await invokeIfMain('file:///module.mjs', ['node', '/module.mjs'], async (args) => args.length), 0);

  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const defaultErrors = [];
  try {
    process.stderr.write = (message) => { defaultErrors.push(message); return true; };
    process.exitCode = undefined;
    assert.equal(await cli(['--unknown']), 'failed');
    assert.deepEqual(defaultErrors, ['Unknown argument: --unknown\n']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  }
});

test('repository packaging consumes checked web assets', async () => {
  const desktop = JSON.parse(await readFile(new URL('../../desktop/package.json', import.meta.url), 'utf8'));
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal(desktop.scripts['check:reader-assets'], 'node ../shared/reader/generate-web-assets.mjs --check');
  for (const command of ['pack', 'dist', 'dist:linux', 'dist:win', 'dist:mac', 'dist:all']) {
    assert.equal(desktop.scripts[`pre${command}`], 'npm run check:reader-assets');
  }
  assert.ok(desktop.build.files.some((entry) => entry === '../web/**/*'
    || (entry?.from === '../web' && entry?.to === 'web' && entry.filter?.includes('**/*'))));
  assert.match(workflow, /node shared\/reader\/generate-web-assets\.mjs --check/);
});
