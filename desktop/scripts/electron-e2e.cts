const path = require('node:path') as typeof import('node:path');
const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

type SpawnResult = Pick<ReturnType<typeof spawnSync>, 'status' | 'error'>;
type Spawn = (command: string, parameters: string[], options: { cwd: string; stdio: 'inherit' }) => SpawnResult;

function run(args: string[], { platform = process.platform, spawn = spawnSync as Spawn }: { platform?: string; spawn?: Spawn } = {}): number {
  const cwd = path.resolve(__dirname, '..');
  const invoke = (command: string, parameters: string[], directory = cwd): number => {
    const result = spawn(command, parameters, { cwd: directory, stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  };
  const playwright = ['exec', 'playwright', 'test', ...args, '--workers=1'];
  if (platform === 'linux') return invoke('xvfb-run', ['-a', 'pnpm', ...playwright]);
  const image = 'bookstr-electron-tests';
  const built = invoke('docker', ['build', '--file', 'desktop/Dockerfile.test', '--tag', image, '.'], path.dirname(cwd));
  if (built !== 0) return built;
  return invoke('docker', ['run', '--rm', '--init', '--ipc=host', image, 'pnpm', 'run', 'test:e2e', ...args]);
}

module.exports = { run };
if (require.main === module) process.exitCode = run(process.argv.slice(2));
