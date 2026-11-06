#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NATIVE_SOURCE = "android/app/src/main/cpp/torrent_jni.cpp";

function requireValue(options, key) {
  const value = options[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing required option: --${key}`);
  return resolve(value);
}

export function collectRawProfiles(profileDirectory) {
  const root = resolve(profileDirectory);
  const profiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /^bookstr-native-coverage-.*\.profraw$/.test(entry.name)) {
        if (statSync(path).size === 0) throw new Error(`Native profile is empty: ${path}`);
        profiles.push(path);
      }
    }
  };
  visit(root);
  return profiles.sort();
}

export function buildNativeCoveragePlan(options) {
  const ndkBin = requireValue(options, "ndk-bin");
  const object = requireValue(options, "object");
  const compiledSourceDir = requireValue(options, "compiled-source-dir");
  const repoRoot = requireValue(options, "repo-root");
  const outputDirectory = requireValue(options, "output-dir");
  const profiles = options.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error("At least one raw profile is required");
  const source = resolve(repoRoot, NATIVE_SOURCE);
  const localSourceDir = dirname(source);
  const pathMap = `--path-equivalence=${compiledSourceDir},${localSourceDir}`;
  const profileData = join(outputDirectory, "native-coverage.profdata");
  const commonCov = ["--instr-profile", profileData, pathMap, "--sources", source];

  return {
    source,
    profileData,
    report: {
      command: join(ndkBin, "llvm-cov"),
      args: ["report", object, ...commonCov],
    },
    merge: {
      command: join(ndkBin, "llvm-profdata"),
      args: ["merge", "-sparse", "--failure-mode=any", ...profiles.map((path) => resolve(path)), "-o", profileData],
    },
    show: {
      command: join(ndkBin, "llvm-cov"),
      args: [
        "show", object, ...commonCov,
        "--show-line-counts-or-regions", "--show-branches=count",
        "--format=html", `--output-dir=${outputDirectory}`,
      ],
    },
    outputDirectory,
  };
}

export function parseNativeCoverageSummary(report) {
  const row = report.split(/\r?\n/).find((line) => /^\s*TOTAL\s/.test(line));
  if (!row) throw new Error("llvm-cov report has no TOTAL row");
  const columns = row.trim().split(/\s+/);
  if (columns.length < 13) throw new Error(`Unrecognized llvm-cov TOTAL row: ${row.trim()}`);
  return {
    regions: columns[3],
    lines: columns[9],
    branches: columns[12],
  };
}

export function assertNativeCoverageComplete(report) {
  const summary = parseNativeCoverageSummary(report);
  if (summary.lines !== "100.00%" || summary.branches !== "100.00%") {
    throw new Error(`Maintained native C++ coverage is incomplete (lines ${summary.lines}, branches ${summary.branches})`);
  }
  return summary;
}

export function buildNativeCoverageMetrics(summary, source, profileCount) {
  const percentage = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`Unrecognized llvm-cov percentage: ${value}`);
    return parsed;
  };
  return {
    formatVersion: 1,
    source,
    profileCount,
    coverage: {
      regions: summary.regions,
      lines: summary.lines,
      branches: summary.branches,
      linePercent: percentage(summary.lines),
      branchPercent: percentage(summary.branches),
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return options;
}

export function runNativeCoverage(options) {
  const requireComplete = options["require-complete"] ?? "false";
  if (requireComplete !== "true" && requireComplete !== "false") {
    throw new Error("--require-complete must be true or false");
  }
  const profileDirectory = requireValue(options, "profile-dir");
  const profiles = collectRawProfiles(profileDirectory);
  if (profiles.length === 0) throw new Error(`No Bookstr native profiles found in ${profileDirectory}`);
  const plan = buildNativeCoveragePlan({ ...options, profiles });
  mkdirSync(plan.outputDirectory, { recursive: true });
  execFileSync(plan.merge.command, plan.merge.args, { stdio: "inherit" });
  const report = execFileSync(plan.report.command, plan.report.args, { encoding: "utf8" });
  writeFileSync(join(plan.outputDirectory, "native-coverage-summary.txt"), report);
  execFileSync(plan.show.command, plan.show.args, { stdio: "inherit" });
  const summary = parseNativeCoverageSummary(report);
  const metrics = buildNativeCoverageMetrics(summary, plan.source, profiles.length);
  writeFileSync(join(plan.outputDirectory, "native-coverage.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(report);
  if (requireComplete === "true") assertNativeCoverageComplete(report);
  return { ...summary, ...metrics, profileData: plan.profileData };
}

export function invokeIfMain(moduleUrl, argv, io = {
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
  fail: () => { process.exitCode = 1; },
}) {
  const invokedUrl = argv[1] ? pathToFileURL(resolve(argv[1])).href : "";
  if (moduleUrl !== invokedUrl) return "imported";
  try {
    const result = runNativeCoverage(parseArgs(argv.slice(2)));
    io.stdout(`Native source coverage: ${result.lines} lines, ${result.branches} branches (HTML and JSON reports written)\n`);
    return "ran";
  } catch (error) {
    io.stderr(`${error.message}\n`);
    io.fail();
    return "failed";
  }
}

invokeIfMain(import.meta.url, process.argv);
