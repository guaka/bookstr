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
  validateSchema,
} from './generate-provider-record-dtos.mjs';

const schema = {
  properties: { version: { const: 1 } },
  $defs: {
    providerRecord: { required: ['publicationId'] },
    rights: { properties: { status: { enum: ['unknown'] } } },
    acquisition: { properties: { format: { enum: ['epub'] } } },
  },
};

test('schema validation rejects incompatible contract shapes', () => {
  assert.throws(() => validateSchema({}), /version must be 1/);
  assert.throws(() => validateSchema({ ...schema, $defs: { ...schema.$defs, providerRecord: {} } }), /require publicationId/);
  assert.throws(() => validateSchema({ ...schema, $defs: { ...schema.$defs, rights: {} } }), /rights statuses/);
  assert.throws(() => validateSchema({ ...schema, $defs: { ...schema.$defs, acquisition: {} } }), /acquisition formats/);
  assert.equal(validateSchema(schema), schema);
});

test('renderers produce versioned wire DTOs for every client language', () => {
  assert.match(renderJavaScript(schema), /parseCatalogProviderRecordV1/);
  assert.match(renderKotlin(schema), /data class CatalogProviderRecordV1/);
  assert.match(renderSwift(schema), /struct CatalogProviderRecordV1: Codable, Equatable/);
});

test('argument parser supports generation and stale checking only', () => {
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(['--check']), { check: true });
  assert.throws(() => parseArgs(['--wat']), /Unknown arguments/);
});

test('generator writes every output and accepts deterministic check mode', async () => {
  const files = new Map([['/repo/shared/catalog/provider-records.schema.json', JSON.stringify(schema)]]);
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
  files.set('/repo/web/generated/catalog-provider-record-v1.js', 'stale');
  await assert.rejects(() => run(['--check'], io, '/repo'), /is stale/);
  files.delete('/repo/web/generated/catalog-provider-record-v1.js');
  await assert.rejects(() => run(['--check'], io, '/repo'), /is stale/);
});

test('CLI reports failures and main invocation dispatches only matching paths', async () => {
  const errors = [];
  let failed = false;
  assert.equal(await cli([], {
    run: async () => { throw new Error('boom'); },
    writeError: message => errors.push(message),
    fail: () => { failed = true; },
  }), 'failed');
  assert.deepEqual(errors, ['boom\n']);
  assert.equal(failed, true);
  assert.equal(await cli([], { run: async () => 'ok' }), 'ok');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/other.mjs'], async () => 'called'), 'imported');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/tool.mjs'], async () => 'called'), 'called');
  assert.equal(await invokeIfMain('file:///tool.mjs', ['node'], async () => 'called'), 'imported');
});

test('default CLI handlers report errors and set a failing exit code', async () => {
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const errors = [];
  process.stderr.write = message => { errors.push(message); return true; };
  process.exitCode = 0;
  try {
    assert.equal(await cli(['--invalid']), 'failed');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.equal(await invokeIfMain('file:///tool.mjs', ['node', '/tool.mjs', '--invalid']), 'failed');
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, [
      'Unknown arguments: --invalid\n',
      'Unknown arguments: --invalid\n',
    ]);
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode;
  }
});
