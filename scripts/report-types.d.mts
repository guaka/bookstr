export interface TestResults {
    tests?: number;
    passed?: number;
    failed?: number;
    skipped?: number;
    flaky?: number;
    durationMs?: number;
}
export interface CoverageMetric {
    label: string;
    value: number;
    suffix?: string;
}
export interface SuiteReport {
    id?: string;
    suite?: string;
    status?: string;
    recorded?: string;
    runUrl?: string;
    commit?: string;
    knownTests?: number;
    results?: TestResults;
    coverage?: CoverageMetric[];
}
export interface BaselineSuite {
    minimumTests: number;
    source: string;
    commit: string;
    metrics: Record<string, number>;
}
export interface Baselines {
    version: number;
    capturedAt: string;
    suites: Record<string, BaselineSuite>;
}
export type TextRead = (path: string, encoding: 'utf8') => Promise<string>;
export interface CoverageCell {
    count?: unknown;
    covered?: unknown;
    pct?: unknown;
}
export interface IstanbulReport {
    total?: Record<string, CoverageCell>;
}
export interface XCResultCount {
    [key: string]: unknown;
    statistics?: Array<{
        title?: string;
        value?: unknown;
    }>;
    devicesAndConfigurations?: Record<string, unknown>[];
    totalTestCount?: unknown;
    finishTime?: unknown;
    startTime?: unknown;
}
export interface XCCovTarget {
    name?: unknown;
    executableLines?: unknown;
    coveredLines?: unknown;
    lineCoverage?: unknown;
}
export interface XCCovReport extends XCCovTarget {
    targets?: XCCovTarget[];
}
export interface LLVMFile {
    filename?: unknown;
    segments?: Array<Array<number | boolean>>;
    summary?: Record<string, CoverageCell>;
}
export interface LLVMReport {
    data?: Array<{
        files?: LLVMFile[];
    }>;
}
