import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compareWorkflowOutsideRoutingJob,
  compareSuiteBaselineChange,
  runPlatformBaselineRoutingCli,
} from "./platform-baseline-routing.mjs";

const baselineText = readFileSync(new URL("../shared/coverage/baselines-v1.json", import.meta.url), "utf8");
const baseline = JSON.parse(baselineText);
const iosWorkflow = readFileSync(new URL("../.github/workflows/ios.yml", import.meta.url), "utf8");

test("routes only the suite whose baseline object changed and ignores capture metadata", () => {
  const androidChanged = structuredClone(baseline);
  androidChanged.suites.android.minimumTests += 1;
  androidChanged.capturedAt = "2026-11-05T00:00:00Z";

  assert.equal(compareSuiteBaselineChange("android", baselineText, JSON.stringify(androidChanged)), true);
  for (const suite of ["ios", "web", "electron"]) {
    assert.equal(compareSuiteBaselineChange(suite, baselineText, JSON.stringify(androidChanged)), false);
  }
  assert.equal(compareSuiteBaselineChange("ios", baselineText, baselineText), false);
});

test("routes all suites for changed global schema, missing suites, or invalid baseline data", () => {
  const changedVersion = structuredClone(baseline);
  changedVersion.version = 2;
  const missingSuite = structuredClone(baseline);
  delete missingSuite.suites.ios;
  const extraRootField = { ...baseline, futureSchemaField: true };
  const badMetric = structuredClone(baseline);
  badMetric.suites.web.metrics.Lines = 101;
  const badMetricInfinityText = JSON.stringify(baseline).replace('"Lines":100', '"Lines":1e999');
  const metricSchemaChanged = structuredClone(baseline);
  metricSchemaChanged.suites.android.metrics.FutureMetric = 1;
  const rootKeysChanged = { version: 1, capturedAt: baseline.capturedAt, futureSchemaField: true };
  const suiteKeysChanged = structuredClone(baseline);
  delete suiteKeysChanged.suites.ios.commit;
  suiteKeysChanged.suites.ios.revision = "f".repeat(40);
  const invalidCapturedAt = structuredClone(baseline);
  invalidCapturedAt.capturedAt = "not a date";
  const nonStringCapturedAt = structuredClone(baseline);
  nonStringCapturedAt.capturedAt = 4;

  for (const text of [
    JSON.stringify(changedVersion),
    JSON.stringify(missingSuite),
    JSON.stringify(extraRootField),
    JSON.stringify(rootKeysChanged),
    JSON.stringify(badMetric),
    JSON.stringify(metricSchemaChanged),
    badMetricInfinityText,
    JSON.stringify(suiteKeysChanged),
    JSON.stringify(invalidCapturedAt),
    JSON.stringify(nonStringCapturedAt),
    "not json",
    "null",
    "[]",
    "1",
  ]) {
    assert.equal(compareSuiteBaselineChange("ios", baselineText, text), true);
  }
  assert.equal(compareSuiteBaselineChange("ios", "null", baselineText), true);
  assert.equal(compareSuiteBaselineChange("unknown", baselineText, baselineText), true);
});

test("fails closed for every malformed suite field", () => {
  const variants = [];
  const updateSuite = (modify) => {
    const value = structuredClone(baseline);
    modify(value.suites.ios);
    variants.push(JSON.stringify(value));
  };
  updateSuite((suite) => { suite.minimumTests = "421"; });
  updateSuite((suite) => { suite.minimumTests = -1; });
  updateSuite((suite) => { suite.source = 3; });
  updateSuite((suite) => { suite.source = "  "; });
  updateSuite((suite) => { suite.commit = 3; });
  updateSuite((suite) => { suite.commit = "bad"; });
  updateSuite((suite) => { suite.metrics = []; });
  updateSuite((suite) => { suite.metrics = {}; });
  updateSuite((suite) => { delete suite.metrics.Lines; });
  updateSuite((suite) => { suite.metrics.Lines = "100"; });
  updateSuite((suite) => { suite.metrics.Lines = -1; });

  for (const text of variants) assert.equal(compareSuiteBaselineChange("ios", baselineText, text), true);
});

