const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');
const test = require('node:test') as typeof import('node:test');
const { MtpKindles } = require('../../kindle-mtp') as typeof import('../../src/kindle-mtp');

type Device = Parameters<typeof MtpKindles.prototype.withSession>[0];
type Progress = Record<string, unknown>;
type TestSession = { deviceId: string; freeBytes: number | null; command(action: string, ...args: string[]): Promise<unknown>; close(): Promise<void> };
type SessionHarness = {
  helper: string;
  deviceId: string;
  onProgress(progress: Record<string, unknown>): void;
};
type TransportHarness = {
  helper: string;
  currentBook: Record<string, unknown> | undefined;
  session: (SessionHarness & TestSession) | null;
};
const internal = (transport: InstanceType<typeof MtpKindles>): TransportHarness =>
  transport as unknown as TransportHarness;
const device = (id: string, helperId: string): Device => ({ id, helperId, name: 'Kindle', kind: 'mtp' });

test('MTP sessions are retained between actions and decorate progress with current book and device', async () => {
  const progress: Progress[] = [];
  const transport = new MtpKindles({
    platform: 'darwin',
    onProgress: value => progress.push(value),
  });
  const kindle = device('mtp:darwin:1-2', '1-2');
  internal(transport).currentBook = { bookId: 'book-1', title: 'Example' };

  await transport.withSession(kindle, async () => {
    const session = internal(transport).session;
    assert.ok(session);
    assert.equal(session.helper, internal(transport).helper);
    assert.equal(session.deviceId, kindle.helperId);
    session.onProgress({ phase: 'copying', percent: 50 });
  });

  assert.deepEqual(progress, [{
    bookId: 'book-1',
    title: 'Example',
    phase: 'copying',
    percent: 50,
    deviceId: kindle.id,
  }]);
  assert.ok(internal(transport).session);
  await transport.close();
  assert.equal(internal(transport).session, null);
});

test('MTP sessions use the default no-op progress callback when none is supplied', async () => {
  const transport = new MtpKindles({ platform: 'darwin' });
  const kindle = device('mtp:darwin:3-4', '3-4');

  await transport.withSession(kindle, async () => {
    const session = internal(transport).session;
    assert.ok(session);
    assert.doesNotThrow(() => session.onProgress({ phase: 'copying' }));
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
    return { deviceId, close: async () => { closed++; }, freeBytes: 100, command: async () => [] };
  } });
  const first = device('mtp:darwin:1', '1');
  const second = device('mtp:darwin:2', '2');
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
  await assert.rejects(() => transport.command('files', first.helperId!), /transport is closed/);
});

test('idle discovery keeps sessions on errors and closes them only after confirmed absence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-retained-'));
  await fs.writeFile(path.join(root, 'kindle-mtp'), 'fixture');
  let discovery: string | Error = '[{"id":"1-2","name":"Kindle"}]';
  let closeCount = 0;
  try {
    const transport = new MtpKindles({ platform: 'darwin', resourcesPath: root, stagingRoot: root,
      runner: async () => {
        if (discovery instanceof Error) throw discovery;
        return { stdout: discovery };
      },
      sessionFactory: ({ deviceId }) => ({ deviceId, freeBytes: null, command: async () => [], close: async () => {
        closeCount++;
        if (deviceId === '1-2') throw new Error('helper already exited');
      } }),
    });
    const kindle = device('mtp:darwin:1-2', '1-2');
    await transport.withSession(kindle, async () => {});
    assert.deepEqual((await transport.devices()).map(item => item.helperId), ['1-2']);
    assert.equal(closeCount, 0);

    discovery = new Error('adapter temporarily unavailable');
    const originalWrite = process.stderr.write;
    process.stderr.write = () => true;
    try { assert.deepEqual(await transport.devices(), []); }
    finally { process.stderr.write = originalWrite; }
    assert.ok(internal(transport).session);
    assert.equal(closeCount, 0);

    discovery = '[]';
    assert.deepEqual(await transport.devices(), []);
    assert.equal(internal(transport).session, null);
    assert.equal(closeCount, 1);
    await transport.withSession(device('mtp:darwin:9-9', '9-9'), async () => {});
    assert.equal(internal(transport).session?.deviceId, '9-9');
    await transport.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('failed session startup or IO invalidates the cache so the next action can retry', async () => {
  let opens = 0;
  let closes = 0;
  const transport = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => {
    opens++;
    const attempt = opens;
    return { deviceId, freeBytes: null, close: async () => { closes++; }, command: async () => {
      if (attempt === 1) throw new Error('Kindle disconnected.');
      return [];
    } };
  } });
  const kindle = device('mtp:darwin:1-2', '1-2');
  await assert.rejects(() => transport.withSession(kindle, () => transport.command('files', kindle.helperId!)), /disconnected/);
  assert.equal(internal(transport).session, null);
  await transport.withSession(kindle, () => transport.command('files', kindle.helperId!));
  assert.equal(opens, 2);
  assert.equal(closes, 1);
  await transport.close();
  assert.equal(closes, 2);

  const recovered = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => ({
    deviceId,
    freeBytes: null,
    close: async () => {},
    command: async () => { throw new Error('Kindle operation timed out.'); },
  }) });
  await recovered.withSession(kindle, async () => {
    await assert.rejects(() => recovered.command('files', kindle.helperId!), /timed out/);
  });
  assert.equal(internal(recovered).session, null, 'caught IO failures still invalidate the retained session');

  const closeFails = new MtpKindles({ platform: 'darwin', stagingRoot: '/tmp', sessionFactory: ({ deviceId }) => ({
    deviceId,
    freeBytes: null,
    command: async () => { throw new Error('Kindle disconnected.'); },
    close: async () => { throw new Error('close failed'); },
  }) });
  await assert.rejects(() => closeFails.withSession(kindle, () => closeFails.command('files', kindle.helperId!)), /disconnected/);
  assert.equal(internal(closeFails).session, null);
});
