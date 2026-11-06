#!/usr/bin/env node
export type MetricName = 'regions' | 'lines' | 'branches';
export interface Counter {
    count: number;
    covered: number;
}
export type SummaryCounters = Record<MetricName, Counter>;
export interface NormalizedSummary {
    regions: string;
    lines: string;
    branches: string;
    counts: SummaryCounters;
}
export interface ExportFile {
    filename?: unknown;
    summary?: SummaryCounters;
}
export interface ExportPayload {
    data?: Array<{
        files?: ExportFile[];
    }>;
}
export interface NativeOptions extends Record<string, unknown> {
    profiles?: string[];
    sources?: string[];
}
export declare function collectRawProfiles(profileDirectory: string): string[];
export declare function findMaintainedNativeSources(repoRoot: string): string[];
export declare function buildNativeCoveragePlan(options: NativeOptions, coverageSourceDir?: string | null): {
    source: string | null | undefined;
    sources: string[];
    sourceRoot: string;
    profileData: string;
    export: {
        command: string;
        args: string[];
    };
    report: {
        command: string;
        args: string[];
    };
    merge: {
        command: string;
        args: string[];
    };
    show: {
        command: string;
        args: string[];
    };
    outputDirectory: string;
};
export declare function validateNativeCoverageExport(exportJson: unknown, sources: string[], repoRoot: string): {
    sources: {
        source: string;
        filename: string;
        summary: NormalizedSummary;
    }[];
    compiledSourceDir: string | null;
    summary: {
        regions: string;
        lines: string;
        branches: string;
        counts: {
            regions: {
                count: number;
                covered: number;
            };
            lines: {
                count: number;
                covered: number;
            };
            branches: {
                count: number;
                covered: number;
            };
        };
    };
};
export declare function parseNativeCoverageSummary(report: string, sources: string[], repoRoot: string): {
    regions: string;
    lines: string;
    branches: string;
    counts: {
        regions: {
            count: number;
            covered: number;
        };
        lines: {
            count: number;
            covered: number;
        };
        branches: {
            count: number;
            covered: number;
        };
    };
};
export declare function assertNativeCoverageComplete<T extends Pick<NormalizedSummary, "lines" | "branches">>(summary: T): T;
export declare function buildNativeCoverageMetrics(summary: Pick<NormalizedSummary, MetricName>, sources: string[], profileCount: number): {
    formatVersion: number;
    source: string | null | undefined;
    sources: string[];
    profileCount: number;
    coverage: {
        regions: string;
        lines: string;
        branches: string;
        linePercent: number;
        branchPercent: number;
    };
};
export declare function runNativeCoverage(options: NativeOptions): {
    regions: string;
    lines: string;
    branches: string;
    counts: {
        regions: {
            count: number;
            covered: number;
        };
        lines: {
            count: number;
            covered: number;
        };
        branches: {
            count: number;
            covered: number;
        };
    };
    formatVersion: number;
    source: string | null | undefined;
    sources: string[];
    profileCount: number;
    coverage: {
        regions: string;
        lines: string;
        branches: string;
        linePercent: number;
        branchPercent: number;
    };
    profileData: string;
};
export declare function invokeIfMain(moduleUrl: string, argv: string[], io?: {
    stdout: (message: string) => unknown;
    stderr: (message: string) => unknown;
    fail: () => void;
}): "failed" | "imported" | "ran";
