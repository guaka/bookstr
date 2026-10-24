'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MtpKindles } = require('../../kindle-mtp');
const { MtpSession } = require('../../mtp-session');

function fakeSpawn(script) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.write = line => {
      queueMicrotask(() => script(String(line), child));
      return true;
    };
    child.stdin.end = () => child.emit('close', 0, null);
    child.kill = () => child.emit('close', null, 'SIGTERM');
    queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"ready":true,"freeBytes":123456}\n')));
    return child;
  };
}

test('session serializes commands and surfaces progress and completion', async () => {
  const progress = [];
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
    spawnProcess: fakeSpawn((line, child) => {
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
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.write = () => true;
      child.stdin.end = () => child.emit('close', 0, null);
      child.kill = () => child.emit('close', null, 'SIGTERM');
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"ready":true,"freeBytes":-1}\n')));
      return child;
    },
  });
  await assert.rejects(() => badReady.command('files'), /Invalid Kindle session response/);
});

test('session routes pipe and process errors to the pending command', async () => {
  for (const [event, message] of [['stdin-error', 'pipe failed'], ['process-error', 'spawn failed']]) {
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
    global.setTimeout = callback => {
      callback();
      return {};
    };
    const child = session.child;
    const originalKill = child.kill;
    child.kill = signal => { killed = true; originalKill(signal); };
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
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.write = line => {
        if (line === 'files\n') queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"progress":true,"phase":"checking"}\n[]\n{"complete":true}\n')));
        return true;
      };
      child.stdin.end = () => child.emit('close', 0, null);
      child.kill = () => child.emit('close', null, 'SIGTERM');
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('adapter diagnostic'));
        child.stdout.emit('data', Buffer.from('{"ready":true,"freeBytes":1}\n'));
      });
      return child;
    },
  });

  assert.deepEqual(await session.command('files'), []);
  await session.close();
});

test('MTP withSession nests once, enforces free space, and closes afterward', async () => {
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
    const device = { id: 'mtp:darwin:1-2', helperId: '1-2' };
    await transport.withSession(device, async () => {
      await transport.withSession(device, async () => {
        assert.equal(openCount, 1);
        assert.throws(() => transport.ensureSpace(11), /enough free space/);
        transport.ensureSpace(5);
      });
      assert.equal(closed, 0);
    });
    assert.equal(transport.session, null);
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
    await active.withSession(device, async () => {
      await assert.rejects(
        () => active.withSession({ id: 'mtp:darwin:9-9', helperId: '9-9' }, async () => {}),
        /different Kindle session/,
      );
      await assert.rejects(() => active.command('files', '9-9'), /Kindle device changed/);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
