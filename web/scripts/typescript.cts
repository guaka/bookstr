const fs: typeof import('node:fs') = require('node:fs');
const os: typeof import('node:os') = require('node:os');
const path: typeof import('node:path') = require('node:path');
const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

interface PageEntry { source: string; template: string; output: string; mode: 'classic' | 'module' }
interface BuildManifest { classic: string[]; modules: string[]; pages: PageEntry[] }
const root = path.resolve(__dirname, '..');

function servedSource(name: string, javascript: string, classic: boolean, scoped = true): string {
  const source = classic ? javascript.replace(/^export \{\};\r?\n?/gm, '') : javascript;
  if (classic && /^\s*(?:import\s|export\s)/m.test(source)) {
    throw new Error(`Classic browser script contains a module statement: ${name}`);
  }
  const body = classic && scoped ? `(function () {\n${source}\n})();\n` : source;
  return `// Generated from src/${name}.ts by pnpm --dir web build.\n${body}`;
}

function writeOutputs(outputs: Map<string, string>, directory: string, check: boolean): void {
  const stale: string[] = [];
  for (const [name, source] of outputs) {
    const output = path.join(directory, name);
    const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
    if (current === source) continue;
    if (check) stale.push(name);
    else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, source);
    }
  }
  if (stale.length) throw new Error(`Generated web scripts are stale: ${stale.join(', ')}. Run pnpm --dir web build.`);
}

function pageSource(template: string, name: string, javascript: string): string {
  const marker = `/* @bookstr-typescript:${name} */`;
  if (template.split(marker).length !== 2) throw new Error(`Page template must have one TypeScript marker: ${name}`);
  // JavaScript in an inline script must not contain a literal closing tag.
  if (/<\/script\s*>/i.test(javascript)) throw new Error(`Unsafe inline script closing tag: ${name}`);
  return template.replace(marker, () => javascript.trimEnd());
}

function stageSite(directory = root): void {
  const destination = path.join(directory, 'site-dist');
  const excluded = new Set(['node_modules', 'src', 'types', 'templates', 'scripts', 'coverage', 'test-results', 'playwright-report', 'site-dist', '.typescript-output']);
  const sourceFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'build-manifest.json', 'playwright.config.mts', 'webtorrent-dev-bridge.mts', 'tsconfig.json', 'tsconfig.tools.json', 'tsconfig.tests.json', 'tsconfig.dev.json']);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  function copy(relative: string): void {
    const input = path.join(directory, relative);
    for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      if (!relative && sourceFiles.has(entry.name)) continue;
      if (name === 'tests') {
        const report = path.join(directory, name, 'index.html');
        if (fs.existsSync(report)) {
          fs.mkdirSync(path.join(destination, name), { recursive: true });
          fs.copyFileSync(report, path.join(destination, name, 'index.html'));
        }
        continue;
      }
      if (entry.isDirectory()) copy(name);
      else {
        fs.mkdirSync(path.dirname(path.join(destination, name)), { recursive: true });
        fs.copyFileSync(path.join(directory, name), path.join(destination, name));
      }
    }
  }
  copy('');
}

function compiler(configuration: string, args: string[], directory = root): void {
  const result = spawnSync(process.execPath, [path.join(directory, 'node_modules/typescript/bin/tsc'), '-p', path.join(directory, configuration), ...args], {
    stdio: 'inherit',
    env: { ...process.env, GOMEMLIMIT: '512MiB', GOMAXPROCS: '2' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`TypeScript compilation failed: ${configuration}`);
}

function main(args: string[], directory = root): void {
  if (args.some(argument => argument !== '--check' && argument !== '--noEmit' && argument !== '--site')) throw new Error('Expected --check, --noEmit or --site');
  compiler('tsconfig.tests.json', ['--noEmit'], directory);
  compiler('tsconfig.dev.json', ['--noEmit'], directory);
  if (args.includes('--noEmit')) {
    compiler('tsconfig.json', ['--noEmit'], directory);
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-web-typescript-'));
  try {
    compiler('tsconfig.json', ['--outDir', temporary], directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json'), 'utf8')) as BuildManifest;
    const names = [...manifest.classic, ...manifest.modules, ...manifest.pages.map(page => page.source)];
    if (new Set(names).size !== names.length || names.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) throw new Error('Invalid browser script manifest');
    const emitted = fs.readdirSync(temporary).filter(name => name.endsWith('.js')).sort();
    if (JSON.stringify(emitted) !== JSON.stringify(names.map(name => `${name}.js`).sort())) throw new Error('Browser script manifest does not match TypeScript outputs');
    const outputs = new Map([...manifest.classic, ...manifest.modules].map(name => [
      `${name}.js`, servedSource(name, fs.readFileSync(path.join(temporary, `${name}.js`), 'utf8'), manifest.classic.includes(name)),
    ]));
    for (const page of manifest.pages) {
      const output = path.resolve(directory, page.output);
      const repositoryRoot = `${path.dirname(directory)}${path.sep}`;
      if (!output.startsWith(repositoryRoot) || !page.output.endsWith('.html')) throw new Error(`Invalid page output: ${page.output}`);
      const template = fs.readFileSync(path.join(directory, 'templates', page.template), 'utf8');
      const source = servedSource(page.source, fs.readFileSync(path.join(temporary, `${page.source}.js`), 'utf8'), page.mode === 'classic', false);
      outputs.set(page.output, pageSource(template, page.source, source));
    }
    writeOutputs(outputs, directory, args.includes('--check'));
    if (args.includes('--site')) stageSite(directory);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }

module.exports = { formatError, servedSource, pageSource, writeOutputs, stageSite, main };
export type BrowserBuildApi = { formatError: typeof formatError; servedSource: typeof servedSource; pageSource: typeof pageSource; writeOutputs: typeof writeOutputs; stageSite: typeof stageSite; main: typeof main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${formatError(error)}\n`); process.exitCode = 1; }
}
