import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cli,
  invokeIfMain,
  parseArgs,
  renderOverview,
  run,
  validateInventory,
} from './generate-client-overview.mjs';

function inventory(overrides = {}) {
  const clients = ['web', 'electron', 'android', 'ios'].map((id) => ({
    id,
    label: id.toUpperCase(),
    shell: `${id} shell`,
    reader: `${id} reader`,
    speech: `${id} speech`,
    catalog: `${id} catalog`,
    persistence: `${id} persistence`,
    sharedCore: `${id} shared core`,
  }));
  return { version: 1, clients, ...overrides };
}

test('validates the complete four-client inventory', () => {
  const value = inventory();
  assert.equal(validateInventory(value), value);
});

test('rejects invalid roots, counts, missing fields, duplicates, and missing clients', () => {
  assert.throws(() => validateInventory(null), /version 1/);
  assert.throws(() => validateInventory({ version: 2, clients: [] }), /version 1/);
  assert.throws(() => validateInventory({ version: 1, clients: null }), /version 1/);
  assert.throws(() => validateInventory({ version: 1, clients: [] }), /exactly four/);

  const missingField = inventory();
  missingField.clients[0].reader = '   ';
  assert.throws(() => validateInventory(missingField), /missing reader/);

  const nonStringId = inventory();
  nonStringId.clients[0].id = null;
  assert.throws(() => validateInventory(nonStringId), /Client <unknown> is missing id/);

  const duplicate = inventory();
  duplicate.clients[1].id = 'web';
  assert.throws(() => validateInventory(duplicate), /Duplicate client id/);

  const missingClient = inventory();
  missingClient.clients[3].id = 'windows';
  assert.throws(() => validateInventory(missingClient), /must include/);
});

test('renders deterministic markdown and escapes table delimiters and whitespace', () => {
  const value = inventory();
  value.clients[0].shell = 'static | web\n shell';
  const rendered = renderOverview(value);
  assert.match(rendered, /^# Bookstr client capability matrix/);
  assert.match(rendered, /static \\| web shell/);
  assert.equal(rendered, renderOverview(value));
  assert.equal(rendered.match(/^WEB \|/gm)?.length, 1);
});

test('parses defaults and explicit command options', () => {
  assert.deepEqual(parseArgs([]), {
    check: false,
    input: 'shared/architecture/clients.json',
    output: 'docs/CLIENT_CAPABILITIES.md',
  });
  assert.deepEqual(parseArgs(['--check', '--input', 'in.json', '--output', 'out.md']), {
    check: true,
    input: 'in.json',
    output: 'out.md',
  });
  assert.throws(() => parseArgs(['--input']), /requires a path/);
  assert.throws(() => parseArgs(['--output', '--check']), /requires a path/);
  assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
});

test('generates output and accepts an identical checked result', async () => {
  const files = new Map([['/repo/input.json', JSON.stringify(inventory())]]);
  const io = {
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    writeFile: async (path, value) => files.set(path, value),
  };

  assert.equal(
    await run(['--input', 'input.json', '--output', 'output.md'], io, '/repo'),
    'generated',
  );
  assert.match(files.get('/repo/output.md'), /ELECTRON/);
  assert.equal(
    await run(['--check', '--input', 'input.json', '--output', 'output.md'], io, '/repo'),
    'checked',
  );
});

test('check mode rejects missing, stale, and invalid generated data', async () => {
  const files = new Map([
    ['/repo/input.json', JSON.stringify(inventory())],
    ['/repo/output.md', 'stale'],
  ]);
  const io = {
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    writeFile: async () => assert.fail('check mode must not write'),
  };

  await assert.rejects(
    run(['--check', '--input', 'input.json', '--output', 'missing.md'], io, '/repo'),
    /is stale/,
  );
  await assert.rejects(
    run(['--check', '--input', 'input.json', '--output', 'output.md'], io, '/repo'),
    /is stale/,
  );

  files.set('/repo/input.json', '{');
  await assert.rejects(
    run(['--input', 'input.json', '--output', 'output.md'], io, '/repo'),
    /Expected property name|Unexpected end/,
  );
});

test('CLI reports failures and main detection invokes only matching modules', async () => {
  let errorText = '';
  let failed = false;
  assert.equal(await cli([], { run: async () => 'ok' }), 'ok');
  assert.equal(await cli([], {
    run: async () => { throw new Error('broken inventory'); },
    writeError: (message) => { errorText = message; },
    fail: () => { failed = true; },
  }), 'failed');
  assert.equal(errorText, 'broken inventory\n');
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

  assert.equal(await cli(['--check']), 'checked');

  const script = new URL('./generate-client-overview.mjs', import.meta.url);
  let received;
  assert.equal(await invokeIfMain(script.href, ['node', script.pathname, '--check'], async (args) => {
    received = args;
    return 'invoked';
  }), 'invoked');
  assert.deepEqual(received, ['--check']);
  assert.equal(await invokeIfMain(script.href, ['node'], async () => assert.fail('must not run')), 'imported');
  assert.equal(
    await invokeIfMain(script.href, ['node', '/different.mjs'], async () => assert.fail('must not run')),
    'imported',
  );
});
