import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const targetFilename = "/runner/work/bookstr/android/src/main/cpp/torrent_jni.cpp";
const vendorFilename = "/runner/work/bookstr/android/app/src/main/cpp/_deps/libtorrent/include/libtorrent/session.hpp";
const header = "Filename Regions Missed Regions Cover Functions Missed Functions Executed Lines Missed Lines Cover Branches Missed Branches Cover";

function metric(count: number, covered: number) {
  return { count, covered, notcovered: count - covered, percent: count === 0 ? 0 : covered * 100 / count };
}

function exportFile(filename: string, { lines = 212, coveredLines = 212, branches = 104, coveredBranches = 79, regions = 134, coveredRegions = 122 } = {}) {
  return {
    filename,
    summary: {
      regions: metric(regions, coveredRegions),
      lines: metric(lines, coveredLines),
      branches: metric(branches, coveredBranches),
    },
  };
}

function exportJson({ target = exportFile(targetFilename), vendor = exportFile(vendorFilename, { lines: 50, coveredLines: 4, branches: 8, coveredBranches: 1, regions: 60, coveredRegions: 3 }), extraFiles = [], files = null }: {target?: unknown; vendor?: unknown; extraFiles?: unknown[]; files?: unknown[] | null} = {}) {
  return JSON.stringify({ data: [{ files: files || [target, vendor, ...extraFiles], totals: {} }], type: "llvm.coverage.json.export", version: "2.0.1" });
}

function row(filename: string, { regions = 134, missedRegions = 12, functions = 14, missedFunctions = 0, executedFunctions = 14, lines = 212, missedLines = 0, branches = 104, missedBranches = 25 } = {}) {
  const pct = (count: number, missed: number) => count === 0 ? "-" : `${((count - missed) * 100 / count).toFixed(2)}%`;
  return `${filename} ${regions} ${missedRegions} ${pct(regions, missedRegions)} ${functions} ${missedFunctions} ${executedFunctions} ${lines} ${missedLines} ${pct(lines, missedLines)} ${branches} ${missedBranches} ${pct(branches, missedBranches)}`;
}

const completeReport = [
  header,
  row(targetFilename),
  row("TOTAL", { functions: 14, regions: 134, missedRegions: 12, lines: 212, branches: 104, missedBranches: 25 }),
].join("\n");

function sourceFixture(root: string) {
  const repoRoot = join(root, "repo");
  const sourceRoot = join(repoRoot, "android/app/src/main/cpp");
  mkdirSync(join(sourceRoot, "_deps"), { recursive: true });
  writeFileSync(join(sourceRoot, "torrent_jni.cpp"), "// maintained source\n");
  writeFileSync(join(sourceRoot, "_deps", "vendor.hpp"), "// third-party header\n");
  return { repoRoot, sourceRoot, source: join(sourceRoot, "torrent_jni.cpp") };
}

