const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const { buildSync } = require('esbuild') as typeof import('esbuild');
const root = path.resolve(__dirname, '..');
const { formatError } = require('./typescript.cts') as import('./typescript.cts').BrowserBuildApi;

const files: ReadonlyArray<readonly [string, string]> = [
  ['jszip/dist/jszip.min.js', 'jszip.min.js'],
  ['jszip/dist/jszip.min.js', '../shared/reader/jszip.min.js'],
  ['epubjs/dist/epub.min.js', 'epub.min.js'],
  ['epubjs/dist/epub.min.js', '../shared/reader/epub.min.js'],
  ['sql.js/dist/sql-wasm.js', 'vendor/sql-wasm.js'],
  ['sql.js/dist/sql-wasm.wasm', 'vendor/sql-wasm.wasm'],
  ['libarchive-wasm/dist/libarchive.js', 'vendor/libarchive.js'],
  ['libarchive-wasm/dist/libarchive.wasm', 'vendor/libarchive.wasm'],
  ['pdfjs-dist/build/pdf.mjs', 'vendor/pdfjs/pdf.mjs'],
  ['pdfjs-dist/build/pdf.worker.mjs', 'vendor/pdfjs/pdf.worker.mjs'],
  ['pdfjs-dist/LICENSE', 'vendor/pdfjs/LICENSE'],
  ['nostr-tools/LICENSE', 'vendor/nostr-tools.LICENSE'],
  ['epubjs/license', 'vendor/licenses/epubjs.txt'],
  ['jszip/LICENSE.markdown', 'vendor/licenses/jszip.txt'],
  ['sql.js/LICENSE', 'vendor/licenses/sql.js.txt'],
];

function vendorOutputs(directory = root): Map<string, Uint8Array> {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  const outputs = new Map<string, Uint8Array>();
  for (const [source, destination] of files) {
    const packageName = source.split('/')[0]!;
    const installed = JSON.parse(fs.readFileSync(path.join(directory, 'node_modules', packageName, 'package.json'), 'utf8')) as { version: string };
    if (manifest.devDependencies[packageName] !== installed.version) throw new Error(`Vendor package is not at its pinned version: ${packageName}`);
    const bytes = fs.readFileSync(path.join(directory, 'node_modules', source));
    outputs.set(destination, destination.startsWith('vendor/licenses/')
      ? Buffer.from(bytes.toString('utf8').replace(/[ \t]+$/gm, ''))
      : bytes);
  }
  const bundle = buildSync({
    absWorkingDir: directory,
    entryPoints: ['node_modules/nostr-tools/lib/esm/index.js'],
    outfile: 'vendor/nostr-tools.js',
    bundle: true,
    write: false,
    sourcemap: true,
    sourcesContent: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
  });
  const javascript = bundle.outputFiles!.find(file => file.path.endsWith('.js'))!;
  const sourceMap = bundle.outputFiles!.find(file => file.path.endsWith('.js.map'))!;
  outputs.set('vendor/nostr-tools.js', javascript.contents);
  outputs.set('vendor/nostr-tools.js.map', sourceMap.contents);
  return outputs;
}

function main(args: string[], directory = root): void {
  if (args.some(argument => argument !== '--check')) throw new Error('Expected --check');
  const stale: string[] = [];
  for (const [name, bytes] of vendorOutputs(directory)) {
    const output = path.join(directory, name);
    const current = fs.existsSync(output) ? fs.readFileSync(output) : null;
    if (current?.equals(bytes)) continue;
    if (args.includes('--check')) stale.push(name);
    else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, bytes);
    }
  }
  if (stale.length) throw new Error(`Vendored browser assets are stale: ${stale.join(', ')}. Run pnpm --dir web sync:vendor.`);
}

module.exports = { vendorOutputs, main };
export type BrowserVendorApi = { vendorOutputs: typeof vendorOutputs; main: typeof main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${formatError(error)}\n`); process.exitCode = 1; }
}
