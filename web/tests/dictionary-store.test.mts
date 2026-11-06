import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { DictionaryPack, DictionaryStore } from '../src/dictionary-store.js';

const require = createRequire(import.meta.url);
const dictionaryStore = require('../dictionary-store.js') as {
  createDictionaryStore(factory: Pick<IDBFactory, 'open'>, databaseName?: string): DictionaryStore;
  openDictionaryStore(): DictionaryStore;
};

type Mode = 'success' | 'open-error' | 'open-error-blank' | 'open-throw' | 'read-error' | 'read-error-blank' | 'read-error-tx' | 'read-empty' | 'write-error' | 'write-error-blank' | 'abort' | 'abort-blank' | 'transaction-throw';

function fakeFactory(mode: Mode = 'success', databaseName = 'fixture-dictionaries', hasStore = false) {
  let opens = 0;
  let creates = 0;
  const rows = new Map<string, DictionaryPack>();
  const error = new DOMException('storage failed', 'UnknownError');
  let currentMode = mode;
  const factory = {
    open(name: string, version: number) {
      assert.equal(name, databaseName);
      assert.equal(version, 1);
      opens++;
      if (currentMode === 'open-throw') throw error;
      const request: Record<string, unknown> = { error: currentMode === 'open-error' ? error : null, result: undefined };
      queueMicrotask(() => {
        if (currentMode === 'open-error' || currentMode === 'open-error-blank') (request.onerror as (() => void) | null)?.();
        else {
          (request.onupgradeneeded as (() => void) | null)?.();
          (request.onsuccess as (() => void) | null)?.();
        }
      });
      request.result = {
        objectStoreNames: { contains: () => hasStore },
        createObjectStore: () => { creates++; return {}; },
        transaction: () => {
          if (currentMode === 'transaction-throw') throw error;
          const transaction: Record<string, unknown> = { error: ['write-error', 'abort', 'read-error-tx'].includes(currentMode) ? error : null };
          const store = {
            getAll() {
              const getRequest: Record<string, unknown> = { error: currentMode === 'read-error' ? error : null, result: currentMode === 'read-empty' ? null : [...rows.values()] };
              queueMicrotask(() => {
                const handler = ['read-error', 'read-error-blank', 'read-error-tx'].includes(currentMode) ? getRequest.onerror : getRequest.onsuccess;
                (handler as (() => void) | null)?.();
              });
              queueMicrotask(() => (transaction.oncomplete as (() => void) | null)?.());
              return getRequest;
            },
            put(record: DictionaryPack) { rows.set(record.id, record); return {}; },
            delete(id: string) { rows.delete(id); return {}; },
          };
          transaction.objectStore = () => store;
          queueMicrotask(() => {
            if (currentMode === 'abort' || currentMode === 'abort-blank') (transaction.onabort as (() => void) | null)?.();
            else if (currentMode === 'write-error' || currentMode === 'write-error-blank') (transaction.onerror as (() => void) | null)?.();
            else (transaction.oncomplete as (() => void) | null)?.();
          });
          return transaction;
        },
      };
      return request;
    },
  };
  return { factory: factory as unknown as Pick<IDBFactory, 'open'>, rows, opens: () => opens, creates: () => creates, setMode: (next: Mode) => { currentMode = next; } };
}

const pack: DictionaryPack = {
  id: 'en-es', source: 'en', target: 'es', label: 'English–Spanish', bytes: new ArrayBuffer(4), size: 4, lastUsed: 12,
};

test('opens the existing database once and reads, writes, and deletes dictionary packs', async () => {
  const fixture = fakeFactory();
  const store = dictionaryStore.createDictionaryStore(fixture.factory, 'fixture-dictionaries');
  assert.deepEqual(await store.records(), []);
  await store.put(pack);
  assert.deepEqual(await store.records(), [pack]);
  await store.delete(pack.id);
  assert.deepEqual(await store.records(), []);
  assert.equal(fixture.opens(), 1);
  assert.equal(fixture.creates(), 1);
});

test('retries a failed database open and rejects read and write failures', async () => {
  const openFailure = fakeFactory('open-error');
  const retryingStore = dictionaryStore.createDictionaryStore(openFailure.factory, 'fixture-dictionaries');
  await assert.rejects(retryingStore.records(), /storage failed/);
  openFailure.setMode('success');
  await retryingStore.records();
  assert.equal(openFailure.opens(), 2);

  await assert.rejects(dictionaryStore.createDictionaryStore(fakeFactory('read-error').factory, 'fixture-dictionaries').records(), /storage failed/);
  await assert.rejects(dictionaryStore.createDictionaryStore(fakeFactory('write-error').factory, 'fixture-dictionaries').put(pack), /storage failed/);
  await assert.rejects(dictionaryStore.createDictionaryStore(fakeFactory('abort').factory, 'fixture-dictionaries').delete(pack.id), /storage failed/);
});

test('retries synchronous open failures and provides an error if the browser omits it', async () => {
  const fixture = fakeFactory('open-throw');
  const store = dictionaryStore.createDictionaryStore(fixture.factory, 'fixture-dictionaries');
  await assert.rejects(store.records(), /storage failed/);
  fixture.setMode('success');
  assert.deepEqual(await store.records(), []);
  assert.equal(fixture.opens(), 2);
  await assert.rejects(dictionaryStore.createDictionaryStore(fakeFactory('open-error-blank').factory, 'fixture-dictionaries').records(), /Unable to open/);
});

test('dictionary transactions reject aborts and errors even without a request error', async () => {
  for (const mode of ['read-error-blank', 'read-error-tx', 'write-error', 'write-error-blank', 'abort', 'abort-blank', 'transaction-throw'] as const) {
    const store = dictionaryStore.createDictionaryStore(fakeFactory(mode).factory, 'fixture-dictionaries');
    await assert.rejects(store.records(), /storage failed|Unable to read|read was aborted/);
  }
  for (const mode of ['write-error-blank', 'abort-blank', 'transaction-throw'] as const) {
    const store = dictionaryStore.createDictionaryStore(fakeFactory(mode).factory, 'fixture-dictionaries');
    await assert.rejects(store.put(pack), /storage failed|Unable to update|update was aborted/);
  }
});

test('existing dictionary stores retain their schema and missing read results become empty lists', async () => {
  const fixture = fakeFactory('read-empty', 'fixture-dictionaries', true);
  assert.deepEqual(await dictionaryStore.createDictionaryStore(fixture.factory, 'fixture-dictionaries').records(), []);
  assert.equal(fixture.creates(), 0);
});

test('the default dictionary store reuses the established database and module instance', async t => {
  const fixture = fakeFactory('success', 'bookstr_dictionaries_v1');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: fixture.factory });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  const first = dictionaryStore.openDictionaryStore();
  assert.equal(first, dictionaryStore.openDictionaryStore());
  await first.put(pack);
  assert.deepEqual(await first.records(), [pack]);
  assert.equal(fixture.opens(), 1);
});

test('the page delegates dictionary persistence to the extracted module', async () => {
  const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(page, /import\('\.\/dictionary-store\.js'\)/);
  assert.match(page, /\(await dictionaryStore\(\)\)\.openDictionaryStore\(\)\.records\(\)/);
  assert.match(page, /\(await dictionaryStore\(\)\)\.openDictionaryStore\(\)\.put\(record\)/);
  assert.match(page, /\(await dictionaryStore\(\)\)\.openDictionaryStore\(\)\.delete\(id\)/);
  assert.doesNotMatch(page, /indexedDB\.open\('bookstr_dictionaries_v1'/);
});
