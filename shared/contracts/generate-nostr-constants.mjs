#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const outputs = {
  'web/generated/nostr-constants-v1.js': renderJavaScript,
  'android/app/src/main/java/app/bookstr/shared/generated/NostrConstantsV1.kt': renderKotlin,
  'ios/BookstrIOS/Sources/Shared/Generated/NostrConstantsV1.swift': renderSwift,
};

const required = {
  kinds: ['progress', 'favorites', 'blossomAuthorization'],
  dTags: ['favorites', 'collectionIndex'],
  prefixes: ['progress', 'favoritesChunk', 'collectionChunk', 'vocabulary', 'snippet'],
};

export function validateConstants(value) {
  if (!value || value.version !== 1) throw new Error('Nostr constants version must be 1');
  for (const [section, names] of Object.entries(required)) {
    const actual = value[section];
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error(`${section} must be an object`);
    if (Object.keys(actual).sort().join() !== [...names].sort().join()) throw new Error(`${section} must contain the canonical keys`);
    for (const name of names) {
      const item = actual[name];
      if (section === 'kinds' ? !Number.isSafeInteger(item) || item <= 0 : typeof item !== 'string' || item.length === 0) {
        throw new Error(`${section}.${name} has an invalid value`);
      }
    }
  }
  return value;
}

const header = prefix => `${prefix} Generated from shared/contracts/nostr-constants-v1.json. Do not edit.\n`;
const upperSnake = name => name.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase();

export function renderJavaScript(value) {
  validateConstants(value);
  return `${header('//')}(function initBookstrNostrConstants(root) {
  root.BookstrNostrConstants = Object.freeze(${JSON.stringify(value, null, 2)});
})(globalThis);
`;
}

export function renderKotlin(value) {
  validateConstants(value);
  const declarations = Object.entries(value.kinds).map(([name, item]) => `    const val ${upperSnake(name)}_KIND = ${item}`)
    .concat(Object.entries(value.dTags).map(([name, item]) => `    const val ${upperSnake(name)}_D_TAG = ${JSON.stringify(item)}`))
    .concat(Object.entries(value.prefixes).map(([name, item]) => `    const val ${upperSnake(name)}_PREFIX = ${JSON.stringify(item)}`));
  return `${header('//')}package app.bookstr.shared.generated

object NostrConstantsV1 {
${declarations.join('\n')}
}
`;
}

export function renderSwift(value) {
  validateConstants(value);
  const declarations = Object.entries(value.kinds)
    .filter(([name]) => name !== 'blossomAuthorization')
    .map(([name, item]) => `    static let ${name}Kind = ${item}`)
    .concat(Object.entries(value.dTags).map(([name, item]) => `    static let ${name}DTag = ${JSON.stringify(item)}`))
    .concat(Object.entries(value.prefixes).map(([name, item]) => `    static let ${name}Prefix = ${JSON.stringify(item)}`));
  return `${header('//')}enum NostrConstantsV1 {
${declarations.join('\n')}
}
`;
}

export function parseArgs(args) {
  if (args.length === 0) return { check: false };
  if (args.length === 1 && args[0] === '--check') return { check: true };
  throw new Error(`Unknown arguments: ${args.join(' ')}`);
}

export async function run(args, io = { mkdir, readFile, writeFile }, cwd = process.cwd()) {
  const { check } = parseArgs(args);
  const source = resolve(cwd, 'shared/contracts/nostr-constants-v1.json');
  const value = validateConstants(JSON.parse(await io.readFile(source, 'utf8')));
  for (const [relativePath, renderer] of Object.entries(outputs)) {
    const output = resolve(cwd, relativePath);
    const generated = renderer(value);
    if (check) {
      const current = await io.readFile(output, 'utf8').catch(() => '');
      if (current !== generated) throw new Error(`${relativePath} is stale`);
    } else {
      await io.mkdir(dirname(output), { recursive: true });
      await io.writeFile(output, generated);
    }
  }
  return check ? 'checked' : 'generated';
}

export async function cli(args, services = {}) {
  const execute = services.run || run;
  const writeError = services.writeError || (message => process.stderr.write(message));
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
  const invoked = argv[1] ? pathToFileURL(resolve(argv[1])).href : '';
  return moduleUrl === invoked ? action(argv.slice(2)) : Promise.resolve('imported');
}

await invokeIfMain(import.meta.url, process.argv);
