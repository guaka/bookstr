# Coverage baselines

`baselines-v1.json` records the authoritative passing CI artifact used to set
each client unit-test floor. The ratchet requires the report to remain passing,
retain at least the captured test count, contain every captured metric, and
meet or exceed every percentage.

Web, Electron, and Android use the passing unit coverage artifacts captured
after repository-wide format cleanup; their source runs and merge commit are
recorded in the baseline. The latest successful iOS
artifact is retained until the next native run completes; raising a floor
requires a newer passing artifact and its run URL and commit.

End-to-end suites remain mandatory workflow checks but do not report source
coverage. Changed executable lines and decisions still require focused tests;
the project-wide ratchet is an additional guard, not a substitute.
