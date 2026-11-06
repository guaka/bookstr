import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const completeReport = [
  "Filename Regions Missed Regions Cover Functions Missed Functions Executed Lines Missed Lines Cover Branches Missed Branches Cover",
  "TOTAL 40 0 100.00% 12 0 12 40 0 100.00% 20 0 100.00%",
].join("\n");

function coverageFixture(report = completeReport, { profile = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "bookstr-native-cli-"));
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
  writeFileSync(cov, `#!/usr/bin/env node\nconst fs=require('node:fs');\nconst path=require('node:path');\nconst args=process.argv.slice(2);\nif(args[0]==='report'){process.stdout.write(process.env.BOOKSTR_TEST_LLVM_REPORT||'');process.exit(0);}\nif(args[0]==='show'){const dir=args.find(x=>x.startsWith('--output-dir='))?.slice('--output-dir='.length);if(!dir)process.exit(2);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),'<html>fixture</html>');process.exit(0);}\nprocess.exit(2);\n`);
  chmodSync(cov, 0o755);

  const options = {
    "ndk-bin": bin,
    object: join(root, "libbookstr_torrent.so"),
    "compiled-source-dir": join(root, "compiled", "cpp"),
    "repo-root": process.cwd(),
    "output-dir": output,
    "profile-dir": profiles,
  };
  return { root, options, report, output };
}

