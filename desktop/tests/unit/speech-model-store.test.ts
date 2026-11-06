const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');

const { SPEECH_MODELS, SpeechModelStore, sourceUrl } = require('../../speech-model-store') as typeof import('../../src/speech-model-store');
type SpeechModel = import('../../src/speech-model-store').SpeechModel;
type SpeechModelStoreInstance = import('../../src/speech-model-store').SpeechModelStore;
type SpeechModelProgress = import('../../src/speech-model-store').SpeechModelProgress;
interface SpeechStoreTestHarness { active: { id: string; completedFiles: number } | null; lastError: Map<string, string> }
const testState = (store: SpeechModelStoreInstance): SpeechStoreTestHarness => store as unknown as SpeechStoreTestHarness;

test('desktop catalog matches the pinned iOS speech model catalog', () => {
  assert.equal(SPEECH_MODELS.length, 2);
  assert.equal(SPEECH_MODELS[0]!.files.length, 11);
  assert.equal(SPEECH_MODELS[1]!.files.length, 9);
  assert.equal(SPEECH_MODELS[0]!.files.reduce((sum, file) => sum + file.expectedBytes, 0), 352_148_969);
  assert.equal(SPEECH_MODELS[1]!.files.reduce((sum, file) => sum + file.expectedBytes, 0), 63_939_446);
  assert.equal(sourceUrl(SPEECH_MODELS[1]!, SPEECH_MODELS[1]!.files[3]!),
    'https://huggingface.co/csukuangfj/vits-piper-pt_PT-tugao-medium/resolve/612042d3d5a504d6c65080b1b2b2f7981b831954/espeak-ng-data/lang/roa/pt');
});

test('installs verified files atomically, reports progress, and removes a model', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0]!, files: [{ path: 'nested/model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  const store = new SpeechModelStore(root, {
    models: [fixture],
    randomId: () => 'fixture',
    downloader: async (_url, destination, _expected, onBytes) => {
      await fs.writeFile(destination, 'test');
      onBytes(4, 4);
    },
  });
  const progress: SpeechModelProgress[] = [];
  await store.install(fixture.id, update => progress.push(update));
  assert.equal(await store.isInstalled(fixture), true);
  assert.equal(progress.at(-1)!.completedFiles, 1);
  assert.equal((await store.status()).find(model => model.id === fixture.id)!.installed, true);
  await store.install(fixture.id);
  await store.remove(fixture.id);
  assert.equal(await store.isInstalled(fixture), false);
});

test('rejects unknown, concurrent, corrupt, and failed downloads without partial installs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0]!, files: [{ path: 'model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  const store = new SpeechModelStore(root, { models: [fixture], randomId: () => 'bad', downloader: async (_url, destination) => fs.writeFile(destination, 'no') });
  await assert.rejects(store.install('missing'), /Unknown/);
  testState(store).active = { id: 'other', completedFiles: 0 };
  await assert.rejects(store.install(fixture.id), /already downloading/);
  testState(store).active = null;
  await assert.rejects(store.install(fixture.id), /verification/);
  assert.equal(await store.isInstalled(fixture), false);
  assert.match(testState(store).lastError.get(fixture.id)!, /verification/);
  testState(store).active = { id: fixture.id, completedFiles: 0 };
  await assert.rejects(store.remove(fixture.id), /still downloading/);
  testState(store).active = null;
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
  const updates: Array<[number, number]> = [];
  await store.download('https://example.test/model', destination, 4, (received, total) => updates.push([received, total]));
  assert.equal(await fs.readFile(destination, 'utf8'), 'test');
  assert.deepEqual(updates.at(-1), [4, 4]);
  global.fetch = async () => new Response('missing', { status: 404 });
  await assert.rejects(store.download('https://example.test/missing', destination, 7, () => {}), /404/);
  global.fetch = async () => ({ ok: true, body: null, status: 200 }) as Response;
  await assert.rejects(store.download('https://example.test/bodyless', destination, 0, () => {}), /200/);
  global.fetch = async () => new Response('no', { status: 200 });
  await assert.rejects(store.download('https://example.test/short', destination, 4, () => {}), /expected 4/);
  global.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken stream')); } }), { status: 200 });
  await assert.rejects(store.download('https://example.test/broken', destination, 4, () => {}), /broken stream/);
});

test('default downloader reports each streamed chunk and writes chunks in order', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'download.bin');
  const store = new SpeechModelStore(root);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('abc'));
      controller.enqueue(new TextEncoder().encode('def'));
      controller.close();
    },
  }), { status: 200 });
  const updates: Array<[number, number]> = [];
  await store.download('https://example.test/chunked', destination, 6, (received, total) => updates.push([received, total]));
  assert.equal(await fs.readFile(destination, 'utf8'), 'abcdef');
  assert.deepEqual(updates, [[3, 6], [6, 6]]);
});

