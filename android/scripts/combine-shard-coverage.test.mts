import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./combine-shard-coverage.sh', import.meta.url));
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'android-shards-'));
  function put(path: string, bytes: string) {
    const file = join(cwd, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, bytes);
    return file;
  }
  for (let index = 0; index < 4; index++) {
    put(`android/app/build/coverage/shard-${index}/full.ec`, `coverage-${index}\n`);
    put(`android/app/build/coverage/shard-${index}/native/native-coverage-collected.marker`, 'collected\n');
    put(`android/e2e-results/shard-${index}/instrumentation.xml`, '<testsuite/>');
  }
  const output = put('android/app/build/coverage/full.ec', 'stale');
  const screenshot = put('android/e2e-screenshots/shard-2/example.png', 'png');
  return { cwd, output, screenshot, put,
    run: (args = ['4']) => spawnSync('bash', [script, ...args], { cwd, encoding: 'utf8' }),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
}

test('combines all four execution streams and requires screenshots only across the complete suite', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.output, 'utf8'), 'coverage-0\ncoverage-1\ncoverage-2\ncoverage-3\n');
  } finally { f.cleanup(); }
});
for (let index = 0; index < 4; index++) {
  for (const path of [`android/app/build/coverage/shard-${index}/full.ec`, `android/app/build/coverage/shard-${index}/native/native-coverage-collected.marker`, `android/e2e-results/shard-${index}/instrumentation.xml`]) {
    for (const empty of [false, true]) {
      test(`rejects ${empty ? 'empty' : 'missing'} ${path} without retaining stale combined coverage`, () => {
        const f = fixture();
        try {
          if (empty) f.put(path, ''); else rmSync(join(f.cwd, path));
          const result = f.run();
          assert.equal(result.status, 1);
          assert.match(result.stderr, /Missing Android shard input/);
          assert.equal(existsSync(f.output), false);
        } finally { f.cleanup(); }
      });
    }
  }
}
test('rejects a complete run with no screenshots', () => {
  const f = fixture();
  try {
    rmSync(f.screenshot);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /produced no screenshots/);
    assert.equal(existsSync(f.output), false);
  } finally { f.cleanup(); }
});
for (const args of [[], ['0'], ['04'], ['100'], ['4', 'extra']]) {
  test(`rejects invalid shard count ${JSON.stringify(args)}`, () => {
    const f = fixture();
    try { assert.equal(f.run(args).status, 2); } finally { f.cleanup(); }
  });
}
