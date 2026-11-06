const assert: typeof import('node:assert/strict') = require('node:assert/strict');
const { EventEmitter } = require('node:events') as typeof import('node:events');
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');
const test = require('node:test') as typeof import('node:test');
const { MtpKindles } = require('../../kindle-mtp') as typeof import('../../src/kindle-mtp');
const { MtpSession } = require('../../mtp-session') as typeof import('../../src/mtp-session');

type SessionOptions = Exclude<ConstructorParameters<typeof MtpSession>[0], undefined>;
type SpawnProcess = NonNullable<SessionOptions['spawnProcess']>;
type Child = ReturnType<SpawnProcess>;
type Emitter = InstanceType<typeof EventEmitter>;
type ChildMock = Emitter & {
  stdout: Emitter;
  stderr: Emitter;
  stdin: Emitter & { write(line: string): boolean; end(): void };
  kill(signal?: NodeJS.Signals): boolean;
};
type SessionHarness = { pending: unknown; child: Child | null };
const internals = (session: InstanceType<typeof MtpSession>): SessionHarness =>
  session as unknown as SessionHarness;
type TransportHarness = { session: unknown | null };
const transportHarness = (transport: InstanceType<typeof MtpKindles>): TransportHarness =>
  transport as unknown as TransportHarness;

function fakeSpawn(script: (line: string, child: Child) => void): SpawnProcess {
  return () => {
    const child = new EventEmitter() as ChildMock;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter() as ChildMock['stdin'];
    child.stdin.write = line => {
      queueMicrotask(() => script(String(line), child as unknown as Child));
      return true;
    };
    child.stdin.end = () => child.emit('close', 0, null);
    child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
    queueMicrotask(() => child.stdout.emit('data', Buffer.from('libmtp adapter diagnostic\n{"ready":true,"freeBytes":123456}\n')));
    return child as unknown as Child;
  };
}

test('session serializes commands and surfaces progress and completion', async () => {
  const progress: Array<Record<string, unknown>> = [];
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    onProgress: value => progress.push(value),
    spawnProcess: fakeSpawn((line, child) => {
      if (line === 'files\n') {
        child.stdout.emit('data', Buffer.from('[{"id":"1","name":"a.pdf","size":9}]\n{"complete":true}\n'));
      } else if (line.startsWith('put\t')) {
        child.stdout.emit('data', Buffer.from('{"progress":true,"phase":"copying","percent":50}\n{"id":"42"}\n{"complete":true}\n'));
      }
    }),
  });
  const files = await session.command('files');
  assert.deepEqual(files, [{ id: '1', name: 'a.pdf', size: 9 }]);
  assert.equal(session.freeBytes, 123456);
  const put = await session.command('put', '/tmp/a.pdf', 'a.pdf');
  assert.deepEqual(put, { id: '42' });
  assert.deepEqual(progress, [{ phase: 'copying', percent: 50 }]);
  await session.close();
});

test('session rejects invalid args oversized responses and helper errors', async () => {
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    spawnProcess: fakeSpawn((line, child) => {
      if (line === 'files\n') {
        child.stdout.emit('data', Buffer.from(`${'x'.repeat(17 * 1024 * 1024)}\n`));
      } else if (line.startsWith('get\t')) {
        child.stdout.emit('data', Buffer.from('{"error":"Kindle operation failed"}\n'));
      }
    }),
  });
  await assert.rejects(() => session.command('put', 'one-arg-only'), /Invalid Kindle operation/);
  await assert.rejects(() => session.command('files', 'extra'), /Invalid Kindle operation/);
  await assert.rejects(() => session.command('put', 'path\tbad', 'name.pdf'), /Invalid Kindle operation/);
  await assert.rejects(() => session.command('files'), /size limits/);
  const retry = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    spawnProcess: fakeSpawn((line, child) => {
      if (line.startsWith('get\t')) {
        child.stdout.emit('data', Buffer.from('{"error":"Kindle operation failed"}\n'));
      }
    }),
  });
  await assert.rejects(() => retry.command('get', '1', '/tmp/out.pdf'), /Kindle operation failed/);
});

test('session rejects timed out replies and invalid ready handshakes', async () => {
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 30,
    spawnProcess: fakeSpawn((line, _child) => {
      if (line === 'files\n') {
        // Leave the response hanging so the operation timer fires.
      }
    }),
  });
  await assert.rejects(() => session.command('files'), /timed out/);

  const badReady = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    spawnProcess: () => {
      const child = new EventEmitter() as ChildMock;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter() as ChildMock['stdin'];
      child.stdin.write = () => true;
      child.stdin.end = () => child.emit('close', 0, null);
      child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"ready":true,"freeBytes":-1}\n')));
      return child as unknown as Child;
    },
  });
  await assert.rejects(() => badReady.command('files'), /Invalid Kindle session response/);
});

test('session routes pipe and process errors to the pending command', async () => {
  for (const [event, message] of [['stdin-error', 'pipe failed'], ['process-error', 'spawn failed']] as const) {
    const session = new MtpSession({
      helper: '/tmp/kindle-mtp',
      deviceId: '1-2',
      timeout: 2000,
      spawnProcess: fakeSpawn((line, child) => {
        if (line.startsWith('files')) {
          queueMicrotask(() => {
            if (event === 'stdin-error') child.stdin.emit('error', new Error(message));
            else child.emit('error', new Error(message));
          });
        }
      }),
    });

    await assert.rejects(() => session.command('files'), new RegExp(message));
  }
});

