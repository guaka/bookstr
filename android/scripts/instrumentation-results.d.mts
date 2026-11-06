#!/usr/bin/env node
export type CaseStatus = 'passed' | 'error' | 'failure' | 'skipped' | 'incomplete';
export interface InstrumentationCase {
    name: string;
    className: string;
    status: CaseStatus;
    message: string;
    stack: string;
    duration: number;
}
export interface InstrumentationResult {
    cases: InstrumentationCase[];
    problems: string[];
    passed: number;
    failures: number;
    errors: number;
    skipped: number;
    success: boolean;
}
/** Parse AndroidJUnitRunner's instrumentation status protocol. */
export declare function parseInstrumentation(text: unknown): InstrumentationResult;
/** Render a parser result as a single JUnit testsuite document. */
export declare function toJUnit(result: InstrumentationResult): string;
export declare function convert(inputPath: string, outputPath: string, _options?: Record<string, unknown>): Promise<InstrumentationResult>;
