#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { parseInstrumentation } from './instrumentation-results.mjs';
export function planShards(log, seconds, count) {
    if (!Number.isInteger(count) || count < 1 || count > 99)
        throw new Error('Invalid shard count');
    const discovery = parseInstrumentation(log);
    if (!discovery.success)
        throw new Error(`Incomplete test discovery: ${discovery.problems.join('; ')}`);
    const tests = discovery.cases.map(test => `${test.className}#${test.name}`);
    if (new Set(tests).size !== tests.length || tests.some(test => !/^[\w.$]+#[\w$]+$/.test(test))) {
        throw new Error('Duplicate or unsupported instrumentation test identifier');
    }
    if (tests.length < count)
        throw new Error('More shards than discovered tests');
    const duration = (test) => Number.isFinite(seconds[test]) && seconds[test] > 0 ? seconds[test] : 3;
    tests.sort((a, b) => duration(b) - duration(a) || a.localeCompare(b));
    const shards = Array.from({ length: count }, () => ({ estimatedSeconds: 0, tests: [] }));
    for (const test of tests) {
        const shard = shards.reduce((best, item) => item.estimatedSeconds < best.estimatedSeconds ? item : best);
        shard.tests.push(test);
        shard.estimatedSeconds += duration(test);
    }
    return shards;
}
/** Fail closed unless an instrumentation log contains exactly the selected tests. */
export function verifySelection(log, selection) {
    const selected = selection.split(',').map(test => test.trim());
    if (selected.some(test => !test) || new Set(selected).size !== selected.length || selected.some(test => !/^[\w.$]+#[\w$]+$/.test(test))) {
        throw new Error('Invalid test selection: expected unique, non-empty instrumentation test identifiers');
    }
    const result = parseInstrumentation(log);
    if (result.problems.length)
        throw new Error(`Incomplete instrumentation result: ${result.problems.join('; ')}`);
    const observed = result.cases.map(test => `${test.className}#${test.name}`);
    if (new Set(observed).size !== observed.length) {
        throw new Error('Duplicate instrumentation test identifier');
    }
    const expected = [...selected].sort();
    const actual = [...observed].sort();
    if (expected.length !== actual.length || expected.some((test, index) => test !== actual[index])) {
        const actualSet = new Set(actual);
        const expectedSet = new Set(expected);
        const missing = expected.filter(test => !actualSet.has(test));
        const extra = actual.filter(test => !expectedSet.has(test));
        throw new Error(`Instrumentation test selection mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; unexpected: ${extra.join(', ')}` : ''}`);
    }
}
/** Add durations without changing AndroidJUnitRunner's protocol or hiding failures. */
export function timingRecorder(now, snapshot) {
    let className = '';
    let name = '';
    let started = null;
    return (line) => {
        if (line.startsWith('INSTRUMENTATION_STATUS: class='))
            className = line.slice('INSTRUMENTATION_STATUS: class='.length);
        if (line.startsWith('INSTRUMENTATION_STATUS: test='))
            name = line.slice('INSTRUMENTATION_STATUS: test='.length);
        if (line === 'INSTRUMENTATION_STATUS_CODE: 1') {
            started = now();
            snapshot(`RUNNING ${className}#${name}\n`);
        }
        else if (/^INSTRUMENTATION_STATUS_CODE: (0|-[1-4])$/.test(line) && started !== null) {
            const elapsed = Math.max(0, now() - started);
            started = null;
            snapshot(`FINISHED ${className}#${name}: ${line}\n`);
            return `INSTRUMENTATION_STATUS: time=${elapsed}\n${line}`;
        }
        return line;
    };
}
export function captureDiagnostics(adb, directory, run = execFileSync) {
    mkdirSync(directory, { recursive: true });
    for (const [filename, args] of [
        ['logcat.txt', ['logcat', '-d', '-t', '2000']],
        ['failure.png', ['exec-out', 'screencap', '-p']],
        ['activities.txt', ['shell', 'dumpsys', 'activity', 'activities']],
    ]) {
        try {
            writeFileSync(join(directory, filename), run(adb, [...args], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
        }
        catch (error) {
            writeFileSync(join(directory, `${filename}.error.txt`), String(error));
        }
    }
}
export async function runCli(args) {
    const [command, ...values] = args;
    if (command === 'plan' && values.length === 5) {
        const [log, history, rawIndex, rawCount, output] = values;
        const index = Number(rawIndex);
        const plan = planShards(readFileSync(log, 'utf8'), JSON.parse(readFileSync(history, 'utf8')).seconds, Number(rawCount));
        if (!Number.isInteger(index) || index < 0 || index >= plan.length)
            throw new Error('Invalid shard index');
        writeFileSync(output, plan[index].tests.join(','));
        writeFileSync(`${output}.json`, `${JSON.stringify(plan, null, 2)}\n`);
    }
    else if (command === 'stream' && values.length === 1) {
        const recorder = timingRecorder(Date.now, text => writeFileSync(values[0], text));
        for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity }))
            process.stdout.write(`${recorder(line)}\n`);
    }
    else if (command === 'diagnostics' && values.length === 2) {
        captureDiagnostics(values[0], values[1]);
    }
    else if (command === 'timings' && values.length > 0) {
        const seconds = {};
        for (const file of values) {
            for (const test of parseInstrumentation(readFileSync(file, 'utf8')).cases) {
                if (test.status === 'passed' && test.duration > 0)
                    seconds[`${test.className}#${test.name}`] = test.duration;
            }
        }
        process.stdout.write(`${JSON.stringify({ seconds }, null, 2)}\n`);
    }
    else if (command === 'verify' && values.length === 2) {
        verifySelection(readFileSync(values[0], 'utf8'), readFileSync(values[1], 'utf8'));
    }
    else
        throw new Error('Usage: ci-instrumentation.mjs plan LOG HISTORY INDEX COUNT OUTPUT | stream CURRENT_TEST | diagnostics ADB DIR | timings LOG... | verify LOG SELECTION_FILE');
}
export async function invokeIfMain(url, argv) {
    if (!argv[1] || pathToFileURL(resolve(argv[1])).href !== url)
        return;
    try {
        await runCli(argv.slice(2));
    }
    catch (error) {
        process.stderr.write(`${String(error)}\n`);
        process.exitCode = 1;
    }
}
await invokeIfMain(import.meta.url, process.argv);