test('session rejects synchronous helper spawn failures without leaving a pending handshake', async () => {
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    spawnProcess: () => { throw new Error('helper could not start'); },
  });
  await assert.rejects(() => session.command('files'), /helper could not start/);
  assert.equal(internals(session).pending, null);
});

test('session close timeout kills a helper that does not exit on stdin end', async () => {
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    spawnProcess: fakeSpawn((line, child) => {
      if (line === 'files\n') child.stdout.emit('data', Buffer.from('[]\n{"complete":true}\n'));
    }),
  });
  await session.command('files');
  const originalSetTimeout = global.setTimeout;
  let killed = false;
  try {
    global.setTimeout = ((callback: () => void) => {
      callback();
      return {};
    }) as unknown as typeof global.setTimeout;
    const child = internals(session).child!;
    const originalKill = child.kill;
    child.kill = signal => { killed = true; originalKill(signal); return true; };
    await session.close();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(killed, true);
});

test('session accepts stderr diagnostics and ignores progress without a handler', async () => {
  const session = new MtpSession({
    helper: '/tmp/kindle-mtp',
    deviceId: '1-2',
    timeout: 2000,
    spawnProcess: () => {
      const child = new EventEmitter() as ChildMock;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter() as ChildMock['stdin'];
      child.stdin.write = (line: string) => {
        if (line === 'files\n') queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"progress":true,"phase":"checking"}\n[]\n{"complete":true}\n')));
        return true;
      };
      child.stdin.end = () => child.emit('close', 0, null);
      child.kill = () => { child.emit('close', null, 'SIGTERM'); return true; };
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('adapter diagnostic'));
        child.stdout.emit('data', Buffer.from('{"ready":true,"freeBytes":1}\n'));
      });
      return child as unknown as Child;
    },
  });

  assert.deepEqual(await session.command('files'), []);
  await session.close();
});

test('MTP withSession retains successful sessions, enforces free space, and closes on shutdown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-mtp-session-'));
  const helper = path.join(root, 'kindle-mtp');
  await fs.writeFile(helper, 'fixture');
  let openCount = 0;
  let closed = 0;
  try {
    const transport = new MtpKindles({
      platform: 'darwin',
      resourcesPath: root,
      stagingRoot: path.join(root, 'staging'),
      sessionFactory: ({ deviceId }) => {
        openCount += 1;
        return {
          deviceId,
          freeBytes: 10,
          command: async () => [],
          close: async () => { closed += 1; },
        };
      },
    });
    const device: Parameters<typeof transport.withSession>[0] = { id: 'mtp:darwin:1-2', helperId: '1-2', name: 'Kindle', kind: 'mtp' };
    await transport.withSession(device, async () => {
      assert.equal(openCount, 1);
      assert.throws(() => transport.ensureSpace(11), /enough free space/);
      transport.ensureSpace(5);
      assert.equal(closed, 0);
    });
    assert.ok(transportHarness(transport).session);
    await transport.withSession(device, async () => { assert.equal(openCount, 1); });
    assert.equal(closed, 0);
    await transport.close();
    assert.equal(transportHarness(transport).session, null);
    assert.equal(closed, 1);

    const active = new MtpKindles({
      platform: 'darwin',
      resourcesPath: root,
      stagingRoot: path.join(root, 'staging'),
      sessionFactory: ({ deviceId }) => ({
        deviceId,
        freeBytes: 100,
        command: async (action, ...args) => {
          if (action === 'files') return [];
          throw new Error(`unexpected ${action} ${args.join(' ')}`);
        },
        close: async () => {},
      }),
    });
    await active.withSession(device, async () => {});
    await assert.rejects(
      () => active.withSession({ id: 'mtp:darwin:9-9', helperId: '9-9', name: 'Kindle', kind: 'mtp' }, async () => {}),
      /different Kindle session/,
    );
    await assert.rejects(() => active.command('files', '9-9'), /Kindle device changed/);
    await active.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('session rejects malformed JSON and structurally invalid command replies', async () => {
  for (const [action, args, reply, expected] of [
    ['files', [], '{"broken":\n', /Invalid Kindle response/],
    ['files', [], '{"ok":true}\n{"complete":true}\n', /Invalid Kindle operation response/],
    ['get', ['1', '/tmp/out.pdf'], '{"ok":false}\n{"complete":true}\n', /Invalid Kindle operation response/],
    ['put', ['/tmp/in.pdf', 'in.pdf'], '{"id":"0"}\n{"complete":true}\n', /Invalid Kindle operation response/],
  ] as const) {
    const session = new MtpSession({ helper: '/tmp/kindle-mtp', deviceId: '1-2', timeout: 2000,
      spawnProcess: fakeSpawn((_line, child) => child.stdout.emit('data', Buffer.from(reply))) });
    await assert.rejects(session.command(action, ...args), expected);
    await session.close();
  }
  const session = new MtpSession({ helper: '/tmp/kindle-mtp', deviceId: '1-2', timeout: 2000,
    spawnProcess: fakeSpawn((_line, child) => child.stdout.emit('data', Buffer.from('{"ok":true}\n{"complete":true}\n'))) });
  assert.deepEqual(await session.command('get', '1', '/tmp/out.pdf'), { ok: true });
  await session.close();
});

test('MTP commands report a missing adapter before starting a helper', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bookstr-missing-mtp-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const transport = new MtpKindles({ platform: 'linux', resourcesPath: root, stagingRoot: path.join(root, 'staging'),
    runner: async () => { assert.fail('missing adapters must not start'); } });
  await assert.rejects(transport.command('devices'), /adapter is unavailable/);
  await transport.close();
});
