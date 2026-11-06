const test: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { createAuthorizedIpcMain, isAuthorizedIpcEvent } = require('../../ipc-authorization') as typeof import('../../src/ipc-authorization');

const APP_ORIGIN = 'app://bookstr';

function webContents(url = 'app://bookstr/index.html', destroyed = false) {
  const mainFrame = { url };
  return {
    mainFrame,
    getURL: () => url,
    isDestroyed: () => destroyed,
    send() {},
  };
}

function event(sender: ReturnType<typeof webContents> | null, senderFrame: { url: string } | null = sender?.mainFrame || null) {
  return { sender: sender!, senderFrame };
}

test('IPC sender authorization accepts the live main frame for the app origin', () => {
  const library = webContents('app://bookstr/index.html');
  const reader = webContents('app://bookstr/reader.html');
  assert.equal(isAuthorizedIpcEvent(event(library), [library, reader], APP_ORIGIN), true);
  assert.equal(isAuthorizedIpcEvent(event(reader), [library, reader], APP_ORIGIN), true);
});

test('IPC sender authorization rejects destroyed and unregistered WebContents', () => {
  const registered = webContents();
  const unregistered = webContents();
  const destroyed = webContents('app://bookstr/index.html', true);
  assert.equal(isAuthorizedIpcEvent(event(unregistered), [registered], APP_ORIGIN), false);
  assert.equal(isAuthorizedIpcEvent(event(destroyed), [destroyed], APP_ORIGIN), false);
  assert.equal(isAuthorizedIpcEvent(event(null), [registered], APP_ORIGIN), false);
});

test('IPC sender authorization rejects missing, child, and nonlocal frames', () => {
  const sender = webContents();
  assert.equal(isAuthorizedIpcEvent(event(sender, null), [sender], APP_ORIGIN), false);
  assert.equal(isAuthorizedIpcEvent(event(sender, { url: 'app://bookstr/iframe.html' }), [sender], APP_ORIGIN), false);
  for (const url of [
    'https://bookstr/index.html',
    'app://bookstr.evil/index.html',
    'app://user@bookstr/index.html',
    'app://user:password@bookstr/index.html',
    'app://:password@bookstr/index.html',
    'app://bookstr:443/index.html',
    'not a URL',
  ]) {
    const framedSender = webContents(url);
    assert.equal(isAuthorizedIpcEvent(event(framedSender), [framedSender], APP_ORIGIN), false, url);
  }
});

test('IPC sender authorization requires both frame and WebContents URLs to be local', () => {
  const sender = webContents('https://outside.example/page');
  assert.equal(isAuthorizedIpcEvent(event(sender), [sender], APP_ORIGIN), false);
  const validSender = webContents();
  assert.equal(isAuthorizedIpcEvent(event(validSender), [validSender], 'invalid origin'), false);
  const localFrameRemoteContents = webContents('https://outside.example/page');
  localFrameRemoteContents.mainFrame.url = 'app://bookstr/index.html';
  assert.equal(isAuthorizedIpcEvent(event(localFrameRemoteContents), [localFrameRemoteContents], APP_ORIGIN), false);
});

test('authorized IPC registrations reject invokes and ignore events from unauthorized senders', async () => {
  let invokeListener: ((incoming: ReturnType<typeof event>, value: string) => unknown) | undefined;
  let eventListener: ((incoming: ReturnType<typeof event>, value: string) => unknown) | undefined;
  const ipcMain = {
    handle(_channel: string, listener: typeof invokeListener) { invokeListener = listener; },
    on(_channel: string, listener: typeof eventListener) { eventListener = listener; },
  };
  let expected = [webContents()];
  const registrations = createAuthorizedIpcMain(ipcMain, () => expected, APP_ORIGIN);
  let called = 0;
  registrations.handle('invoke', (_event, value) => { called += 1; return value; });
  registrations.on('event', (_event, value) => { called += 1; return value; });

  const trusted = expected[0]!;
  assert.equal(invokeListener!(event(trusted), 'ok'), 'ok');
  assert.equal(eventListener!(event(trusted), 'ok'), 'ok');
  assert.equal(called, 2);

  const hostile = webContents('https://attacker.example');
  await assert.rejects(Promise.resolve().then(() => invokeListener!(event(hostile), 'nope')), /Unauthorized IPC sender/);
  assert.equal(eventListener!(event(hostile), 'nope'), undefined);
  assert.equal(called, 2);

  expected = [];
  await assert.rejects(Promise.resolve().then(() => invokeListener!(event(trusted), 'stale')), /Unauthorized IPC sender/);
  assert.equal(eventListener!(event(trusted), 'stale'), undefined);
  assert.equal(called, 2);

  expected = [webContents()];
  const replacement = expected[0]!;
  await assert.rejects(Promise.resolve().then(() => invokeListener!(event(trusted), 'stale-window')), /Unauthorized IPC sender/);
  assert.equal(eventListener!(event(replacement), 'new-window'), 'new-window');
  assert.equal(called, 3);
});
