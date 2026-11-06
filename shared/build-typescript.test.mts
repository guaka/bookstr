import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cli, invokedModuleURL, parseArgs, run, syncBrowserWrappers, syncRuntimeOutputs } from './build-typescript.mts';

test('parses build and check modes and rejects unknown options', () => {
  assert.deepEqual(parseArgs([]), { check: false });
  assert.deepEqual(parseArgs(['--check']), { check: true });
  assert.throws(() => parseArgs(['--write']), /Usage:/);
});

test('checks generated runtime modules without modifying stale files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-shared-build-'));
  try {
    const outputRoot = join(root, '.build', 'typescript');
    const sharedRoot = root;
    await mkdir(join(outputRoot, 'contracts'), { recursive: true });
    await mkdir(join(sharedRoot, 'contracts'), { recursive: true });
    await writeFile(join(outputRoot, 'contracts', 'example.mjs'), 'export const value = 2;');
    await writeFile(join(outputRoot, 'contracts', 'readme.txt'), 'not emitted JavaScript');
    await writeFile(join(sharedRoot, 'contracts', 'example.mjs'), 'export const value = 1;');
    assert.deepEqual(await syncRuntimeOutputs(outputRoot, sharedRoot, true), ['contracts/example.mjs']);
    assert.equal(await readFile(join(sharedRoot, 'contracts', 'example.mjs'), 'utf8'), 'export const value = 1;');
    await writeFile(join(sharedRoot, 'contracts', 'example.mjs'), 'export const value = 2;');
    assert.deepEqual(await syncRuntimeOutputs(outputRoot, sharedRoot, true), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build run reports stale outputs and cleans temporary output after compiler errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-shared-build-'));
  const sharedRoot = join(root, 'shared');
  try {
    await mkdir(sharedRoot, { recursive: true });
    await assert.rejects(() => run(['--check'], {
      sharedRoot,
      repositoryRoot: root,
      compile: async () => {
        await mkdir(join(sharedRoot, '.build', 'typescript'), { recursive: true });
        await writeFile(join(sharedRoot, '.build', 'typescript', 'generated.mjs'), 'export {};');
      },
    }), /Generated shared JavaScript is stale: generated.mjs/);
    await assert.rejects(readFile(join(sharedRoot, '.build')));

    await assert.rejects(() => run([], {
      sharedRoot,
      repositoryRoot: root,
      compile: async () => {
        await mkdir(join(sharedRoot, '.build'), { recursive: true });
        throw new Error('compiler failed');
      },
    }), /compiler failed/);
    await assert.rejects(readFile(join(sharedRoot, '.build')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build run generates browser wrappers in its fixture repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-shared-build-'));
  const sharedRoot = join(root, 'shared');
  try {
    assert.equal(await run([], {
      sharedRoot,
      repositoryRoot: root,
      compile: async () => { await mkdir(join(sharedRoot, '.build', 'typescript'), { recursive: true }); },
    }), 'generated');
    for (const name of ['device-pairing-client', 'device-pairing-nip17', 'device-pairing-v1', 'device-transfer-v1']) {
      assert.equal(await readFile(join(root, 'web/shared/contracts', `${name}.mjs`), 'utf8'),
        `export * from '../../../shared/contracts/${name}.mjs';\n`);
    }
    assert.equal(await run(['--check'], {
      sharedRoot,
      repositoryRoot: root,
      compile: async () => { await mkdir(join(sharedRoot, '.build', 'typescript'), { recursive: true }); },
    }), 'checked');
    const stalePath = join(root, 'web/shared/contracts/device-transfer-v1.mjs');
    await writeFile(stalePath, 'stale wrapper');
    await assert.rejects(() => run(['--check'], {
      sharedRoot,
      repositoryRoot: root,
      compile: async () => { await mkdir(join(sharedRoot, '.build', 'typescript'), { recursive: true }); },
    }), /Generated browser re-export wrappers are stale: web\/shared\/contracts\/device-transfer-v1\.mjs/);
    assert.equal(await readFile(stalePath, 'utf8'), 'stale wrapper');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('browser wrappers are freshly generated and stale checks never write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bookstr-shared-build-'));
  const names = ['device-pairing-client', 'device-pairing-nip17', 'device-pairing-v1', 'device-transfer-v1'];
  try {
    const paths = names.map(name => `web/shared/contracts/${name}.mjs`);
    assert.deepEqual(await syncBrowserWrappers(root, true), paths);
    assert.deepEqual(await syncBrowserWrappers(root, false), []);
    for (const name of names) {
      assert.equal(await readFile(join(root, 'web/shared/contracts', `${name}.mjs`), 'utf8'),
        `export * from '../../../shared/contracts/${name}.mjs';\n`);
    }
    assert.deepEqual(await syncBrowserWrappers(root, true), []);
    await writeFile(join(root, paths[0]!), 'stale wrapper');
    assert.deepEqual(await syncBrowserWrappers(root, true), [paths[0]]);
    assert.equal(await readFile(join(root, paths[0]!), 'utf8'), 'stale wrapper');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build command regenerates checked runtime modules through the pinned local compiler', async () => {
  assert.equal(await run([]), 'generated');
  assert.equal(await run(['--check']), 'checked');
});

test('build CLI reports failures and sets a failing exit code through injected handlers', async () => {
  const errors: string[] = [];
  let failed = false;
  assert.equal(await cli(['--invalid'], {
    writeError: message => errors.push(message),
    fail: () => { failed = true; },
  }), 'failed');
  assert.deepEqual(errors, ['Usage: node shared/build-typescript.mts [--check]\n']);
  assert.equal(failed, true);

  const root = await mkdtemp(join(tmpdir(), 'bookstr-shared-build-'));
  try {
    const rawErrors: string[] = [];
    assert.equal(await cli([], {
      sharedRoot: root,
      compile: () => { throw 'compiler failed'; },
      writeError: message => rawErrors.push(message),
      fail: () => { failed = true; },
    }), 'failed');
    assert.deepEqual(rawErrors, ['compiler failed\n']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build script runs its CLI when invoked as the entrypoint', () => {
  const script = fileURLToPath(new URL('./build-typescript.mts', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--invalid'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: node shared\/build-typescript\.mts \[--check\]/);
});

test('entrypoint URL helper handles missing and present argv paths', () => {
  assert.equal(invokedModuleURL(), '');
  assert.equal(invokedModuleURL('/repo/shared/build-typescript.mts'), 'file:///repo/shared/build-typescript.mts');
});

test('browser pairing wrappers re-export canonical contracts and deployment replaces them with copies', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-web.yml', import.meta.url), 'utf8');
  for (const name of ['device-pairing-client', 'device-pairing-nip17', 'device-pairing-v1', 'device-transfer-v1']) {
    const browser = await readFile(new URL(`../web/shared/contracts/${name}.mjs`, import.meta.url), 'utf8');
    assert.equal(browser, `export * from '../../../shared/contracts/${name}.mjs';\n`);
    assert.ok(workflow.includes(`cp shared/contracts/${name}.mjs web/shared/contracts/${name}.mjs`), `${name} deployment copy is missing`);
  }
});
