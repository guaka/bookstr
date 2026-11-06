#!/usr/bin/env node
import type { Baselines, SuiteReport, TextRead } from './report-types.mjs';
type RatchetServices = {
    run?: (args: string[]) => Promise<{
        suite: string;
    }>;
    writeOutput?: (message: string) => unknown;
    writeError?: (message: string) => unknown;
    fail?: () => void;
};
export declare function validateBaselines(raw: unknown): Baselines;
export declare function checkReport(baselines: Baselines, suiteName: string, report: SuiteReport | null): {
    suite: string;
    tests: number;
    metrics: {
        [k: string]: number;
    };
};
export declare function parseArgs(args: Array<string | undefined>): Record<string, string>;
export declare function run(args: string[], io?: {
    readFile: TextRead;
}, cwd?: string): Promise<{
    suite: string;
    tests: number;
    metrics: {
        [k: string]: number;
    };
}>;
export declare function cli(args: string[], services?: RatchetServices): Promise<"failed" | "passed">;
export declare function invokeIfMain(moduleUrl: string, argv: string[], action?: (args: string[]) => Promise<string>): Promise<string>;
export {};
