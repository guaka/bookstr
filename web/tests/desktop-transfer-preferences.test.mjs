import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function loadPreferenceCode(desktopBridge = null, warnings = []) {
  const start = html.indexOf('      function createSerializedPreferenceWriter(');
  const end = html.indexOf('\n      const state =', start);
  assert.notEqual(start, -1, 'preference writer exists in the desktop app');
  assert.notEqual(end, -1, 'preference writer has an isolated end marker');
  const context = vm.createContext({ Promise, desktopBridge, console: { warn: (...args) => warnings.push(args) } });
  const prefix = html.slice(0, start).replace(/[^\n]/g, ' ');
  vm.runInContext(prefix + html.slice(start, end), context, { filename: fileURLToPath(new URL('../index.html', import.meta.url)) });
  return context;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('desktop transfer preference writes preserve the latest UI change across delayed responses', async () => {
  const createWriter = loadPreferenceCode().createSerializedPreferenceWriter;
  const firstResponse = deferred();
  const secondResponse = deferred();
  const responses = [firstResponse, secondResponse];
  const writes = [];
  const stored = { downloadLimit: 10000000, uploadLimit: 1000000 };
  const writer = createWriter(async preference => {
    writes.push({ ...preference });
    await responses[writes.length - 1].promise;
    Object.assign(stored, preference);
  });
  const firstPreference = { downloadLimit: 5000000 };
  const first = writer(firstPreference);
  const second = writer({ downloadLimit: 5000000, uploadLimit: 500000 });
  firstPreference.downloadLimit = 10000000;

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [{ downloadLimit: 5000000 }]);
  firstResponse.resolve();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [
    { downloadLimit: 5000000 },
    { downloadLimit: 5000000, uploadLimit: 500000 },
  ]);
  secondResponse.resolve();
  await second;
  assert.deepEqual(stored, { downloadLimit: 5000000, uploadLimit: 500000 });
});

test('a failed preference write does not block later settings changes', async () => {
  const createWriter = loadPreferenceCode().createSerializedPreferenceWriter;
  const writes = [];
  const writer = createWriter(async preference => {
    writes.push({ ...preference });
    if (writes.length === 1) throw new Error('temporary IPC failure');
  });

  await assert.rejects(writer({ downloadLimit: 5000000 }), /temporary IPC failure/);
  await writer({ uploadLimit: 500000 });
  assert.deepEqual(writes, [
    { downloadLimit: 5000000 },
    { uploadLimit: 500000 },
  ]);
});

test('desktop preference initialization and controls use the serialized writer', () => {
  const writer = html.indexOf('      const desktopTransferPreferenceWriter = createSerializedPreferenceWriter(');
  const initialization = html.indexOf('          syncDesktopTransferPreferences({', html.indexOf('function loadState()'));
  const controls = html.slice(html.indexOf("torrentAutoDownloadInput.addEventListener('change'"), html.indexOf("speechLanguageInput.addEventListener('change'"));

  assert.notEqual(writer, -1);
  assert.notEqual(initialization, -1);
  assert.equal((controls.match(/syncDesktopTransferPreferences\(\{/g) || []).length, 4);
  assert.doesNotMatch(controls, /transfers\?\.setPreferences/);
});


test('desktop preference synchronization reports failures and continues saving', async () => {
  const warnings = [];
  const writes = [];
  const bridge = { transfers: { setPreferences: async preferences => {
    writes.push({ ...preferences });
    if (writes.length === 1) throw new Error('IPC unavailable');
  } } };
  const { syncDesktopTransferPreferences } = loadPreferenceCode(bridge, warnings);
  syncDesktopTransferPreferences({ downloadLimit: 5000000 });
  syncDesktopTransferPreferences({ uploadLimit: 500000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes, [{ downloadLimit: 5000000 }, { uploadLimit: 500000 }]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], 'Could not save desktop transfer preferences:');
  assert.match(warnings[0][1].message, /IPC unavailable/);
});

test('desktop preference synchronization tolerates unavailable bridge capabilities', async () => {
  for (const bridge of [null, {}, { transfers: {} }]) {
    const warnings = [];
    const { syncDesktopTransferPreferences } = loadPreferenceCode(bridge, warnings);
    syncDesktopTransferPreferences({ downloadLimit: 5000000 });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(warnings, []);
  }
});
