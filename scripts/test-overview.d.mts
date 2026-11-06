#!/usr/bin/env node
export { parseJUnit } from './junit.mjs';
import type { SuiteReport, IstanbulReport, XCResultCount, XCCovReport, LLVMReport } from './report-types.mjs';
export declare function parseTap(text: string): {
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
};
export declare function parseSwiftTest(text: string): {
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
};
export declare function parsePlaywright(report: {
    stats?: Record<string, unknown>;
} | null | undefined): {
    tests: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
    durationMs: number;
};
export declare function parseXCResult(summary: XCResultCount | null | undefined): {
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
};
export declare function parseIstanbul(summary: IstanbulReport | null | undefined): {
    label: string;
    value: number;
    suffix: string;
}[];
export declare function parseNodeCoverage(text: string): {
    label: string;
    value: number;
    suffix: string;
}[];
export declare function parseJacoco(xml: string): {
    label: string;
    value: number;
    suffix: string;
}[];
export declare function parseXCCov(report: XCCovReport | null | undefined): {
    label: string;
    value: number;
    suffix: string;
}[];
export declare function parseLLVM(report: LLVMReport | null | undefined): {
    label: string;
    value: number;
    suffix: string;
}[];
export declare function renderDashboard(suites: SuiteReport[]): string;
