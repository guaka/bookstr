const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { SPEECH_MODELS, SpeechModelStore, sourceUrl } = require('../../speech-model-store');

test('desktop catalog matches the pinned iOS speech model catalog', () => {
  assert.equal(SPEECH_MODELS.length, 2);
  assert.equal(SPEECH_MODELS[0].files.length, 11);
  assert.equal(SPEECH_MODELS[1].files.length, 9);
  assert.equal(SPEECH_MODELS[0].files.reduce((sum, file) => sum + file.expectedBytes, 0), 352_148_969);
  assert.equal(SPEECH_MODELS[1].files.reduce((sum, file) => sum + file.expectedBytes, 0), 63_939_446);
  assert.equal(sourceUrl(SPEECH_MODELS[1], SPEECH_MODELS[1].files[3]),
    'https://huggingface.co/csukuangfj/vits-piper-pt_PT-tugao-medium/resolve/612042d3d5a504d6c65080b1b2b2f7981b831954/espeak-ng-data/lang/roa/pt');
});

test('installs verified files atomically, reports progress, and removes a model', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0], files: [{ path: 'nested/model.bin', expectedBytes: 4 }] };
  const store = new SpeechModelStore(root, {
    models: [fixture],
    randomId: () => 'fixture',
    downloader: async (_url, destination, _expected, onBytes) => {
      await fs.writeFile(destination, 'test');
      onBytes(4, 4);
    },
  });
  const progress = [];
  await store.install(fixture.id, update => progress.push(update));
  assert.equal(await store.isInstalled(fixture), true);
  assert.equal(progress.at(-1).completedFiles, 1);
  assert.equal((await store.status()).find(model => model.id === fixture.id).installed, true);
  await store.install(fixture.id);
  await store.remove(fixture.id);
  assert.equal(await store.isInstalled(fixture), false);
});

test('rejects unknown, concurrent, corrupt, and failed downloads without partial installs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0], files: [{ path: 'model.bin', expectedBytes: 4 }] };
  const store = new SpeechModelStore(root, { models: [fixture], randomId: () => 'bad', downloader: async (_url, destination) => fs.writeFile(destination, 'no') });
  await assert.rejects(store.install('missing'), /Unknown/);
  store.active = { id: 'other', completedFiles: 0 };
  await assert.rejects(store.install(fixture.id), /already downloading/);
  store.active = null;
  await assert.rejects(store.install(fixture.id), /verification/);
  assert.equal(await store.isInstalled(fixture), false);
  assert.match(store.lastError.get(fixture.id), /verification/);
  store.active = { id: fixture.id, completedFiles: 0 };
  await assert.rejects(store.remove(fixture.id), /still downloading/);
  store.active = null;
  await assert.rejects(store.remove('missing'), /Unknown/);
});

test('default downloader streams bytes and validates the HTTP response and size', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'download.bin');
  const store = new SpeechModelStore(root);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('test', { status: 200 });
  const updates = [];
  await store.download('https://example.test/model', destination, 4, (received, total) => updates.push([received, total]));
  assert.equal(await fs.readFile(destination, 'utf8'), 'test');
  assert.deepEqual(updates.at(-1), [4, 4]);
  global.fetch = async () => new Response('missing', { status: 404 });
  await assert.rejects(store.download('https://example.test/missing', destination, 7, () => {}), /404/);
  global.fetch = async () => new Response('no', { status: 200 });
  await assert.rejects(store.download('https://example.test/short', destination, 4, () => {}), /expected 4/);
});