test('default downloader handles partial file writes and rejects bytes beyond the declared size', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'download.bin');
  let writeMode: 'partial' | 'stalled' = 'partial';
  const fileSystem = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === 'open') return async (...args: Parameters<typeof fs.open>) => {
        const handle = await fs.open(...args);
        const write = handle.write.bind(handle);
        return Object.assign(handle, {
          write: (buffer: Uint8Array, offset: number, length: number, position: number) => writeMode === 'stalled'
            ? Promise.resolve({ bytesWritten: 0, buffer })
            : write(buffer, offset, Math.min(length, 1), position),
        });
      };
      return Reflect.get(target, property, receiver);
    },
  }) as typeof fs;
  const store = new SpeechModelStore(root, { fileSystem });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('test', { status: 200 });
  await store.download('https://example.test/partial', destination, 4, () => {});
  assert.equal(await fs.readFile(destination, 'utf8'), 'test');
  global.fetch = async () => new Response('too long', { status: 200 });
  await assert.rejects(store.download('https://example.test/long', destination, 4, () => {}), /more than expected/);
  assert.equal((await fs.stat(destination)).size, 0);
  writeMode = 'stalled';
  global.fetch = async () => new Response('test', { status: 200 });
  await assert.rejects(store.download('https://example.test/stalled-write', destination, 4, () => {}), /Could not write/);
});

test('default downloader times out when a response stream stalls', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new SpeechModelStore(root, { downloadTimeoutMs: 5 });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const fetchSignals: AbortSignal[] = [];
  global.fetch = async (_input, init) => {
    if (init?.signal) fetchSignals.push(init.signal);
    return new Promise<Response>(() => {});
  };
  await assert.rejects(store.download('https://example.test/stalled-fetch', path.join(root, 'fetch.bin'), 4, () => {}), /timed out/);
  assert.equal(fetchSignals[0]?.aborted, true);
  global.fetch = async () => new Response(new ReadableStream({ pull() {} }), { status: 200 });
  await assert.rejects(store.download('https://example.test/stalled', path.join(root, 'stalled.bin'), 4, () => {}), /timed out/);
});

test('installation lock is claimed before installed-state checks await filesystem access', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0]!, files: [{ path: 'model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  let notifyStatStarted!: () => void;
  let finishStat!: () => void;
  const statStarted = new Promise<void>(resolve => { notifyStatStarted = resolve; });
  const statGate = new Promise<void>(resolve => { finishStat = resolve; });
  let waiting = true;
  const fileSystem = new Proxy(fs, {
    get(target, property, receiver) {
      if (property === 'stat') return async (...args: Parameters<typeof fs.stat>) => {
        if (waiting) {
          waiting = false;
          notifyStatStarted();
          await statGate;
        }
        return fs.stat(...args);
      };
      return Reflect.get(target, property, receiver);
    },
  }) as typeof fs;
  const store = new SpeechModelStore(root, {
    models: [fixture, SPEECH_MODELS[1]!], fileSystem,
    downloader: async (_url, destination) => fs.writeFile(destination, 'test'),
  });
  const firstInstall = store.install(fixture.id);
  await statStarted;
  await assert.rejects(store.install(fixture.id), /already downloading/);
  finishStat();
  await firstInstall;
  assert.equal(await store.isInstalled(fixture), true);
  assert.equal((await store.status())[0]!.installing, false);
  await store.install(fixture.id);
  assert.equal((await store.status())[0]!.installing, false);
});

test('default install dependencies and callback complete a verified download', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0]!, files: [{ path: 'model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response('test', { status: 200 });
  const store = new SpeechModelStore(root, { models: [fixture] });
  await store.install(fixture.id);
  assert.equal(await store.isInstalled(fixture), true);
});

test('status exposes active progress and errors while installation checks reject directories and wrong sizes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = { ...SPEECH_MODELS[0]!, files: [{ path: 'model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  const second = { ...SPEECH_MODELS[1]!, files: [{ path: 'model.bin', expectedBytes: 2 }] } satisfies SpeechModel;
  const store = new SpeechModelStore(root, { models: [first, second] });
  await fs.mkdir(path.join(root, first.id, 'model.bin'), { recursive: true });
  assert.equal(await store.isInstalled(first), false);
  await fs.rm(path.join(root, first.id, 'model.bin'), { recursive: true });
  await fs.writeFile(path.join(root, first.id, 'model.bin'), 'no');
  assert.equal(await store.isInstalled(first), false);
  testState(store).active = { id: first.id, completedFiles: 3 };
  testState(store).lastError.set(second.id, 'fixture failure');
  const status = await store.status();
  assert.deepEqual(status.map(model => ({ id: model.id, installing: model.installing, completedFiles: model.completedFiles, error: model.error })), [
    { id: first.id, installing: true, completedFiles: 3, error: '' },
    { id: second.id, installing: false, completedFiles: 0, error: 'fixture failure' },
  ]);
});

test('non-Error download failures are retained as readable model errors', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-speech-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = { ...SPEECH_MODELS[0]!, files: [{ path: 'model.bin', expectedBytes: 4 }] } satisfies SpeechModel;
  const store = new SpeechModelStore(root, { models: [fixture], downloader: async () => { throw 'fixture string'; } });
  await assert.rejects(store.install(fixture.id));
  assert.equal(testState(store).lastError.get(fixture.id)!, 'fixture string');
});