async function invokeCli(args, report = completeReport) {
  const scriptPath = fileURLToPath(new URL("./native-coverage.mjs", import.meta.url));
  let stderr = "";
  let exitCode = 0;
  let summaryOutput = "";
  const { invokeIfMain } = await import("./native-coverage.mjs");
  const captured = withFakeReport(report, () => invokeIfMain(
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

function coverageArgs(options, requireComplete = "false") {
  return Object.entries({ ...options, "require-complete": requireComplete }).flatMap(([key, value]) => [`--${key}`, value]);
}

function withFakeReport(report, action) {
  const oldReport = process.env.BOOKSTR_TEST_LLVM_REPORT;
  const oldWrite = process.stdout.write;
  let stdout = "";
  process.env.BOOKSTR_TEST_LLVM_REPORT = report;
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  try {
    const result = action();
    return { result, stdout };
  } finally {
    process.stdout.write = oldWrite;
    if (oldReport === undefined) delete process.env.BOOKSTR_TEST_LLVM_REPORT;
    else process.env.BOOKSTR_TEST_LLVM_REPORT = oldReport;
  }
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

test("plans merge, source remapping, summary, and HTML commands for maintained JNI source only", async () => {
  const { buildNativeCoveragePlan } = await import("./native-coverage.mjs");
  const repoRoot = resolve("/workspace/bookstr");
  const localSourceDir = join(repoRoot, "android/app/src/main/cpp");
  const plan = buildNativeCoveragePlan({
    "ndk-bin": "/opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin",
    object: "/build/cmake/obj/x86_64/libbookstr_torrent.so",
    "compiled-source-dir": "/build/source/android/app/src/main/cpp",
    "repo-root": repoRoot,
    "output-dir": "/tmp/native-coverage-report",
    profiles: ["/tmp/profiles/a.profraw", "/tmp/profiles/b.profraw"],
  });

  assert.equal(plan.source, join(localSourceDir, "torrent_jni.cpp"));
  assert.equal(plan.merge.command, "/opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-profdata");
  assert.deepEqual(plan.merge.args.slice(0, 3), ["merge", "-sparse", "--failure-mode=any"]);
  assert.deepEqual(plan.merge.args.slice(-3), ["/tmp/profiles/b.profraw", "-o", "/tmp/native-coverage-report/native-coverage.profdata"]);
  assert.ok(plan.report.args.includes(`--path-equivalence=/build/source/android/app/src/main/cpp,${localSourceDir}`));
  for (const command of [plan.report, plan.show]) {
    const sourceFlag = command.args.indexOf("--sources");
    assert.notEqual(sourceFlag, -1);
    assert.equal(command.args[sourceFlag + 1], plan.source);
    assert.ok(!command.args.includes(`--sources=${plan.source}`));
  }
  assert.ok(plan.show.args.includes("--show-branches=count"));
  assert.ok(plan.show.args.includes("--show-line-counts-or-regions"));
  assert.throws(() => buildNativeCoveragePlan({
    "ndk-bin": "/ndk/bin", object: "/build/lib.so", "compiled-source-dir": "/compiled/cpp",
    "repo-root": repoRoot, "output-dir": "/tmp/native-coverage-empty", profiles: [],
  }), /At least one raw profile is required/);
});

test("requires complete line and branch coverage from the llvm-cov TOTAL row", async () => {
  const { assertNativeCoverageComplete, parseNativeCoverageSummary } = await import("./native-coverage.mjs");
  const report = [
    "Filename Regions Missed Regions Cover Functions Missed Functions Executed Lines Missed Lines Cover Branches Missed Branches Cover",
    "TOTAL 40 0 100.00% 12 0 12 40 0 100.00% 20 0 100.00%",
  ].join("\n");
  assert.deepEqual(parseNativeCoverageSummary(report), { regions: "100.00%", lines: "100.00%", branches: "100.00%" });
  assert.deepEqual(assertNativeCoverageComplete(report), { regions: "100.00%", lines: "100.00%", branches: "100.00%" });
  assert.throws(() => assertNativeCoverageComplete(report.replace("20 0 100.00%", "20 1 95.00%")), /branches 95.00%/);
  assert.throws(() => assertNativeCoverageComplete(report.replace("40 0 100.00% 20 0 100.00%", "40 1 97.50% 20 0 100.00%")), /lines 97.50%/);
  assert.throws(() => parseNativeCoverageSummary("llvm-cov emitted no summary"), /no TOTAL row/);
  assert.throws(() => parseNativeCoverageSummary("TOTAL 1 2"), /Unrecognized llvm-cov TOTAL row/);
});

test("records measured metrics independently of the optional completeness gate", async () => {
  const { buildNativeCoverageMetrics, parseNativeCoverageSummary } = await import("./native-coverage.mjs");
  const report = "TOTAL 40 1 97.50% 12 0 12 40 2 95.00% 20 1 95.00%";
  const summary = parseNativeCoverageSummary(report);
  assert.deepEqual(buildNativeCoverageMetrics(summary, "/src/torrent_jni.cpp", 3), {
    formatVersion: 1,
    source: "/src/torrent_jni.cpp",
    profileCount: 3,
    coverage: {
      regions: "97.50%",
      lines: "95.00%",
      branches: "95.00%",
      linePercent: 95,
      branchPercent: 95,
    },
  });
  assert.throws(() => buildNativeCoverageMetrics({ ...summary, lines: "unknown" }, "/src/a.cpp", 1), /Unrecognized llvm-cov percentage/);
});

test("CLI runs fake LLVM tools and writes merged profile, HTML, JSON, summary, and success message", async () => {
  const fixture = coverageFixture();
  try {
    const result = await invokeCli(coverageArgs(fixture.options, "true"), fixture.report);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /TOTAL 40 0 100\.00%/);
    assert.match(result.stdout, /Native source coverage: 100\.00% lines, 100\.00% branches/);
    assert.equal(result.stderr, "");
    assert.equal(readFileSync(join(fixture.output, "native-coverage.profdata"), "utf8"), "merged profile");
    assert.equal(readFileSync(join(fixture.output, "native-coverage-summary.txt"), "utf8"), fixture.report);
    assert.equal(readFileSync(join(fixture.output, "index.html"), "utf8"), "<html>fixture</html>");
    assert.deepEqual(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")), {
      formatVersion: 1,
      source: resolve(process.cwd(), "android/app/src/main/cpp/torrent_jni.cpp"),
      profileCount: 1,
      coverage: {
        regions: "100.00%", lines: "100.00%", branches: "100.00%",
        linePercent: 100, branchPercent: 100,
      },
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("coverage runner returns measured metrics when reporting and throws after writing artifacts when gated", async () => {
  const { runNativeCoverage } = await import("./native-coverage.mjs");
  const fixture = coverageFixture();
  try {
    const { result, stdout } = withFakeReport(fixture.report, () => runNativeCoverage({
      ...fixture.options,
      "require-complete": "false",
    }));
    assert.equal(result.lines, "100.00%");
    assert.equal(result.branches, "100.00%");
    assert.match(stdout, /TOTAL 40 0 100\.00%/);
    assert.equal(result.profileCount, 1);

    const defaultGate = withFakeReport(fixture.report, () => runNativeCoverage(fixture.options));
    assert.equal(defaultGate.result.lines, "100.00%");

    const incomplete = "TOTAL 40 1 97.50% 12 0 12 40 2 95.00% 20 1 95.00%";
    assert.throws(() => withFakeReport(incomplete, () => runNativeCoverage({
      ...fixture.options,
      "require-complete": "true",
    })), /Maintained native C\+\+ coverage is incomplete/);
    assert.equal(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")).coverage.branchPercent, 95);
    assert.throws(() => runNativeCoverage({ ...fixture.options, "require-complete": "yes" }), /--require-complete must be true or false/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI entry uses default stdio and exit status when invoked directly", async () => {
  const { invokeIfMain } = await import("./native-coverage.mjs");
  const fixture = coverageFixture();
  const scriptPath = fileURLToPath(new URL("./native-coverage.mjs", import.meta.url));
  const oldWrite = process.stderr.write;
  const oldExitCode = process.exitCode;
  let stderr = "";
  try {
    const success = withFakeReport(fixture.report, () => invokeIfMain(
      pathToFileURL(scriptPath).href,
      [process.execPath, scriptPath, ...coverageArgs(fixture.options)],
    ));
    assert.equal(success.result, "ran");
    assert.match(success.stdout, /Native source coverage: 100\.00% lines, 100\.00% branches/);

    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    process.exitCode = 0;
    const failure = invokeIfMain(
      pathToFileURL(scriptPath).href,
      [process.execPath, scriptPath, "--require-complete", "invalid"],
    );
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

test("incomplete coverage fails only after measured JSON and HTML artifacts are written", async () => {
  const fixture = coverageFixture("TOTAL 40 1 97.50% 12 0 12 40 2 95.00% 20 1 95.00%");
  try {
    const result = await invokeCli(coverageArgs(fixture.options, "true"), fixture.report);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /TOTAL 40 1 97\.50%/);
    assert.match(result.stderr, /Maintained native C\+\+ coverage is incomplete \(lines 95\.00%, branches 95\.00%\)/);
    assert.equal(readFileSync(join(fixture.output, "index.html"), "utf8"), "<html>fixture</html>");
    const measured = JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8"));
    assert.equal(measured.coverage.linePercent, 95);
    assert.equal(measured.coverage.branchPercent, 95);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("incomplete coverage can be reported without enabling the completeness gate", async () => {
  const fixture = coverageFixture("TOTAL 40 1 97.50% 12 0 12 40 2 95.00% 20 1 95.00%");
  try {
    const result = await invokeCli(coverageArgs(fixture.options), fixture.report);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Native source coverage: 95\.00% lines, 95\.00% branches/);
    assert.equal(JSON.parse(readFileSync(join(fixture.output, "native-coverage.json"), "utf8")).coverage.linePercent, 95);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI reports missing profiles, malformed llvm-cov summaries, and invalid arguments", async () => {
  const noProfiles = coverageFixture(completeReport, { profile: false });
  try {
    const result = await invokeCli(coverageArgs(noProfiles.options));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /No Bookstr native profiles found/);
    assert.equal(existsSync(noProfiles.output), false);
  } finally {
    rmSync(noProfiles.root, { recursive: true, force: true });
  }

  const malformed = coverageFixture("llvm-cov did not print a TOTAL row");
  try {
    const result = await invokeCli(coverageArgs(malformed.options), malformed.report);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /llvm-cov report has no TOTAL row/);
    assert.equal(readFileSync(join(malformed.output, "native-coverage-summary.txt"), "utf8"), malformed.report);
    assert.equal(readFileSync(join(malformed.output, "index.html"), "utf8"), "<html>fixture</html>");
    assert.equal(existsSync(join(malformed.output, "native-coverage.json")), false);
  } finally {
    rmSync(malformed.root, { recursive: true, force: true });
  }

  const invalid = await invokeCli(["--ndk-bin"]);
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.stderr, /Invalid argument: --ndk-bin/);
  const invalidGate = await invokeCli(["--require-complete", "sometimes"]);
  assert.equal(invalidGate.exitCode, 1);
  assert.match(invalidGate.stderr, /--require-complete must be true or false/);
});

test("CLI reports missing required options and LLVM tool failures instead of claiming coverage", async () => {
  const missing = coverageFixture();
  try {
    const optionsWithoutNdk = { ...missing.options };
    delete optionsWithoutNdk["ndk-bin"];
    const result = await invokeCli(coverageArgs(optionsWithoutNdk));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Missing required option: --ndk-bin/);
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const failedTool = coverageFixture();
  try {
    const profdata = join(failedTool.options["ndk-bin"], "llvm-profdata");
    writeFileSync(profdata, "#!/usr/bin/env node\nprocess.exit(9);\n");
    chmodSync(profdata, 0o755);
    const result = await invokeCli(coverageArgs(failedTool.options));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Command failed/);
    assert.equal(existsSync(failedTool.output), true);
    assert.equal(existsSync(join(failedTool.output, "native-coverage-summary.txt")), false);
  } finally {
    rmSync(failedTool.root, { recursive: true, force: true });
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
