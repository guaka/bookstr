const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preloadPath = path.join(__dirname, '../../preload.js');

function createPreload(options = {}) {
  const calls = [];
  const listeners = new Map();
  let keydownListener;
  let bridge;
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        assert.equal(name, 'bookstrDesktop');
        bridge = value;
      },
    },
    ipcRenderer: {
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      send(...args) {
        calls.push({ kind: 'send', args });
      },
      invoke(...args) {
        calls.push({ kind: 'invoke', args });
        if (options.rejectInvokes) return Promise.reject(new Error('IPC unavailable'));
        return Promise.resolve({ ok: true });
      },
    },
  };
  const context = {
    exports: {},
    require(name) {
      assert.equal(name, 'electron');
      return electron;
    },
    window: {
      addEventListener(name, listener) {
        assert.equal(name, 'keydown');
        keydownListener = listener;
      },
    },
    process: { platform: 'darwin' },
  };
  vm.runInNewContext(fs.readFileSync(preloadPath, 'utf8'), context, { filename: preloadPath });
  assert.ok(bridge, 'preload exposes the bridge');
  return { bridge, calls, listeners, keydown: keydownListener };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('preload bridge exposes the complete version 1 surface', () => {
  const { bridge } = createPreload();
  assert.equal(bridge.version, 1);
  assert.deepEqual(Object.keys(bridge), [
    'catalog', 'version', 'signer', 'openReader', 'focusLibrary', 'openPane', 'openExternal',
    'platform', 'speechModels', 'onProgress', 'onOpenReader', 'onOpenSettings', 'onOpenPane',
    'reportProgress', 'library', 'kindle', 'devices', 'transfers',
  ]);
  assert.equal(bridge.platform(), 'darwin');
});

test('preload methods preserve their IPC channels, arguments, and optional defaults', async () => {
  const { bridge, calls } = createPreload();
  const record = { md5: 'aabb' };
  const methods = [
    ['catalog.get', () => bridge.catalog.get(), 'bookstr-desktop-catalog-current'],
    ['signer.status', () => bridge.signer.status(), 'bookstr-desktop-signer-status'],
    ['signer.connectNip46', () => bridge.signer.connectNip46('input'), 'bookstr-desktop-signer-connect-nip46', 'input'],
    ['signer.startNip46Qr', () => bridge.signer.startNip46Qr(), 'bookstr-desktop-signer-start-nip46-qr'],
    ['signer.nip46QrStatus', () => bridge.signer.nip46QrStatus(), 'bookstr-desktop-signer-nip46-qr-status'],
    ['signer.cancelNip46Qr', () => bridge.signer.cancelNip46Qr(), 'bookstr-desktop-signer-cancel-nip46-qr'],
    ['signer.setNsec', () => bridge.signer.setNsec('secret'), 'bookstr-desktop-signer-set-nsec', 'secret'],
    ['signer.disconnect', () => bridge.signer.disconnect(), 'bookstr-desktop-signer-disconnect'],
    ['signer.getPublicKey', () => bridge.signer.getPublicKey(), 'bookstr-desktop-nostr-get-public-key'],
    ['signer.signEvent', () => bridge.signer.signEvent(record), 'bookstr-desktop-nostr-sign-event', record],
    ['signer.nip44.encrypt', () => bridge.signer.nip44.encrypt('pub', 'text'), 'bookstr-desktop-nostr-nip44-encrypt', { pubkey: 'pub', plaintext: 'text' }],
    ['signer.nip44.decrypt', () => bridge.signer.nip44.decrypt('pub', 'cipher'), 'bookstr-desktop-nostr-nip44-decrypt', { pubkey: 'pub', ciphertext: 'cipher' }],
    ['signer.nip19.npubEncode', () => bridge.signer.nip19.npubEncode('pub'), 'bookstr-desktop-nostr-nip19-npub', 'pub'],
    ['openExternal', () => bridge.openExternal('https://example.test'), 'bookstr-desktop-open-external', 'https://example.test'],
    ['speechModels.status', () => bridge.speechModels.status(), 'bookstr-desktop-speech-model-status'],
    ['speechModels.install', () => bridge.speechModels.install('model'), 'bookstr-desktop-speech-model-install', 'model'],
    ['speechModels.remove', () => bridge.speechModels.remove('model'), 'bookstr-desktop-speech-model-remove', 'model'],
    ['library.search', () => bridge.library.search({ query: 'q' }), 'bookstr-desktop-library-search', { query: 'q' }],
    ['library.getBook', () => bridge.library.getBook('id'), 'bookstr-desktop-library-book', 'id'],
    ['library.metadata', () => bridge.library.metadata('id'), 'bookstr-desktop-library-metadata', 'id'],
    ['library.importBook', () => bridge.library.importBook({ extension: 'epub' }), 'bookstr-desktop-library-import', { extension: 'epub' }],
    ['library.acquire', () => bridge.library.acquire(record), 'bookstr-desktop-library-acquire', { record }],
    ['library.acquireLibgen', () => bridge.library.acquireLibgen(record), 'bookstr-desktop-library-acquire-libgen', { book: record }],
    ['library.downloads', () => bridge.library.downloads(), 'bookstr-desktop-library-downloads'],
    ['library.enqueue', () => bridge.library.enqueue({ bookId: 'id' }), 'bookstr-desktop-library-enqueue', { bookId: 'id' }],
    ['library.retryDownload', () => bridge.library.retryDownload('id'), 'bookstr-desktop-library-retry-download', 'id'],
    ['library.linkedFolders', () => bridge.library.linkedFolders(), 'bookstr-desktop-library-linked-folders'],
    ['library.linkFolder omitted argument', () => bridge.library.linkFolder(), 'bookstr-desktop-library-link-folder', undefined],
    ['library.openReader', () => bridge.library.openReader('id'), 'bookstr-desktop-library-open-reader', 'id'],
    ['kindle.devices', () => bridge.kindle.devices(), 'bookstr-desktop-kindle-devices'],
    ['kindle.preview omitted bookId', () => bridge.kindle.preview('device'), 'bookstr-desktop-kindle-preview', 'device', undefined],
    ['kindle.transfer omitted bookId', () => bridge.kindle.transfer('device'), 'bookstr-desktop-kindle-transfer', 'device', undefined],
    ['devices.status', () => bridge.devices.status(), 'bookstr-desktop-device-status'],
    ['devices.registry', () => bridge.devices.registry(), 'bookstr-desktop-device-registry'],
    ['devices.announce default', () => bridge.devices.announce(), 'bookstr-desktop-device-announce', {}],
    ['devices.createEnvelope', () => bridge.devices.createEnvelope(record), 'bookstr-desktop-device-create-envelope', record],
    ['devices.openEnvelope', () => bridge.devices.openEnvelope(record), 'bookstr-desktop-device-open-envelope', record],
    ['devices.setRegistryEvent', () => bridge.devices.setRegistryEvent(record), 'bookstr-desktop-device-set-registry-event', record],
    ['transfers.setPreferences default', () => bridge.transfers.setPreferences(), 'bookstr-desktop-transfer-preferences', {}],
    ['transfers.status', () => bridge.transfers.status(), 'bookstr-desktop-transfer-status'],
    ['transfers.seedPublic', () => bridge.transfers.seedPublic('id'), 'bookstr-desktop-transfer-seed-public', { bookId: 'id' }],
    ['transfers.addPublic', () => bridge.transfers.addPublic(record), 'bookstr-desktop-transfer-add-public', record],
    ['transfers.downloadPublic', () => bridge.transfers.downloadPublic(record), 'bookstr-desktop-transfer-download-public', record],
    ['transfers.addPrivate', () => bridge.transfers.addPrivate(record), 'bookstr-desktop-transfer-add-private', record],
  ];

  for (const [name, call, channel, ...args] of methods) {
    await call();
    assert.deepEqual(plain(calls.at(-1)), plain({ kind: 'invoke', args: [channel, ...args] }), name);
  }
});

