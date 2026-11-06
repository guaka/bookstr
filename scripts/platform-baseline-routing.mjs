import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
export const PLATFORM_SUITES = ["android", "ios", "web", "electron"];
const ROOT_KEYS = ["version", "capturedAt", "suites"];
const SUITE_KEYS = ["minimumTests", "source", "commit", "metrics"];
const METRIC_KEYS = {
    android: ["Instructions", "Branches", "Methods", "Lines"],
    ios: ["Statements", "Functions", "Lines"],
    web: ["Statements", "Branches", "Functions", "Lines"],
    electron: ["Lines", "Branches", "Functions"],
};
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
    if (!isRecord(value))
        return false;
    const actual = Object.keys(value);
    return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function isValidSuite(suite, value) {
    if (!hasExactKeys(value, SUITE_KEYS))
        return false;
    if (!Number.isInteger(value.minimumTests) || value.minimumTests < 0)
        return false;
    if (typeof value.source !== "string" || value.source.trim() === "")
        return false;
    if (typeof value.commit !== "string" || !/^[0-9a-f]{40}$/.test(value.commit))
        return false;
    if (!hasExactKeys(value.metrics, METRIC_KEYS[suite]))
        return false;
    return Object.values(value.metrics).every((metric) => typeof metric === "number" && Number.isFinite(metric) && metric >= 0 && metric <= 100);
}
function isValidBaseline(value) {
    if (!hasExactKeys(value, ROOT_KEYS))
        return false;
    if (value.version !== 1)
        return false;
    if (typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)))
        return false;
    if (!hasExactKeys(value.suites, PLATFORM_SUITES))
        return false;
    return PLATFORM_SUITES.every((suite) => isValidSuite(suite, value.suites[suite]));
}
/** Fail closed: an unknown suite, invalid JSON, or changed schema routes all platforms. */
export function compareSuiteBaselineChange(suite, baseText, headText) {
    if (!PLATFORM_SUITES.includes(suite))
        return true;
    try {
        const base = JSON.parse(baseText);
        const head = JSON.parse(headText);
        if (!isValidBaseline(base) || !isValidBaseline(head))
            return true;
        return !isDeepStrictEqual(base.suites[suite], head.suites[suite]);
    }
    catch {
        return true;
    }
}
function removeChangesJob(workflowText) {
    if (typeof workflowText !== "string")
        return null;
    const lines = workflowText.replace(/\r\n/g, "\n").split("\n");
    const startIndexes = lines.flatMap((line, index) => /^  changes:\s*$/.test(line) ? [index] : []);
    if (startIndexes.length !== 1)
        return null;
    const start = startIndexes[0];
    const nextJob = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(line));
    if (nextJob <= start + 1)
        return null;
    const block = lines.slice(start + 1, nextJob);
    if (!block.some((line) => /^\s{4,}\S/.test(line)))
        return null;
    if (block.some((line) => line.trim() !== "" && !/^ {4,}\S/.test(line) && !/^\s*#/.test(line)))
        return null;
    return [...lines.slice(0, start), ...lines.slice(nextJob)].join("\n");
}
/** Ignore only the changes-routing job; missing or malformed workflows route conservatively. */
export function compareWorkflowOutsideRoutingJob(baseText, headText) {
    const base = removeChangesJob(baseText);
    const head = removeChangesJob(headText);
    if (base === null || head === null)
        return true;
    return base !== head;
}
function parseArguments(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        if (!["--suite", "--base", "--head", "--workflow-base", "--workflow-head"].includes(flag) || !value || value.startsWith("--")) {
            throw new Error(`Invalid argument: ${flag ?? "<missing>"}`);
        }
        if (Object.hasOwn(options, flag))
            throw new Error(`Duplicate argument: ${flag}`);
        options[flag] = value;
    }
    if (![3, 4, 5].includes(Object.keys(options).length))
        throw new Error("Expected --suite, --base, and --head, with optional workflow comparison");
    if (Object.hasOwn(options, "--workflow-base") !== Object.hasOwn(options, "--workflow-head")) {
        throw new Error("Both workflow comparison files are required");
    }
    return options;
}
/** CLI failures also fail closed so a routing problem runs the platform suite. */
export function runPlatformBaselineRoutingCli(args) {
    try {
        const options = parseArguments(args);
        const base = readFileSync(resolve(options["--base"]), "utf8");
        const head = readFileSync(resolve(options["--head"]), "utf8");
        const baselineChanged = compareSuiteBaselineChange(options["--suite"], base, head);
        if (!Object.hasOwn(options, "--workflow-base"))
            return String(baselineChanged);
        const baseWorkflow = readFileSync(resolve(options["--workflow-base"]), "utf8");
        const headWorkflow = readFileSync(resolve(options["--workflow-head"]), "utf8");
        return String(baselineChanged || compareWorkflowOutsideRoutingJob(baseWorkflow, headWorkflow));
    }
    catch {
        return "true";
    }
}
