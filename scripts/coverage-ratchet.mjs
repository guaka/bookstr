#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const suiteNames = ['web', 'electron', 'android', 'ios'];

export function validateBaselines(value) {
  if (!value || value.version !== 1 || typeof value.capturedAt !== 'string') {
    throw new Error('Coverage baselines must have version 1 and a capture time');
  }
  if (!value.suites || typeof value.suites !== 'object' || Array.isArray(value.suites)) {
    throw new Error('Coverage baselines must define suites');
  }
  for (const name of suiteNames) {
    const suite = value.suites[name];
    if (!suite || !Number.isSafeInteger(suite.minimumTests) || suite.minimumTests <= 0) {
      throw new Error(`${name} must define a positive minimum test count`);
    }
    if (typeof suite.source !== 'string' || !suite.source.startsWith('https://github.com/guaka/bookstr/actions/runs/')) {
      throw new Error(`${name} must cite a Bookstr Actions run`);
    }
    if (typeof suite.commit !== 'string' || !/^[a-f0-9]{40}$/.test(suite.commit)) {
      throw new Error(`${name} must cite a full commit hash`);
    }
    if (!suite.metrics || typeof suite.metrics !== 'object' || Array.isArray(suite.metrics) || Object.keys(suite.metrics).length === 0) {
      throw new Error(`${name} must define coverage metrics`);
    }
    for (const [label, minimum] of Object.entries(suite.metrics)) {
      if (!label || !Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
        throw new Error(`${name} has an invalid coverage metric`);
      }
    }
  }
  if (Object.keys(value.suites).sort().join() !== [...suiteNames].sort().join()) {
    throw new Error('Coverage baselines must contain exactly the four clients');
  }
  return value;
}

export function checkReport(baselines, suiteName, report) {
  validateBaselines(baselines);
  const baseline = baselines.suites[suiteName];
  if (!baseline) throw new Error(`Unknown coverage suite: ${suiteName}`);
  if (!report || report.id !== suiteName || report.status !== 'passing') {
    throw new Error(`${suiteName} coverage report is not passing`);
  }
  const tests = Number(report.results?.tests);
  if (!Number.isSafeInteger(tests) || tests < baseline.minimumTests) {
    throw new Error(`${suiteName} test count ${tests || 0} is below ${baseline.minimumTests}`);
  }
  const metrics = new Map((report.coverage || []).map(item => [item.label, Number(item.value)]));
  for (const [label, minimum] of Object.entries(baseline.metrics)) {
    const actual = metrics.get(label);
    if (!Number.isFinite(actual)) throw new Error(`${suiteName} report is missing ${label} coverage`);
    if (actual < minimum) throw new Error(`${suiteName} ${label} coverage ${actual} is below ${minimum}`);
  }
  return { suite: suiteName, tests, metrics: Object.fromEntries(metrics) };
}

export function parseArgs(args) {
  const options = { baseline: 'shared/coverage/baselines-v1.json' };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value || !['--suite', '--report', '--baseline'].includes(name)) throw new Error(`Unknown or incomplete argument: ${name || ''}`);
    options[name.slice(2)] = value;
  }
  if (!options.suite || !options.report) throw new Error('--suite and --report are required');
  return options;
}

export async function run(args, io = { readFile }, cwd = process.cwd()) {
  const options = parseArgs(args);
  const baselines = JSON.parse(await io.readFile(resolve(cwd, options.baseline), 'utf8'));
  const report = JSON.parse(await io.readFile(resolve(cwd, options.report), 'utf8'));
  return checkReport(baselines, options.suite, report);
}

export async function cli(args, services = {}) {
  const execute = services.run || run;
  const writeOutput = services.writeOutput || process.stdout.write.bind(process.stdout);
  const writeError = services.writeError || process.stderr.write.bind(process.stderr);
  try {
    const result = await execute(args);
    writeOutput(`${result.suite} coverage ratchet passed\n`);
    return 'passed';
  } catch (error) {
    writeError(`${error.message}\n`);
    if (services.fail) services.fail();
    else process.exitCode = 1;
    return 'failed';
  }
}

export function invokeIfMain(moduleUrl, argv, action = cli) {
  const invoked = argv[1] ? pathToFileURL(resolve(argv[1])).href : '';
  return moduleUrl === invoked ? action(argv.slice(2)) : Promise.resolve('imported');
}

await invokeIfMain(import.meta.url, process.argv);
