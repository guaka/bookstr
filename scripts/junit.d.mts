export declare function parseJUnit(documents: string[]): {
    tests: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
};
