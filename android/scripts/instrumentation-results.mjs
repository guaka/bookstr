#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const TERMINAL_STATUS = new Map([
    [0, 'passed'],
    [-1, 'error'],
    [-2, 'failure'],
    [-3, 'skipped'],
    [-4, 'skipped'],
]);
function xmlEscape(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function parseStatusLine(line) {
    const prefix = 'INSTRUMENTATION_STATUS: ';
    const separator = line.indexOf('=', prefix.length);
    if (separator < 0)
        return { malformed: true };
    return {
        key: line.slice(prefix.length, separator),
        value: line.slice(separator + 1),
    };
}
function makeCase(fields, status, index) {
    const test = fields.test?.trim() || `unnamed test ${index}`;
    return {
        name: test,
        className: fields.class?.trim() || 'AndroidInstrumentation',
        status,
        message: fields.shortMsg || fields.error || fields.stack?.split(/\r?\n/, 1)[0] || fields.stream || '',
        stack: fields.stack || fields.stream || '',
        duration: Math.max(0, Number(fields.time) || 0) / 1000,
    };
}
/** Parse AndroidJUnitRunner's instrumentation status protocol. */
export function parseInstrumentation(text) {
    const cases = [];
    const active = [];
    const problems = [];
    let fields = {};
    let resultFields = {};
    let finalCode = null;
    let advertisedTests = 0;
    let sawProtocol = false;
    let malformed = false;
    const finishStatus = (rawCode) => {
        const code = Number(rawCode);
        if (!Number.isInteger(code)) {
            malformed = true;
            problems.push(`Invalid instrumentation status code: ${rawCode}`);
            fields = {};
            return;
        }
        if (code === 1) {
            const item = { fields: { ...fields }, caseIndex: null };
            active.push(item);
            cases.push(makeCase(item.fields, 'incomplete', cases.length + 1));
            item.caseIndex = cases.length - 1;
            advertisedTests = Math.max(advertisedTests, Number(fields.numtests) || 0);
        }
        else if (TERMINAL_STATUS.has(code)) {
            advertisedTests = Math.max(advertisedTests, Number(fields.numtests) || 0);
            const name = fields.test;
            const className = fields.class;
            let activeIndex = active.findIndex(item => (!name || item.fields.test === name) && (!className || item.fields.class === className));
            if (activeIndex < 0 && active.length)
                activeIndex = 0;
            if (activeIndex >= 0) {
                const item = active.splice(activeIndex, 1)[0];
                item.fields = { ...item.fields, ...fields };
                const testCase = cases[item.caseIndex];
                Object.assign(testCase, makeCase(item.fields, TERMINAL_STATUS.get(code), item.caseIndex + 1));
            }
            else {
                malformed = true;
                problems.push(`Terminal status ${code} has no matching test start`);
                if (name || className)
                    cases.push(makeCase(fields, TERMINAL_STATUS.get(code), cases.length + 1));
            }
        }
        else {
            malformed = true;
            problems.push(`Unsupported instrumentation status code: ${code}`);
        }
        fields = {};
    };
    for (const line of String(text).split(/\r?\n/)) {
        if (line.startsWith('INSTRUMENTATION_STATUS_CODE:')) {
            sawProtocol = true;
            finishStatus(line.slice(line.indexOf(':') + 1).trim());
        }
        else if (line.startsWith('INSTRUMENTATION_RESULT:')) {
            sawProtocol = true;
            const result = parseStatusLine(line.replace('INSTRUMENTATION_RESULT:', 'INSTRUMENTATION_STATUS:'));
            if (result?.malformed) {
                malformed = true;
                problems.push('Malformed instrumentation result field');
            }
            else if (result)
                resultFields[result.key] = result.value;
        }
        else if (line.startsWith('INSTRUMENTATION_CODE:')) {
            sawProtocol = true;
            const rawCode = line.slice(line.indexOf(':') + 1).trim();
            finalCode = /^-?\d+$/.test(rawCode) ? Number(rawCode) : NaN;
        }
        else if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
            sawProtocol = true;
            const entry = parseStatusLine(line);
            if (entry?.malformed) {
                malformed = true;
                problems.push('Malformed instrumentation status field');
            }
            else if (entry) {
                if (entry.key === 'stack' && fields.stack)
                    fields.stack += `\n${entry.value}`;
                else if (entry.key === 'stream' && fields.stream)
                    fields.stream += `\n${entry.value}`;
                else
                    fields[entry.key] = entry.value;
            }
        }
        else if (fields.stack && line) {
            fields.stack += `\n${line}`;
        }
        else if (fields.stream && line) {
            fields.stream += `\n${line}`;
        }
    }
    if (Object.keys(fields).length) {
        malformed = true;
        problems.push('Truncated instrumentation status block');
    }
    if (!sawProtocol) {
        malformed = true;
        problems.push('No Android instrumentation protocol was found');
    }
    if (active.length) {
        for (const item of active) {
            const testCase = cases[item.caseIndex];
            testCase.status = 'error';
            testCase.message = 'Instrumentation ended before this test completed';
            testCase.stack ||= testCase.message;
        }
        problems.push(`${active.length} test(s) did not complete`);
    }
    const actualTests = cases.length;
    const expected = advertisedTests;
    if (expected > 0 && actualTests !== expected)
        problems.push(`Expected ${expected} tests but observed ${actualTests}`);
    if (finalCode !== -1)
        problems.push(finalCode === null ? 'Missing final instrumentation code' : `Unexpected final instrumentation code: ${finalCode}`);
    if (resultFields.shortMsg)
        problems.push(`Instrumentation crashed: ${resultFields.shortMsg}`);
    if (cases.length === 0 && !problems.includes('No tests were reported'))
        problems.push('No tests were reported');
    if (malformed && !problems.some(problem => /malformed|truncated|protocol/i.test(problem)))
        problems.push('Malformed instrumentation output');
    return {
        cases,
        problems,
        passed: cases.filter(item => item.status === 'passed').length,
        failures: cases.filter(item => item.status === 'failure').length,
        errors: cases.filter(item => item.status === 'error' || item.status === 'incomplete').length,
        skipped: cases.filter(item => item.status === 'skipped').length,
        success: problems.length === 0 && cases.some(item => item.status === 'passed') && cases.every(item => item.status === 'passed' || item.status === 'skipped'),
    };
}
/** Render a parser result as a single JUnit testsuite document. */
export function toJUnit(result) {
    const failed = result.cases.filter(item => item.status === 'failure').length;
    const errors = result.cases.filter(item => item.status === 'error' || item.status === 'incomplete').length;
    const skipped = result.cases.filter(item => item.status === 'skipped').length;
    const duration = result.cases.reduce((sum, item) => sum + item.duration, 0);
    const tests = result.cases.map(item => {
        const name = xmlEscape(item.name);
        const classname = xmlEscape(item.className);
        const body = item.status === 'failure' || item.status === 'error' || item.status === 'incomplete'
            ? `<${item.status === 'failure' ? 'failure' : 'error'} message="${xmlEscape(item.message || item.status)}">${xmlEscape(item.stack || item.message)}</${item.status === 'failure' ? 'failure' : 'error'}>`
            : item.status === 'skipped' ? '<skipped/>' : '';
        return `  <testcase classname="${classname}" name="${name}" time="${item.duration.toFixed(3)}">${body}</testcase>`;
    }).join('\n');
    const runError = result.problems.length && result.cases.length === 0
        ? `\n  <testcase classname="AndroidInstrumentation" name="instrumentation run"><error message="${xmlEscape(result.problems.join('; '))}">${xmlEscape(result.problems.join('\n'))}</error></testcase>`
        : '';
    const total = result.cases.length + (runError ? 1 : 0);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Android instrumentation" tests="${total}" failures="${failed}" errors="${errors + (runError ? 1 : 0)}" skipped="${skipped}" time="${duration.toFixed(3)}">${tests ? `\n${tests}` : ''}${runError}\n</testsuite>\n`;
}
export async function convert(inputPath, outputPath, _options = {}) {
    const log = await readFile(inputPath, 'utf8');
    const result = parseInstrumentation(log);
    await writeFile(outputPath, toJUnit(result));
    return result;
}
async function main(args) {
    if (args.length !== 2) {
        process.stderr.write('Usage: node android/scripts/instrumentation-results.mjs INPUT_LOG OUTPUT_XML\n');
        return 2;
    }
    try {
        const result = await convert(args[0], args[1]);
        if (!result.success) {
            for (const problem of result.problems)
                process.stderr.write(`${problem}\n`);
            return 1;
        }
        return 0;
    }
    catch (error) {
        process.stderr.write(`Unable to convert instrumentation results: ${error.message}\n`);
        return 1;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main(process.argv.slice(2));
}
