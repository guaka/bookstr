const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

const root = __dirname;
type Spawn = (command: string, args: string[], options: { stdio: 'inherit'; env: NodeJS.ProcessEnv }) => { status: number | null; error?: Error };
type Compile = (configuration: string, args: string[], directory: string) => void;

function compiler(configuration: string, args: string[], directory = root, spawn: Spawn = spawnSync): void {
  const result = spawn(process.execPath, [path.join(directory, '../web/node_modules/typescript/bin/tsc'), '-p', path.resolve(directory, configuration), ...args], {
    stdio: 'inherit', env: { ...process.env, GOMEMLIMIT: '512MiB', GOMAXPROCS: '2', NODE_OPTIONS: '--max-old-space-size=512' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`TypeScript compilation failed: ${configuration}`);
}

function writeOutputs(outputs: Map<string, string>, directory: string, check: boolean): void {
  const stale: string[] = [];
  for (const [name, value] of outputs) {
    const target = path.join(directory, name);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === value) continue;
    if (check) stale.push(name);
    else fs.writeFileSync(target, value);
  }
  if (stale.length) throw new Error(`Generated tool scripts are stale: ${stale.join(', ')}. Run node scripts/typescript.cts.`);
}

function main(args: string[], directory = root, compile: Compile = compiler): void {
  if (args.some(argument => argument !== '--check' && argument !== '--noEmit')) throw new Error('Expected --check or --noEmit');
  for (const project of ['.', '../android/scripts']) {
    const configuration = path.join(project, 'tsconfig.json');
    if (args.includes('--noEmit')) compile(configuration, ['--noEmit'], directory);
    else {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstr-tool-typescript-'));
      try {
        compile(configuration, ['--outDir', temporary], directory);
        const outputs = new Map(fs.readdirSync(temporary).map(name => [name, fs.readFileSync(path.join(temporary, name), 'utf8')]));
        writeOutputs(outputs, path.resolve(directory, project), args.includes('--check'));
      } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    compile(path.join(project, 'tsconfig.tests.json'), ['--noEmit'], directory);
  }
}

function formatError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
module.exports = { compiler, writeOutputs, main, formatError };
export type ToolBuildApi = { compiler: typeof compiler; writeOutputs: typeof writeOutputs; main: typeof main; formatError: typeof formatError };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${formatError(error)}\n`); process.exitCode = 1; }
}
