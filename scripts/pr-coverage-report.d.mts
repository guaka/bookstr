import type { SuiteReport } from './report-types.mjs';
export declare function renderCoverageReport({ reports, workflow, runUrl, marker }?: {
    reports?: SuiteReport[];
    workflow?: string;
    runUrl?: string;
    marker?: string;
}): string;
export declare function readCoverageReports(inputDir: string): Promise<SuiteReport[]>;
export declare function parseArgs(argv: string[]): Record<string, string>;
export declare function main(argv?: string[]): Promise<void>;
