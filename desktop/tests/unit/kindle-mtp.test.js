'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MtpKindles } = require('../../kindle-mtp');

test('MTP sessions are retained between actions and decorate progress with current book and device', async () => {
  const progress = [];
  const transport = new MtpKindles({
    platform: 'darwin',
    onProgress: value => progress.push(value),
  });
  const device = { id: 'mtp:darwin:1-2', helperId: '1-2' };
  transport.currentBook = { bookId: 'book-1', title: 'Example' };

  await transport.withSession(device, async () => {
    assert.equal(transport.session.helper, transport.helper);
    assert.equal(transport.session.deviceId, device.helperId);
    transport.session.onProgress({ phase: 'copying', percent: 50 });
  });

  assert.deepEqual(progress, [{
    bookId: 'book-1',
    title: 'Example',
    phase: 'copying',
    percent: 50,
    deviceId: device.id,
  }]);
  assert.ok(transport.session);
  await transport.close();
  assert.equal(transport.session, null);
});

test('MTP sessions use the default no-op progress callback when none is supplied', async () => {
  const transport = new MtpKindles({ platform: 'darwin' });
  const device = { id: 'mtp:darwin:3-4', helperId: '3-4' };

  await transport.withSession(device, async () => {
    assert.doesNotThrow(() => transport.session.onProgress({ phase: 'copying' }));
  });
  await transport.close();
});

test('MTP logical operations serialize, reuse the session, and reject a different connected Kindle', async () => {
  let active = 0;
  let maximum = 0;
  let opened = 0;
  let closed = 0;
  const transport = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => {
    opened++;
    return { deviceId, close: async () => { closed++; }, freeBytes: 100 };
  } });
  const first = { id: 'mtp:darwin:1', helperId: '1' };
  const second = { id: 'mtp:darwin:2', helperId: '2' };
  const operation = () => transport.withSession(first, async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
  });
  await Promise.all([operation(), operation()]);
  assert.equal(maximum, 1);
  assert.equal(opened, 1);
  await assert.rejects(() => transport.withSession(second, async () => {}), /different Kindle session/);
  assert.equal(closed, 0);
  await transport.close();
  assert.equal(closed, 1);
  await assert.rejects(() => transport.withSession(first, async () => {}), /transport is closed/);
  await assert.rejects(() => transport.command('files', first.helperId), /transport is closed/);
});

test('idle discovery keeps sessions on errors and closes them only after confirmed absence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-retained-'));
  await fs.writeFile(path.join(root, 'kindle-mtp'), 'fixture');
  let discovery = '[{"id":"1-2","name":"Kindle"}]';
  let closeCount = 0;
  try {
    const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: root,
      runner: async () => {
        if (discovery instanceof Error) throw discovery;
        return { stdout: discovery };
      },
      sessionFactory: ({ deviceId }) => ({ deviceId, close: async () => {
        closeCount++;
        if (deviceId === '1-2') throw new Error('helper already exited');
      } }),
    });
    const device = { id: 'mtp:darwin:1-2', helperId: '1-2', name: 'Kindle', kind: 'mtp' };
    await transport.withSession(device, async () => {});
    assert.deepEqual((await transport.devices()).map(item => item.helperId), ['1-2']);
    assert.equal(closeCount, 0);

    discovery = new Error('adapter temporarily unavailable');
    const originalWrite = process.stderr.write;
    process.stderr.write = () => true;
    try { assert.deepEqual(await transport.devices(), []); }
    finally { process.stderr.write = originalWrite; }
    assert.ok(transport.session);
    assert.equal(closeCount, 0);

    discovery = '[]';
    assert.deepEqual(await transport.devices(), []);
    assert.equal(transport.session, null);
    assert.equal(closeCount, 1);
    await transport.withSession({ id: 'mtp:darwin:9-9', helperId: '9-9' }, async () => {});
    assert.equal(transport.session.deviceId, '9-9');
    await transport.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('failed session startup or IO invalidates the cache so the next action can retry', async () => {
  let opens = 0;
  let closes = 0;
  const transport = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => {
    opens++;
    const attempt = opens;
    return { deviceId, close: async () => { closes++; }, command: async () => {
      if (attempt === 1) throw new Error('Kindle disconnected.');
      return [];
    } };
  } });
  const device = { id: 'mtp:darwin:1-2', helperId: '1-2' };
  await assert.rejects(() => transport.withSession(device, () => transport.command('files', device.helperId)), /disconnected/);
  assert.equal(transport.session, null);
  await transport.withSession(device, () => transport.command('files', device.helperId));
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  await transport.close();
  assert.equal(closes, 2);

  const recovered = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => ({
    deviceId,
    close: async () => {},
    command: async () => { throw new Error('Kindle operation timed out.'); },
  }) });
  await recovered.withSession(device, async () => {
    await assert.rejects(() => recovered.command('files', device.helperId), /timed out/);
  });
  assert.equal(recovered.session, null, 'caught IO failures still invalidate the retained session');

  const closeFails = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => ({
    deviceId,
    command: async () => { throw new Error('Kindle disconnected.'); },
    close: async () => { throw new Error('close failed'); },
  }) });
  await assert.rejects(() => closeFails.withSession(device, () => closeFails.command('files', device.helperId)), /disconnected/);
  assert.equal(closeFails.session, null);
});
