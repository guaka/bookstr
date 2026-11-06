const { test } = require('node:test') as typeof import('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs = require('node:fs/promises') as typeof import('node:fs/promises');
const path = require('node:path') as typeof import('node:path');
const { DesktopStateStore } = require('../../desktop-state') as typeof import('../../src/desktop-state');

async function withState(run: (filename: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(__dirname, '.desktop-state-'));
  try { await run(path.join(root, 'state.json')); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('state saves serialize concurrent patches and preserve nested signer state', () => withState(async filename => {
  const store = new DesktopStateStore(filename);
  assert.deepEqual(await store.load(), {});
  await store.save({ desktopNostr: { pubkey: 'key', mode: 'local' }, untouched: true });
  await Promise.all([
    store.save({ desktopNostr: { mode: 'remote' } }),
    store.save({ windowBounds: { width: 800 } }),
    store.save({ torrentPreferences: { autoSeed: false } }),
  ]);
  assert.deepEqual(await store.load(), {
    desktopNostr: { pubkey: 'key', mode: 'remote' }, untouched: true,
    windowBounds: { width: 800 }, torrentPreferences: { autoSeed: false },
  });
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readdir(path.dirname(filename)), ['state.json']);
}));

test('state readers see the old document until the atomic rename', () => withState(async filename => {
  await fs.writeFile(filename, '{"old":true}');
  const store = new DesktopStateStore(filename, { ...fs, async rename(from, to) {
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { old: true });
    assert.deepEqual(JSON.parse(await fs.readFile(from, 'utf8')), { old: true, next: true });
    await fs.rename(from, to);
  } });
  await store.save({ next: true });
  assert.deepEqual(await store.load(), { old: true, next: true });
}));

test('state failures preserve the old file, clean staging, and let queued writes recover', () => withState(async filename => {
  await fs.writeFile(filename, '{"keep":true}');
  const failure = new Error('disk failure');
  let fail = true;
  const store = new DesktopStateStore(filename, { ...fs, async rename(from, to) {
    if (fail) { fail = false; throw failure; }
    await fs.rename(from, to);
  } });
  const first = store.save({ lost: true });
  const second = store.save({ recovered: true });
  await assert.rejects(first, failure);
  await second;
  assert.deepEqual(await store.load(), { keep: true, recovered: true });
  assert.deepEqual(await fs.readdir(path.dirname(filename)), ['state.json']);
}));

test('state rejects unreadable, malformed, and non-object files without replacing them', () => withState(async filename => {
  const store = new DesktopStateStore(filename);
  for (const contents of ['invalid', '[]', 'null', '42']) {
    await fs.writeFile(filename, contents);
    await assert.rejects(store.load());
    await assert.rejects(store.save({ next: true }));
    assert.equal(await fs.readFile(filename, 'utf8'), contents);
  }
  const failure = new Error('access denied');
  const unreadable = new DesktopStateStore(filename, { ...fs, async readFile() { throw failure; } });
  await assert.rejects(unreadable.load(), failure);
}));

test('state preserves the write failure even if temporary cleanup fails', () => withState(async filename => {
  const failure = new Error('write failed');
  const store = new DesktopStateStore(filename, {
    ...fs, async writeFile() { throw failure; }, async rm() { throw new Error('cleanup failed'); },
  });
  await assert.rejects(store.save({ next: true }), failure);
}));