test('openReader and focusLibrary report failed IPC calls as false', async () => {
  const { bridge, calls } = createPreload({ rejectInvokes: true });
  assert.equal(await bridge.openReader({ md5: 'id' }), false);
  assert.equal(await bridge.focusLibrary(), false);
  assert.deepEqual(plain(calls), [
    { kind: 'invoke', args: ['bookstr-desktop-open-reader', { md5: 'id' }] },
    { kind: 'invoke', args: ['bookstr-desktop-focus-library'] },
  ]);
});

test('openReader resolves from the main-process ok flag', async () => {
  const { bridge, calls } = createPreload();
  assert.equal(await bridge.openReader({ md5: 'id' }), true);
  assert.deepEqual(plain(calls), [{ kind: 'invoke', args: ['bookstr-desktop-open-reader', { md5: 'id' }] }]);
});

test('openPane and keyboard shortcuts allow only the supported panes', () => {
  const { bridge, calls, keydown } = createPreload();
  assert.equal(bridge.openPane('reading'), true);
  assert.equal(bridge.openPane('unsupported'), false);
  assert.deepEqual(plain(calls), [{ kind: 'send', args: ['bookstr-desktop-pane-shortcut', 'reading'] }]);

  const events = [];
  const press = (key, modifiers = {}) => {
    let prevented = false;
    keydown({
      key,
      defaultPrevented: false,
      altKey: false,
      shiftKey: false,
      metaKey: true,
      ctrlKey: false,
      preventDefault() { prevented = true; },
      ...modifiers,
    });
    events.push(prevented);
  };
  press('2');
  press(',');
  press('1', { altKey: true });
  press('x');
  assert.deepEqual(events, [true, true, false, false]);
  assert.deepEqual(plain(calls.slice(1)), [
    { kind: 'send', args: ['bookstr-desktop-pane-shortcut', 'reading'] },
    { kind: 'invoke', args: ['bookstr-desktop-open-settings'] },
  ]);
});

