#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

export const assets = {
  'epub.min.js': '06eae15745107b4aa508c95538275251f69bfb9f1175621fc458d9f42ed082d4',
  'jszip.min.js': 'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e',
};

export function parseArgs(args) {
  const options = { check: false };
  for (const argument of args) {
    if (argument === '--check') options.check = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function run(args, io = { readFile, writeFile }, cwd = repositoryRoot) {
  const { check } = parseArgs(args);
  const stale = [];
  for (const [name, expectedHash] of Object.entries(assets)) {
    const source = await io.readFile(resolve(cwd, 'shared/reader', name));
    const actualHash = sha256(source);
    if (actualHash !== expectedHash) {
      throw new Error(`Canonical reader asset has an unexpected SHA-256: ${name}`);
    }
    const output = resolve(cwd, 'web', name);
    if (check) {
      const current = await io.readFile(output).catch(() => null);
      if (!current || !Buffer.from(current).equals(Buffer.from(source))) stale.push(`web/${name}`);
    } else {
      await io.writeFile(output, source);
    }
  }
  if (stale.length > 0) throw new Error(`Generated reader assets are stale: ${stale.join(', ')}`);
  return check ? 'checked' : 'generated';
}

export async function cli(args, services = {}) {
  const execute = services.run || run;
  const writeError = services.writeError || ((message) => process.stderr.write(message));
  const fail = services.fail || (() => { process.exitCode = 1; });
  try {
    return await execute(args);
  } catch (error) {
    writeError(`${error.message}\n`);
    fail();
    return 'failed';
  }
}

export function invokeIfMain(moduleUrl, argv, action = cli) {
  const invokedPath = argv[1] ? pathToFileURL(resolve(argv[1])).href : '';
  return moduleUrl === invokedPath ? action(argv.slice(2)) : Promise.resolve('imported');
}

await invokeIfMain(import.meta.url, process.argv);