function coverageFixture(report = completeReport, { profile = true, exportData = exportJson() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-cli-"));
  const { repoRoot, sourceRoot, source } = sourceFixture(root);
  const bin = join(root, "ndk-bin");
  const profiles = join(root, "profiles");
  const output = join(root, "report");
  mkdirSync(bin);
  mkdirSync(profiles);
  if (profile) writeFileSync(join(profiles, "bookstr-native-coverage-test.profraw"), "fixture profile");

  const profdata = join(bin, "llvm-profdata");
  writeFileSync(profdata, `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst args=process.argv.slice(2);\nconst i=args.indexOf('-o');\nif(i<0||!args[i+1])process.exit(2);\nfs.writeFileSync(args[i+1],'merged profile');\n`);
  chmodSync(profdata, 0o755);

  const cov = join(bin, "llvm-cov");
  writeFileSync(cov, `#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
const args=process.argv.slice(2);
if(process.env.BOOKSTR_TEST_LLVM_ARGS)fs.appendFileSync(process.env.BOOKSTR_TEST_LLVM_ARGS,args.join(' ')+'\\n');
if(args[0]==='export'){process.stdout.write(process.env.BOOKSTR_TEST_LLVM_EXPORT||'');process.exit(0);}
if(args[0]==='report'){process.stdout.write(process.env.BOOKSTR_TEST_LLVM_REPORT||'');process.exit(0);}
if(args[0]==='show'){const dir=args.find(x=>x.startsWith('--output-dir='))?.slice('--output-dir='.length);if(!dir)process.exit(2);fs.mkdirSync(path.join(dir,'coverage','runner','work','bookstr','android','src','main','cpp'),{recursive:true});fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'<html>filtered source report</html>');fs.writeFileSync(path.join(dir,'coverage','runner','work','bookstr','android','src','main','cpp','torrent_jni.cpp.html'),'<html>source details</html>');process.exit(0);}
process.exit(2);
`);
  chmodSync(cov, 0o755);

  const options = {
    "ndk-bin": bin,
    object: join(root, "libbookstr_torrent.so"),
    // The workflow-provided directory intentionally differs from the source mapping
    // in export data; runNativeCoverage must discover the actual mapping.
    "compiled-source-dir": join(root, "stale-cmake-source-dir"),
    "repo-root": repoRoot,
    "output-dir": output,
    "profile-dir": profiles,
  };
  return { root, options, report, exportData, output, source, sourceRoot };
}

function withFakeTools<T>({ report = completeReport, exportData = exportJson() }, action: () => T) {
  const oldReport = process.env.BOOKSTR_TEST_LLVM_REPORT;
  const oldExport = process.env.BOOKSTR_TEST_LLVM_EXPORT;
  const oldArgs = process.env.BOOKSTR_TEST_LLVM_ARGS;
  const oldWrite = process.stdout.write;
  let stdout = "";
  process.env.BOOKSTR_TEST_LLVM_REPORT = report;
  process.env.BOOKSTR_TEST_LLVM_EXPORT = exportData;
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  try {
    const result = action();
    return { result, stdout };
  } finally {
    process.stdout.write = oldWrite;
    for (const [name, old] of [["BOOKSTR_TEST_LLVM_REPORT", oldReport], ["BOOKSTR_TEST_LLVM_EXPORT", oldExport], ["BOOKSTR_TEST_LLVM_ARGS", oldArgs]] as Array<[string, string | undefined]>) {
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    }
  }
}

function coverageArgs(options: Record<string, string>, requireComplete = "false") {
  return Object.entries({ ...options, "require-complete": requireComplete }).flatMap(([key, value]) => [`--${key}`, value]);
}

async function invokeCli(args: string[], { report = completeReport, exportData = exportJson() } = {}) {
  const scriptPath = fileURLToPath(new URL("./native-coverage.mjs", import.meta.url));
  let stderr = "";
  let exitCode = 0;
  let summaryOutput = "";
  const { invokeIfMain } = await import("./native-coverage.mjs");
  const captured = withFakeTools({ report, exportData }, () => invokeIfMain(
    pathToFileURL(scriptPath).href,
    [process.execPath, scriptPath, ...args],
    {
      stdout: (message) => { summaryOutput += message; },
      stderr: (message) => { stderr += message; },
      fail: () => { exitCode = 1; },
    },
  ));
  return { exitCode, stdout: `${captured.stdout}${summaryOutput}`, stderr, status: captured.result };
}

test("collects only nonempty Bookstr profiles recursively", async () => {
  const { collectRawProfiles } = await import("./native-coverage.mjs");
  const root = mkdtempSync(join(tmpdir(), "bookstr-profiles-"));
  try {
    mkdirSync(join(root, "nested"));
    const profile = join(root, "nested", "bookstr-native-coverage-42.profraw");
    writeFileSync(profile, "raw-profile");
    writeFileSync(join(root, "default.profraw"), "unrelated");
    assert.deepEqual(collectRawProfiles(root), [profile]);
    writeFileSync(join(root, "bookstr-native-coverage-empty.profraw"), "");
    assert.throws(() => collectRawProfiles(root), /profile is empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plans export preflight, exact maintained sources, and filtered LLVM report commands", async () => {
  const { buildNativeCoveragePlan, findMaintainedNativeSources } = await import("./native-coverage.mjs");
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-plan-"));
  try {
    const fixture = sourceFixture(root);
    const sources = findMaintainedNativeSources(fixture.repoRoot);
    assert.deepEqual(sources, [fixture.source]);
    const plan = buildNativeCoveragePlan({
      "ndk-bin": "/opt/android-ndk/bin",
      object: "/build/libbookstr_torrent.so",
      "compiled-source-dir": "/stale/compiled/cpp",
      "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-report",
      profiles: ["/tmp/profiles/a.profraw"],
      sources,
    }, "/runner/work/bookstr/android/src/main/cpp");

    assert.equal(plan.source, fixture.source);
    assert.deepEqual(plan.export.args, ["export", "/build/libbookstr_torrent.so", "--instr-profile", "/tmp/native-coverage-report/native-coverage.profdata", "--summary-only"]);
    assert.ok(plan.report.args.includes(`--path-equivalence=/runner/work/bookstr/android/src/main/cpp,${fixture.sourceRoot}`));
    const sourceFlag = plan.report.args.indexOf("--sources");
    assert.notEqual(sourceFlag, -1);
    assert.deepEqual(plan.report.args.slice(sourceFlag + 1), sources);
    assert.ok(!plan.report.args.some((argument) => argument.includes("ignore-filename-regex")));
    assert.ok(plan.show.args.includes("--show-branches=count"));
    assert.ok(plan.show.args.includes("--show-line-counts-or-regions"));
    assert.deepEqual(plan.merge.args.slice(0, 3), ["merge", "-sparse", "--failure-mode=any"]);
    assert.throws(() => buildNativeCoveragePlan({
      "ndk-bin": "/ndk/bin", object: "/build/lib.so", "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-empty", profiles: [], sources,
    }), /At least one raw profile is required/);
    assert.throws(() => buildNativeCoveragePlan({
      "ndk-bin": "/ndk/bin", object: "/build/lib.so", "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-empty", profiles: ["/tmp/profiles/a.profraw"], sources: [],
    }), /At least one maintained native source is required/);
    const unmappedPlan = buildNativeCoveragePlan({
      "ndk-bin": "/ndk/bin", object: "/build/lib.so", "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-unmapped", profiles: ["/tmp/profiles/a.profraw"], sources,
    });
    assert.deepEqual(unmappedPlan.report.args.filter((arg) => arg.startsWith("--path-equivalence=")), []);
    const discoveredPlan = buildNativeCoveragePlan({
      "ndk-bin": "/ndk/bin", object: "/build/lib.so", "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-discovered", profiles: ["/tmp/profiles/a.profraw"],
    });
    assert.deepEqual(discoveredPlan.sources, [fixture.source]);
    assert.throws(() => buildNativeCoveragePlan({ object: "/build/lib.so" }), /Missing required option: --ndk-bin/);

    const emptyRoot = join(root, "empty-repo");
    mkdirSync(join(emptyRoot, "android/app/src/main/cpp"), { recursive: true });
    assert.throws(() => findMaintainedNativeSources(emptyRoot), /No maintained native C\/C\+\+ sources found/);
    const nestedSource = join(fixture.sourceRoot, "owned", "helper.c");
    mkdirSync(dirname(nestedSource), { recursive: true });
    writeFileSync(nestedSource, "// nested maintained source\n");
    assert.ok(findMaintainedNativeSources(fixture.repoRoot).includes(nestedSource));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preflight matches every maintained source, discovers its real source root, and ignores only _deps", async () => {
  const { buildNativeCoveragePlan, findMaintainedNativeSources, validateNativeCoverageExport } = await import("./native-coverage.mjs");
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-export-"));
  try {
    const fixture = sourceFixture(root);
    const sources = findMaintainedNativeSources(fixture.repoRoot);
    const verified = validateNativeCoverageExport(exportJson(), sources, fixture.repoRoot);
    assert.equal(verified.compiledSourceDir, "/runner/work/bookstr/android/src/main/cpp");
    assert.deepEqual(verified.sources.map((entry) => entry.source), [fixture.source]);
    assert.deepEqual(verified.summary, {
      regions: "91.04%", lines: "100.00%", branches: "75.96%",
      counts: {
        regions: { count: 134, covered: 122 },
        lines: { count: 212, covered: 212 },
        branches: { count: 104, covered: 79 },
      },
    });

    const extraSource = join(fixture.sourceRoot, "extra.cpp");
    const maintainedHeader = join(fixture.sourceRoot, "native_support.hpp");
    writeFileSync(extraSource, "// new maintained source\n");
    writeFileSync(maintainedHeader, "// maintained inline implementation\n");
    const allSources = findMaintainedNativeSources(fixture.repoRoot);
    const multiSourcePlan = buildNativeCoveragePlan({
      "ndk-bin": "/ndk/bin", object: "/build/lib.so", "repo-root": fixture.repoRoot,
      "output-dir": "/tmp/native-coverage-multi", profiles: ["/tmp/profiles/a.profraw"], sources: allSources,
    });
    assert.equal(multiSourcePlan.source, null);
    assert.deepEqual(multiSourcePlan.sources, allSources);
    const exportWithExtra = exportJson({ extraFiles: [
      exportFile("/runner/work/bookstr/android/src/main/cpp/extra.cpp"),
      exportFile("/runner/work/bookstr/android/src/main/cpp/native_support.hpp", { lines: 4, coveredLines: 4, branches: 0, coveredBranches: 0, regions: 4, coveredRegions: 4 }),
    ] });
    assert.deepEqual(validateNativeCoverageExport(exportWithExtra, allSources, fixture.repoRoot).sources.map((entry) => entry.source), allSources);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed on missing, ambiguous, mismatched, or unrecognized maintained mappings", async () => {
  const { findMaintainedNativeSources, validateNativeCoverageExport } = await import("./native-coverage.mjs");
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-export-invalid-"));
  try {
    const fixture = sourceFixture(root);
    const sources = findMaintainedNativeSources(fixture.repoRoot);
    assert.throws(() => validateNativeCoverageExport(exportJson({ files: [exportFile(vendorFilename)] }), sources, fixture.repoRoot), /Expected exactly one llvm-cov mapping/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ target: exportFile("/runner/work/bookstr/wrong/path/torrent_jni.cpp") }), sources, fixture.repoRoot), /Expected exactly one llvm-cov mapping/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ extraFiles: [exportFile("/runner/work/bookstr/android/src/main/cpp/generated.cpp")] }), sources, fixture.repoRoot), /Unrecognized non-vendored native coverage source/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ extraFiles: [{ summary: exportFile(targetFilename).summary }] }), sources, fixture.repoRoot), /Unrecognized non-vendored native coverage source/);
    assert.throws(() => validateNativeCoverageExport("not json", sources, fixture.repoRoot), /valid JSON/);
    assert.throws(() => validateNativeCoverageExport("null", sources, fixture.repoRoot), /has no source files/);
    assert.throws(() => validateNativeCoverageExport({ data: [{}] }, sources, fixture.repoRoot), /has no source files/);
    assert.throws(() => validateNativeCoverageExport(exportJson(), [], fixture.repoRoot), /At least one maintained native source is required/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ target: { filename: targetFilename } }), sources, fixture.repoRoot), /has no summary/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ target: exportFile(targetFilename, { lines: -1 }) }), sources, fixture.repoRoot), /invalid coverage counters/);
    const noExecutableStatements = validateNativeCoverageExport(
      exportJson({ target: exportFile(targetFilename, { lines: 0, coveredLines: 0, branches: 0, coveredBranches: 0 }) }),
      sources,
      fixture.repoRoot,
    );
    assert.equal(noExecutableStatements.summary.lines, "100.00%");
    assert.equal(noExecutableStatements.summary.branches, "100.00%");
    const objectInput = validateNativeCoverageExport(
      { data: [{ files: [exportFile(targetFilename)] }] }, sources, fixture.repoRoot,
    );
    assert.equal(objectInput.sources.length, 1);

    const outsideSource = join(root, "outside.cpp");
    writeFileSync(outsideSource, "// outside maintained root\n");
    assert.throws(() => validateNativeCoverageExport(exportJson(), [outsideSource], fixture.repoRoot), /outside/);

    const secondSource = join(fixture.sourceRoot, "second.cpp");
    writeFileSync(secondSource, "// another source\n");
    const twoSources = [fixture.source, secondSource];
    assert.throws(() => validateNativeCoverageExport(exportJson({ extraFiles: [exportFile("relative/src/main/cpp/second.cpp")] }), twoSources, fixture.repoRoot), /not absolute/);
    assert.throws(() => validateNativeCoverageExport(exportJson({ extraFiles: [exportFile("/different/checkout/android/src/main/cpp/second.cpp")] }), twoSources, fixture.repoRoot), /mismatched compiled source roots/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses maintained source rows rather than a vendor-inflated TOTAL", async () => {
  const { assertNativeCoverageComplete, parseNativeCoverageSummary } = await import("./native-coverage.mjs");
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-report-"));
  try {
    const fixture = sourceFixture(root);
    const sources = [fixture.source];
    const summary = parseNativeCoverageSummary(completeReport, sources, fixture.repoRoot);
    assert.deepEqual(summary, {
      regions: "91.04%", lines: "100.00%", branches: "75.96%",
      counts: {
        regions: { count: 134, covered: 122 },
        lines: { count: 212, covered: 212 },
        branches: { count: 104, covered: 79 },
      },
    });
    assert.deepEqual(assertNativeCoverageComplete({ ...summary, lines: "100.00%", branches: "100.00%" }), {
      ...summary, lines: "100.00%", branches: "100.00%",
    });
    assert.throws(() => assertNativeCoverageComplete(summary), /branches 75\.96%/);

    const vendorInflated = [header, row(targetFilename), row(vendorFilename, { regions: 50, missedRegions: 47, lines: 50, missedLines: 46, branches: 8, missedBranches: 7 }), row("TOTAL", { regions: 184, missedRegions: 59, lines: 262, missedLines: 46, branches: 112, missedBranches: 32 })].join("\n");
    assert.throws(() => parseNativeCoverageSummary(vendorInflated, sources, fixture.repoRoot), /source-filter mismatch/);
    const inconsistentTotal = [header, row(targetFilename), row("TOTAL", { regions: 134, missedRegions: 12, lines: 212, missedLines: 1, branches: 104, missedBranches: 25 })].join("\n");
    assert.throws(() => parseNativeCoverageSummary(inconsistentTotal, sources, fixture.repoRoot), /TOTAL does not equal the maintained lines rows/);
    const wrongSource = [header, row("other.cpp"), row("TOTAL")].join("\n");
    assert.throws(() => parseNativeCoverageSummary(wrongSource, sources, fixture.repoRoot), /missing maintained source/);
    const withMalformedLine = [header, "junk a b c d e f g h i j k l", row(targetFilename), row("TOTAL")].join("\n");
    assert.equal(parseNativeCoverageSummary(withMalformedLine, sources, fixture.repoRoot).lines, "100.00%");
    assert.throws(() => parseNativeCoverageSummary(`${header}\n${row(targetFilename)}`, sources, fixture.repoRoot), /no TOTAL row/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("aggregates maintained source metrics and rejects invalid LLVM percentages", async () => {
  const { buildNativeCoverageMetrics, assertNativeCoverageComplete } = await import("./native-coverage.mjs");
  const summary = {
    regions: "91.04%", lines: "100.00%", branches: "75.96%",
    counts: { regions: { count: 134, covered: 122 }, lines: { count: 212, covered: 212 }, branches: { count: 104, covered: 79 } },
  };
  assert.deepEqual(buildNativeCoverageMetrics(summary, ["/src/torrent_jni.cpp"], 3), {
    formatVersion: 2,
    source: "/src/torrent_jni.cpp",
    sources: ["/src/torrent_jni.cpp"],
    profileCount: 3,
    coverage: { regions: "91.04%", lines: "100.00%", branches: "75.96%", linePercent: 100, branchPercent: 75.96 },
  });
  assert.equal(buildNativeCoverageMetrics(summary, [], 0).source, null);
  assert.throws(() => buildNativeCoverageMetrics({ ...summary, lines: "unknown" }, ["/src/a.cpp"], 1), /Unrecognized llvm-cov percentage/);
  assert.throws(() => assertNativeCoverageComplete({ ...summary, branches: "95.00%" }), /branches 95.00%/);
});

test("CLI verifies LLVM source filtering and writes source-only summary, HTML, and JSON", async () => {
  const fixture = coverageFixture();
  const argsLog = join(fixture.root, "llvm-args.log");
  const oldArgs = process.env.BOOKSTR_TEST_LLVM_ARGS;
  process.env.BOOKSTR_TEST_LLVM_ARGS = argsLog;
  try {
    const result = await invokeCli(coverageArgs(fixture.options, "false"), { report: fixture.report, exportData: fixture.exportData });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /torrent_jni\.cpp/);
    assert.match(result.stdout, /TOTAL/);
    assert.match(result.stdout, /Native source coverage: 100\.00% lines, 75\.96% branches/);
    assert.equal(result.stderr, "");
    assert.equal(readFileSync(join(fixture.output, "native-coverage.profdata"), "utf8"), "merged profile");
    assert.equal(readFileSync(join(fixture.output, "native-coverage-summary.txt"), "utf8"), fixture.report);
    assert.equal(readFileSync(join(fixture.output, "index.html"), "utf8"), "<html>filtered source report</html>");
    assert.equal(readFileSync(join(fixture.output, "coverage/runner/work/bookstr/android/src/main/cpp/torrent_jni.cpp.html"), "utf8"), "<html>source details</html>");
    assert.deepEqual(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")), {
      formatVersion: 2,
      source: fixture.source,
      sources: [fixture.source],
      profileCount: 1,
      coverage: { regions: "91.04%", lines: "100.00%", branches: "75.96%", linePercent: 100, branchPercent: 75.96 },
    });
    const args = readFileSync(argsLog, "utf8");
    assert.match(args, /--path-equivalence=\/runner\/work\/bookstr\/android\/src\/main\/cpp,/);
    assert.match(args, /--sources .*android\/app\/src\/main\/cpp\/torrent_jni\.cpp/);
    assert.doesNotMatch(args, /ignore-filename-regex/);
  } finally {
    if (oldArgs === undefined) delete process.env.BOOKSTR_TEST_LLVM_ARGS;
    else process.env.BOOKSTR_TEST_LLVM_ARGS = oldArgs;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("coverage runner returns metrics when reporting and throws after writing artifacts when gated", async () => {
  const { runNativeCoverage } = await import("./native-coverage.mjs");
  const fixture = coverageFixture();
  try {
    const { result, stdout } = withFakeTools(fixture, () => runNativeCoverage({ ...fixture.options, "require-complete": "false" }));
    assert.equal(result.coverage.lines, "100.00%");
    assert.equal(result.coverage.branches, "75.96%");
    assert.match(stdout, /torrent_jni\.cpp/);
    assert.equal(result.profileCount, 1);

    const defaultGate = withFakeTools(fixture, () => runNativeCoverage(fixture.options));
    assert.equal(defaultGate.result.coverage.lines, "100.00%");

    const incompleteReport = [header, row(targetFilename, { lines: 212, missedLines: 2, branches: 104, missedBranches: 5 }), row("TOTAL", { regions: 134, missedRegions: 12, lines: 212, missedLines: 2, branches: 104, missedBranches: 5 })].join("\n");
    const incompleteExport = exportJson({ target: exportFile(targetFilename, { lines: 212, coveredLines: 210, branches: 104, coveredBranches: 99 }) });
    assert.throws(() => withFakeTools({ report: incompleteReport, exportData: incompleteExport }, () => runNativeCoverage({ ...fixture.options, "require-complete": "true" })), /Maintained native C\+\+ coverage is incomplete/);
    assert.equal(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")).coverage.linePercent, 99.06);
    assert.throws(() => runNativeCoverage({ ...fixture.options, "require-complete": "yes" }), /--require-complete must be true or false/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("incomplete coverage can be reported without enabling the completeness gate", async () => {
  const incompleteReport = [header, row(targetFilename, { lines: 212, missedLines: 2, branches: 104, missedBranches: 5 }), row("TOTAL", { regions: 134, missedRegions: 12, lines: 212, missedLines: 2, branches: 104, missedBranches: 5 })].join("\n");
  const incompleteExport = exportJson({ target: exportFile(targetFilename, { lines: 212, coveredLines: 210, branches: 104, coveredBranches: 99 }) });
  const fixture = coverageFixture(incompleteReport, { exportData: incompleteExport });
  try {
    const result = await invokeCli(coverageArgs(fixture.options), { report: incompleteReport, exportData: incompleteExport });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Native source coverage: 99\.06% lines, 95\.19% branches/);
    assert.equal(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")).coverage.linePercent, 99.06);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI fails closed when report filtering returns vendor rows or export paths do not match", async () => {
  const fixture = coverageFixture();
  try {
    const vendorReport = [header, row(targetFilename), row(vendorFilename, { regions: 50, missedRegions: 47, lines: 50, missedLines: 46, branches: 8, missedBranches: 7 }), row("TOTAL", { regions: 184, missedRegions: 59, lines: 262, missedLines: 46, branches: 112, missedBranches: 32 })].join("\n");
    const leaked = await invokeCli(coverageArgs(fixture.options), { report: vendorReport, exportData: fixture.exportData });
    assert.equal(leaked.exitCode, 1);
    assert.match(leaked.stderr, /source-filter mismatch/);
    assert.equal(existsSync(join(fixture.output, "native-coverage-summary.txt")), false);

    const mismatchedExport = exportJson({ target: exportFile("/runner/work/bookstr/wrong/cpp/torrent_jni.cpp") });
    const mismatch = await invokeCli(coverageArgs(fixture.options), { report: fixture.report, exportData: mismatchedExport });
    assert.equal(mismatch.exitCode, 1);
    assert.match(mismatch.stderr, /Expected exactly one llvm-cov mapping/);

    const disagreeingReport = [header, row(targetFilename, { lines: 212, missedLines: 1 }), row("TOTAL", { regions: 134, missedRegions: 12, lines: 212, missedLines: 1, branches: 104, missedBranches: 25 })].join("\n");
    const disagreement = await invokeCli(coverageArgs(fixture.options), { report: disagreeingReport, exportData: fixture.exportData });
    assert.equal(disagreement.exitCode, 1);
    assert.match(disagreement.stderr, /report and export disagree for maintained lines/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI requires a valid source export, a TOTAL row, and all required tools", async () => {
  const malformedExport = coverageFixture(completeReport, { exportData: "not JSON" });
  try {
    const result = await invokeCli(coverageArgs(malformedExport.options), { report: malformedExport.report, exportData: malformedExport.exportData });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /valid JSON/);
    assert.equal(existsSync(join(malformedExport.output, "native-coverage-summary.txt")), false);
  } finally {
    rmSync(malformedExport.root, { recursive: true, force: true });
  }

  const malformedReport = coverageFixture("llvm-cov emitted no summary");
  try {
    const result = await invokeCli(coverageArgs(malformedReport.options), { report: malformedReport.report, exportData: malformedReport.exportData });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /llvm-cov report has no TOTAL row/);
    assert.equal(existsSync(join(malformedReport.output, "native-coverage-summary.txt")), false);
  } finally {
    rmSync(malformedReport.root, { recursive: true, force: true });
  }

  const noProfiles = coverageFixture(completeReport, { profile: false });
  try {
    const result = await invokeCli(coverageArgs(noProfiles.options));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /No Bookstr native profiles found/);
    assert.equal(existsSync(noProfiles.output), false);
  } finally {
    rmSync(noProfiles.root, { recursive: true, force: true });
  }

  const invalid = await invokeCli(["--ndk-bin"]);
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /Invalid argument: --ndk-bin/);
  const invalidGate = await invokeCli(["--require-complete", "sometimes"]);
  assert.equal(invalidGate.exitCode, 1);
  assert.match(invalidGate.stderr, /--require-complete must be true or false/);
});

test("CLI reports LLVM tool failures and direct invocation outcomes", async () => {
  const failedTool = coverageFixture();
  try {
    const profdata = join(failedTool.options["ndk-bin"], "llvm-profdata");
    writeFileSync(profdata, "#!/usr/bin/env node\nprocess.exit(9);\n");
    chmodSync(profdata, 0o755);
    const result = await invokeCli(coverageArgs(failedTool.options));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Command failed/);
    assert.equal(existsSync(join(failedTool.output, "native-coverage-summary.txt")), false);
  } finally {
    rmSync(failedTool.root, { recursive: true, force: true });
  }

  const { invokeIfMain } = await import("./native-coverage.mjs");
  const fixture = coverageFixture();
  const scriptPath = fileURLToPath(new URL("./native-coverage.mjs", import.meta.url));
  const oldWrite = process.stderr.write;
  const oldExitCode = process.exitCode;
  let stderr = "";
  try {
    const success = withFakeTools(fixture, () => invokeIfMain(
      pathToFileURL(scriptPath).href,
      [process.execPath, scriptPath, ...coverageArgs(fixture.options)],
    ));
    assert.equal(success.result, "ran");
    assert.match(success.stdout, /Native source coverage: 100\.00% lines, 75\.96% branches/);

    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    process.exitCode = 0;
    const failure = invokeIfMain(pathToFileURL(scriptPath).href, [process.execPath, scriptPath, "--require-complete", "invalid"]);
    assert.equal(failure, "failed");
    assert.match(stderr, /--require-complete must be true or false/);
    assert.equal(process.exitCode, 1);
    assert.equal(invokeIfMain(pathToFileURL(scriptPath).href, []), "imported");
  } finally {
    process.stderr.write = oldWrite;
    process.exitCode = oldExitCode;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CMake opts in only on debug and instruments the maintained JNI target", async () => {
  const cmake = await readFile(new URL("../app/src/main/cpp/CMakeLists.txt", import.meta.url), "utf8");
  assert.match(cmake, /option\(BOOKSTR_NATIVE_COVERAGE .* OFF\)/);
  assert.match(cmake, /if\(NOT CMAKE_BUILD_TYPE STREQUAL "Debug"\)/);
  const targetOptions = cmake.slice(cmake.indexOf("if(BOOKSTR_NATIVE_COVERAGE)"));
  assert.match(targetOptions, /target_compile_options\(bookstr_torrent PRIVATE/);
  assert.match(targetOptions, /-fprofile-instr-generate/);
  assert.match(targetOptions, /-fcoverage-mapping/);
  assert.match(targetOptions, /target_link_options\(bookstr_torrent PRIVATE -fprofile-instr-generate\)/);
  assert.doesNotMatch(cmake, /add_compile_options\([^)]*fcoverage/);
  const gradle = await readFile(new URL("../app/build.gradle.kts", import.meta.url), "utf8");
  assert.match(gradle, /bookstr\.nativeCoverage/);
  assert.match(gradle, /-DBOOKSTR_NATIVE_COVERAGE=\$\{if \(nativeCoverage == "true"\) "ON" else "OFF"\}/);
  assert.match(gradle, /orElse\("false"\)/);
  assert.match(gradle, /-DBOOKSTR_NATIVE_COVERAGE=.*OFF/);
  const cpp = await readFile(new URL("../app/src/main/cpp/torrent_jni.cpp", import.meta.url), "utf8");
  assert.match(cpp, /__llvm_profile_set_filename/);
  assert.match(cpp, /__llvm_profile_write_file/);
  assert.match(cpp, /Java_app_bookstr_download_NativeTorrentEngine_destroy/);
  assert.match(cpp, /write_coverage_profile\(\);/);
});