test('listener registration, invalid callbacks, and unsubscribe behavior are stable', () => {
  const { bridge, listeners } = createPreload();
  const eventPayload = { id: 'book' };
  const calls = [];
  const registrations = [
    [bridge.onOpenReader, 'bookstr-desktop-open-reader', eventPayload],
    [bridge.onProgress, 'bookstr-desktop-reader-progress', eventPayload],
    [bridge.library.onAcquisitionProgress, 'bookstr-desktop-acquisition-progress', eventPayload],
    [bridge.library.onDownloadsChanged, 'bookstr-desktop-downloads-changed', undefined],
    [bridge.kindle.onProgress, 'bookstr-desktop-kindle-progress', eventPayload],
    [bridge.onOpenSettings, 'bookstr-desktop-open-settings', undefined],
    [bridge.onOpenPane, 'bookstr-desktop-open-pane', 'reading'],
    [bridge.speechModels.onProgress, 'bookstr-desktop-speech-model-progress', eventPayload],
  ];

  for (const [subscribe, channel] of registrations) {
    let callbackCount = 0;
    const unsubscribe = subscribe(() => { callbackCount += 1; });
    assert.equal(typeof unsubscribe, 'function', channel);
    const invalidUnsubscribe = subscribe(null);
    assert.equal(typeof invalidUnsubscribe, 'function', 'invalid callback returns a no-op function');
    assert.equal(invalidUnsubscribe(), undefined);
    const listener = listeners.get(channel);
    assert.equal(typeof listener, 'function', channel);
    listener({}, channel === 'bookstr-desktop-open-pane' ? 'reading' : eventPayload);
    assert.equal(callbackCount, 1, channel);
    assert.equal(unsubscribe(), true, `${channel} unsubscribe removes its callback`);
    listener({}, channel === 'bookstr-desktop-open-pane' ? 'reading' : eventPayload);
    assert.equal(callbackCount, 1, `${channel} unsubscribes`);
    calls.push(channel);
  }
  assert.equal(new Set(calls).size, registrations.length);

  const receivedPanes = [];
  bridge.onOpenPane(pane => receivedPanes.push(pane));
  listeners.get('bookstr-desktop-open-pane')({}, 'invalid');
  listeners.get('bookstr-desktop-open-pane')({}, 'search');
  assert.deepEqual(receivedPanes, ['search']);
});

test('invalid callback registrations return no-op unsubscribe functions', () => {
  const { bridge } = createPreload();
  const invalidRegistrations = [
    bridge.onOpenReader,
    bridge.onProgress,
    bridge.onOpenSettings,
    bridge.onOpenPane,
    bridge.speechModels.onProgress,
    bridge.library.onAcquisitionProgress,
    bridge.library.onDownloadsChanged,
    bridge.kindle.onProgress,
  ];
  for (const register of invalidRegistrations) {
    const unsubscribe = register(null);
    assert.equal(typeof unsubscribe, 'function');
    assert.equal(unsubscribe(), undefined);
  }
});

test('a throwing callback does not stop later listeners from receiving events', () => {
  const { bridge, listeners } = createPreload();
  const eventPayload = { id: 'book' };
  const cases = [
    [bridge.onOpenReader, 'bookstr-desktop-open-reader', eventPayload],
    [bridge.onProgress, 'bookstr-desktop-reader-progress', eventPayload],
    [bridge.library.onAcquisitionProgress, 'bookstr-desktop-acquisition-progress', eventPayload],
    [bridge.onOpenSettings, 'bookstr-desktop-open-settings', undefined],
    [bridge.onOpenPane, 'bookstr-desktop-open-pane', 'words'],
    [bridge.speechModels.onProgress, 'bookstr-desktop-speech-model-progress', eventPayload],
  ];

  for (const [subscribe, channel, payload] of cases) {
    let received = 0;
    subscribe(() => { throw new Error(`listener failure: ${channel}`); });
    subscribe(() => { received += 1; });
    listeners.get(channel)({}, payload);
    assert.equal(received, 1, channel);
  }
});

test('reportProgress preserves its normalized IPC payload and skips missing ids', () => {
  const { bridge, calls } = createPreload();
  bridge.reportProgress({ md5: '', progression: 'invalid' });
  bridge.reportProgress({ md5: 'AABB', readUrl: 'https://book.test', progression: 0.5, extension: 'PDF' });
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0]), {
    kind: 'send',
    args: ['bookstr-desktop-report-progress', {
      md5: 'aabb', readUrl: 'https://book.test', progression: 0.5, cfi: '', title: '', authors: '',
      year: '', extension: 'pdf', source: '', sourceNativeId: '', sourceUrl: '', blossomUrl: '',
      blossomSha256: '', rights_status: 'unknown', license: '', license_url: '', rights_source: '',
      furthestProgression: 0,
    }],
  });
});
