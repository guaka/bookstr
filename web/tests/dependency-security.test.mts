import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
type ConcretePackageManifest = { devDependencies: Record<string, string> };
const manifest = require('./package.json') as unknown as ConcretePackageManifest;

test('the shipped PDF renderer and worker match the patched pinned package', () => {
  assert.equal(manifest.devDependencies['pdfjs-dist'], '6.2.108');
  for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
    const installed = readFileSync(require.resolve(`pdfjs-dist/build/${file}`));
    const shipped = readFileSync(new URL(`../vendor/pdfjs/${file}`, import.meta.url));
    assert.deepEqual(shipped, installed);
    assert.match(shipped.toString(), /pdfjsVersion = 6\.2\.108/);
  }
});

test('EPUB XML parsing and coverage globs resolve to patched dependencies', () => {
  const epub = createRequire(require.resolve('epubjs/package.json'));
  assert.equal(epub('@xmldom/xmldom/package.json').version, '0.8.15');
  const c8 = createRequire(require.resolve('c8/package.json'));
  const coverage = createRequire(c8.resolve('test-exclude/package.json'));
  const glob = createRequire(coverage.resolve('glob/package.json'));
  assert.equal(glob('./package.json').version, '14.0.2');
  assert.equal(glob('minimatch/package.json').version, '11.0.4');
});
