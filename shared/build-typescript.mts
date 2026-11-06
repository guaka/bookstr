#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

type BuildServices = {
  sharedRoot?: string;
  repositoryRoot?: string;
  compile?: (sharedRoot: string, repositoryRoot: string) => void | Promise<void>;
};

const browserWrappers = {
  'web/shared/contracts/device-pairing-client.mjs': "export * from '../../../shared/contracts/device-pairing-client.mjs';\n",
  'web/shared/contracts/device-pairing-nip17.mjs': "export * from '../../../shared/contracts/device-pairing-nip17.mjs';\n",
  'web/shared/contracts/device-pairing-v1.mjs': "export * from '../../../shared/contracts/device-pairing-v1.mjs';\n",
  'web/shared/contracts/device-transfer-v1.mjs': "export * from '../../../shared/contracts/device-transfer-v1.mjs';\n",
} as const;

const sharedRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(sharedRoot);

export function parseArgs(args: string[]): { check: boolean } {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === '--check') return { check: true };
  throw new Error('Usage: node shared/build-typescript.mts [--check]');
}

function compile(sharedDirectory: string, repositoryDirectory: string): void {
  const tsc = join(repositoryDirectory, 'web', 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, ['--max-old-space-size=512', tsc, '-p', join(sharedDirectory, 'tsconfig.build.json'), '--pretty', 'false'], {
    cwd: repositoryDirectory,
    stdio: 'inherit',
    env: { ...process.env, GOMEMLIMIT: '512MiB', GOMAXPROCS: '2' },
  });
}

export async function syncRuntimeOutputs(outputRoot: string, sharedDirectory: string, check: boolean): Promise<string[]> {
  const stale: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(source);
        continue;
      }
      if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js')) continue;
      const outputPath = join(sharedDirectory, relative(outputRoot, source));
      const generated = await readFile(source);
      if (check) {
        const current = await readFile(outputPath).catch(() => null);
        if (!current || !current.equals(generated)) stale.push(relative(sharedDirectory, outputPath));
      } else {
        await mkdir(dirname(outputPath), { recursive: true });
        await cp(source, outputPath);
      }
    }
  }
  await visit(outputRoot);
  return stale.sort();
}

export async function syncBrowserWrappers(repositoryDirectory: string, check: boolean): Promise<string[]> {
  const stale: string[] = [];
  for (const [relativePath, generated] of Object.entries(browserWrappers)) {
    const outputPath = join(repositoryDirectory, relativePath);
    if (check) {
      const current = await readFile(outputPath, 'utf8').catch(() => null);
      if (current !== generated) stale.push(relative(repositoryDirectory, outputPath));
    } else {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, generated, 'utf8');
    }
  }
  return stale.sort();
}

export async function run(args: string[], services: BuildServices = {}): Promise<string> {
  const { check } = parseArgs(args);
  const sharedDirectory = services.sharedRoot || sharedRoot;
  const repositoryDirectory = services.repositoryRoot || repositoryRoot;
  const outputRoot = join(sharedDirectory, '.build', 'typescript');
  try {
    await (services.compile || compile)(sharedDirectory, repositoryDirectory);
    const stale = await syncRuntimeOutputs(outputRoot, sharedDirectory, check);
    if (stale.length > 0) throw new Error(`Generated shared JavaScript is stale: ${stale.join(', ')}`);
    const staleWrappers = await syncBrowserWrappers(repositoryDirectory, check);
    if (staleWrappers.length > 0) throw new Error(`Generated browser re-export wrappers are stale: ${staleWrappers.join(', ')}`);
    return check ? 'checked' : 'generated';
  } finally {
    await rm(join(sharedDirectory, '.build'), { recursive: true, force: true });
  }
}

export async function cli(args: string[], services: BuildServices & { writeError?: (message: string) => void; fail?: () => void } = {}): Promise<string> {
  try {
    return await run(args, services);
  } catch (error) {
    (services.writeError || ((message: string) => process.stderr.write(message)))(`${error instanceof Error ? error.message : String(error)}\n`);
    (services.fail || (() => { process.exitCode = 1; }))();
    return 'failed';
  }
}

export function invokedModuleURL(entrypoint?: string): string {
  return entrypoint ? pathToFileURL(resolve(entrypoint)).href : '';
}

const invoked = invokedModuleURL(process.argv[1]);
if (import.meta.url === invoked) {
  await cli(process.argv.slice(2));
}
