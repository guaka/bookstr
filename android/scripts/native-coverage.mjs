#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const NATIVE_SOURCE_ROOT = "android/app/src/main/cpp";
const SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"]);

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

export function findMaintainedNativeSources(repoRoot) {
  const root = resolve(repoRoot, NATIVE_SOURCE_ROOT);
  const sources = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // CMake's _deps directory contains fetched third-party headers, not maintained Bookstr source.
      if (entry.name === "_deps") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) sources.push(path);
    }
  };
  visit(root);
  if (sources.length === 0) throw new Error(`No maintained native C/C++ sources found in ${root}`);
  return sources.sort();
}

export function buildNativeCoveragePlan(options, coverageSourceDir = null) {
  const ndkBin = requireValue(options, "ndk-bin");
  const object = requireValue(options, "object");
  const repoRoot = requireValue(options, "repo-root");
  const outputDirectory = requireValue(options, "output-dir");
  const profileData = join(outputDirectory, "native-coverage.profdata");
  const profiles = options.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error("At least one raw profile is required");
  const sources = (options.sources || findMaintainedNativeSources(repoRoot)).map((source) => resolve(source));
  if (sources.length === 0) throw new Error("At least one maintained native source is required");
  const sourceRoot = resolve(repoRoot, NATIVE_SOURCE_ROOT);
  const mappedSourceDir = coverageSourceDir || options["compiled-source-dir"];
  const sourcePathMap = mappedSourceDir
    ? [`--path-equivalence=${mappedSourceDir},${sourceRoot}`]
    : [];
  const commonCov = ["--instr-profile", profileData, ...sourcePathMap, "--sources", ...sources];

  return {
    source: sources.length === 1 ? sources[0] : null,
    sources,
    sourceRoot,
    profileData,
    export: {
      command: join(ndkBin, "llvm-cov"),
      args: ["export", object, "--instr-profile", profileData, "--summary-only"],
    },
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

function parseExportJson(exportJson) {
  let payload;
  try {
    payload = typeof exportJson === "string" ? JSON.parse(exportJson) : exportJson;
  } catch {
    throw new Error("llvm-cov export did not produce valid JSON");
  }
  const files = payload?.data?.flatMap((entry) => entry?.files || []) || [];
  if (files.length === 0) throw new Error("llvm-cov export has no source files");
  return files;
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function percentage(metric) {
  if (!metric || !Number.isSafeInteger(metric.count) || !Number.isSafeInteger(metric.covered) || metric.count < 0 || metric.covered < 0 || metric.covered > metric.count) {
    throw new Error("llvm-cov export contains invalid coverage counters");
  }
  return metric.count === 0 ? "100.00%" : `${(metric.covered * 100 / metric.count).toFixed(2)}%`;
}

function normalizeExportSummary(summary) {
  if (!summary) throw new Error("llvm-cov export source has no summary");
  return {
    regions: percentage(summary.regions),
    lines: percentage(summary.lines),
    branches: percentage(summary.branches),
    counts: {
      regions: { count: summary.regions.count, covered: summary.regions.covered },
      lines: { count: summary.lines.count, covered: summary.lines.covered },
      branches: { count: summary.branches.count, covered: summary.branches.covered },
    },
  };
}

function aggregateSummaries(summaries) {
  const metric = (key) => {
    const count = summaries.reduce((total, summary) => total + summary.counts[key].count, 0);
    const covered = summaries.reduce((total, summary) => total + summary.counts[key].covered, 0);
    return { count, covered };
  };
  const counts = { regions: metric("regions"), lines: metric("lines"), branches: metric("branches") };
  return {
    regions: percentage(counts.regions),
    lines: percentage(counts.lines),
    branches: percentage(counts.branches),
    counts,
  };
}

function sourceCoverageSuffix(repoRoot, source) {
  const sourceRoot = resolve(repoRoot, NATIVE_SOURCE_ROOT);
  const relativeSource = toPosixPath(relative(sourceRoot, source));
  if (relativeSource.startsWith("../") || relativeSource === "..") {
    throw new Error(`Maintained source is outside ${sourceRoot}: ${source}`);
  }
  return `/src/main/cpp/${relativeSource}`;
}

export function validateNativeCoverageExport(exportJson, sources, repoRoot) {
  const files = parseExportJson(exportJson);
  const expected = sources.map((source) => resolve(source));
  if (expected.length === 0) throw new Error("At least one maintained native source is required");
  const matchedEntries = [];
  const expectedFilenames = new Set();
  let compiledSourceDir = null;

  for (const source of expected) {
    const suffix = sourceCoverageSuffix(repoRoot, source);
    const matches = files.filter((file) => typeof file.filename === "string" && file.filename.replaceAll("\\", "/").endsWith(suffix));
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one llvm-cov mapping for maintained source ${source}; found ${matches.length}`);
    }
    const filename = matches[0].filename.replaceAll("\\", "/");
    const nextSourceDir = `${filename.slice(0, -suffix.length)}/src/main/cpp`.replaceAll("//", "/");
    if (!nextSourceDir.startsWith("/")) {
      throw new Error(`Maintained source coverage path is not absolute: ${filename}`);
    }
    if (compiledSourceDir !== null && compiledSourceDir !== nextSourceDir) {
      throw new Error("Maintained native sources use mismatched compiled source roots");
    }
    compiledSourceDir = nextSourceDir;
    expectedFilenames.add(filename);
    matchedEntries.push({
      source,
      filename,
      summary: normalizeExportSummary(matches[0].summary),
    });
  }

  const unknownSources = files
    .map((file) => String(file.filename || ""))
    .filter((filename) => !expectedFilenames.has(filename.replaceAll("\\", "/")) && !filename.split(/[\\/]/).includes("_deps"));
  if (unknownSources.length > 0) {
    throw new Error(`Unrecognized non-vendored native coverage source: ${unknownSources[0]}`);
  }

  return {
    sources: matchedEntries,
    compiledSourceDir,
    summary: aggregateSummaries(matchedEntries.map((entry) => entry.summary)),
  };
}

function parseReportRow(line) {
  const columns = line.trim().split(/\s+/);
  const filenameColumnCount = columns.length - 12;
  if (filenameColumnCount < 1) return null;
  const numbers = columns.slice(filenameColumnCount).map((column) => Number.parseInt(column.replace(/%$/, ""), 10));
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  return {
    filename: columns.slice(0, filenameColumnCount).join(" "),
    summary: {
      regions: { count: numbers[0], covered: numbers[0] - numbers[1] },
      lines: { count: numbers[6], covered: numbers[6] - numbers[7] },
      branches: { count: numbers[9], covered: numbers[9] - numbers[10] },
    },
  };
}

export function parseNativeCoverageSummary(report, sources, repoRoot) {
  const rows = [];
  let total = null;
  for (const line of report.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("TOTAL ")) {
      total = parseReportRow(trimmed);
      continue;
    }
    if (!trimmed || trimmed.startsWith("Filename") || /^-+$/.test(trimmed)) continue;
    const row = parseReportRow(line);
    if (row) rows.push(row);
  }
  if (!total) throw new Error("llvm-cov report has no TOTAL row");
  if (rows.length !== sources.length) {
    throw new Error(`llvm-cov source-filter mismatch: expected ${sources.length} maintained files, received ${rows.length}`);
  }
  const remainingRows = [...rows];
  for (const source of sources) {
    const suffix = sourceCoverageSuffix(repoRoot, source);
    const index = remainingRows.findIndex((row) => row.filename.replaceAll("\\", "/").endsWith(suffix));
    if (index < 0) throw new Error(`llvm-cov report is missing maintained source ${source}`);
    remainingRows.splice(index, 1);
  }
  const summary = aggregateSummaries(rows.map((row) => ({ counts: row.summary })));
  for (const key of ["regions", "lines", "branches"]) {
    if (summary.counts[key].count !== total.summary[key].count || summary.counts[key].covered !== total.summary[key].covered) {
      throw new Error(`llvm-cov TOTAL does not equal the maintained ${key} rows`);
    }
  }
  return summary;
}

export function assertNativeCoverageComplete(summary) {
  if (summary.lines !== "100.00%" || summary.branches !== "100.00%") {
    throw new Error(`Maintained native C++ coverage is incomplete (lines ${summary.lines}, branches ${summary.branches})`);
  }
  return summary;
}

export function buildNativeCoverageMetrics(summary, sources, profileCount) {
  const resolvedSources = sources.map((source) => resolve(source));
  const percentageValue = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) throw new Error(`Unrecognized llvm-cov percentage: ${value}`);
    return parsed;
  };
  return {
    formatVersion: 2,
    source: resolvedSources.length === 1 ? resolvedSources[0] : null,
    sources: resolvedSources,
    profileCount,
    coverage: {
      regions: summary.regions,
      lines: summary.lines,
      branches: summary.branches,
      linePercent: percentageValue(summary.lines),
      branchPercent: percentageValue(summary.branches),
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
  const sources = findMaintainedNativeSources(requireValue(options, "repo-root"));
  const discoveryPlan = buildNativeCoveragePlan({ ...options, profiles, sources });
  mkdirSync(discoveryPlan.outputDirectory, { recursive: true });
  execFileSync(discoveryPlan.merge.command, discoveryPlan.merge.args, { stdio: "inherit" });

  const exportJson = execFileSync(discoveryPlan.export.command, discoveryPlan.export.args, { encoding: "utf8" });
  const verifiedExport = validateNativeCoverageExport(exportJson, sources, options["repo-root"]);
  const sourceMapPlan = buildNativeCoveragePlan(
    { ...options, profiles, sources },
    verifiedExport.compiledSourceDir,
  );

  const report = execFileSync(sourceMapPlan.report.command, sourceMapPlan.report.args, { encoding: "utf8" });
  const reportSummary = parseNativeCoverageSummary(report, sources, options["repo-root"]);
  for (const key of ["regions", "lines", "branches"]) {
    if (reportSummary.counts[key].count !== verifiedExport.summary.counts[key].count ||
        reportSummary.counts[key].covered !== verifiedExport.summary.counts[key].covered) {
      throw new Error(`llvm-cov report and export disagree for maintained ${key} coverage`);
    }
  }

  writeFileSync(join(sourceMapPlan.outputDirectory, "native-coverage-summary.txt"), report);
  execFileSync(sourceMapPlan.show.command, sourceMapPlan.show.args, { stdio: "inherit" });
  const metrics = buildNativeCoverageMetrics(reportSummary, sources, profiles.length);
  writeFileSync(join(sourceMapPlan.outputDirectory, "native-coverage.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  process.stdout.write(report);
  if (requireComplete === "true") assertNativeCoverageComplete(reportSummary);
  return { ...reportSummary, ...metrics, profileData: sourceMapPlan.profileData };
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
    io.stdout(`Native source coverage: ${result.coverage.lines} lines, ${result.coverage.branches} branches (HTML and JSON reports written)\n`);
    return "ran";
  } catch (error) {
    io.stderr(`${error.message}\n`);
    io.fail();
    return "failed";
  }
}

invokeIfMain(import.meta.url, process.argv);
