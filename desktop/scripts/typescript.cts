const path = require('node:path') as typeof import('node:path');
const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

const root: string = path.resolve(__dirname, '..');
const [configuration = 'tsconfig.json', ...args]: string[] = process.argv.slice(2);
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.resolve(root, configuration), ...args], {
  stdio: 'inherit',
  env: { ...process.env, GOMEMLIMIT: '512MiB', GOMAXPROCS: '2' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