test("workflow comparison ignores only a valid changes-routing job", () => {
  const routeOnly = iosWorkflow.replace("name: Route iOS checks", "name: Route iOS checks updated");
  const buildStep = iosWorkflow.replace("runs-on: macos-26", "runs-on: macos-15");
  const globalPermission = iosWorkflow.replace("  contents: read", "  contents: write");

  assert.equal(compareWorkflowOutsideRoutingJob(iosWorkflow, routeOnly), false);
  assert.equal(compareWorkflowOutsideRoutingJob(iosWorkflow, iosWorkflow), false);
  assert.equal(compareWorkflowOutsideRoutingJob(iosWorkflow, buildStep), true);
  assert.equal(compareWorkflowOutsideRoutingJob(iosWorkflow, globalPermission), true);
});

test("workflow comparison fails closed when a changes job is absent, duplicated, or malformed", () => {
  const withoutRouteJob = iosWorkflow.replace(/  changes:\n[\s\S]*?(?=^  ios:\n)/m, "");
  const duplicateRouteJob = `${iosWorkflow}\n  changes:\n    steps: []\n`;
  const unclosedRouteJob = "name: Workflow\njobs:\n  changes:\n    steps:\n      - run: echo route\n";
  const emptyRouteJob = "name: Workflow\njobs:\n  changes:\n  ios:\n    steps:\n      - run: echo native\n";
  const invalidIndentRouteJob = "name: Workflow\njobs:\n  changes:\n   malformed: true\n  ios:\n    steps:\n      - run: echo native\n";
  const mixedIndentRouteJob = "name: Workflow\njobs:\n  changes:\n    name: Route\n   malformed: true\n  ios:\n    steps:\n      - run: echo native\n";

  for (const malformed of [withoutRouteJob, duplicateRouteJob, unclosedRouteJob, emptyRouteJob, invalidIndentRouteJob, mixedIndentRouteJob, null]) {
    assert.equal(compareWorkflowOutsideRoutingJob(iosWorkflow, malformed), true);
  }
});

test("CLI reads base and head files and fails closed for malformed arguments or unreadable files", () => {
  const directory = mkdtempSync(join(tmpdir(), "platform-baseline-routing-"));
  try {
    const basePath = join(directory, "base.json");
    const headPath = join(directory, "head.json");
    const workflowPath = join(directory, "workflow.yml");
    const routeOnlyPath = join(directory, "route-only.yml");
    writeFileSync(basePath, baselineText);
    writeFileSync(workflowPath, iosWorkflow);
    writeFileSync(routeOnlyPath, iosWorkflow.replace("name: Route iOS checks", "name: Route iOS checks revised"));
    const webChanged = structuredClone(baseline);
    webChanged.suites.web.minimumTests += 1;
    writeFileSync(headPath, JSON.stringify(webChanged));

    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--base", basePath, "--head", headPath]), "false");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "web", "--base", basePath, "--head", headPath]), "true");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--base", basePath, "--head"]), "true");
    assert.equal(runPlatformBaselineRoutingCli([]), "true");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--base", "--head", headPath]), "true");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--base", basePath, "--head", headPath, "--extra", "x"]), "true");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--suite", "web", "--base", basePath, "--head", headPath]), "true");
    assert.equal(runPlatformBaselineRoutingCli(["--suite", "ios", "--base", join(directory, "missing"), "--head", headPath]), "true");
    assert.equal(runPlatformBaselineRoutingCli([
      "--suite", "ios", "--base", basePath, "--head", basePath,
      "--workflow-base", workflowPath, "--workflow-head", routeOnlyPath,
    ]), "false");
    assert.equal(runPlatformBaselineRoutingCli([
      "--suite", "ios", "--base", basePath, "--head", basePath,
      "--workflow-base", workflowPath,
    ]), "true");
    assert.equal(runPlatformBaselineRoutingCli([
      "--suite", "ios", "--base", basePath, "--head", basePath,
      "--workflow-base", join(directory, "missing"), "--workflow-head", routeOnlyPath,
    ]), "true");

    const command = spawnSync(process.execPath, [
      new URL("./platform-baseline-routing-cli.mjs", import.meta.url).pathname,
      "--suite", "ios", "--base", basePath, "--head", basePath,
      "--workflow-base", workflowPath, "--workflow-head", routeOnlyPath,
    ], { encoding: "utf8" });
    assert.equal(command.status, 0);
    assert.equal(command.stdout, "false\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
