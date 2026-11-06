export declare const PLATFORM_SUITES: string[];
/** Fail closed: an unknown suite, invalid JSON, or changed schema routes all platforms. */
export declare function compareSuiteBaselineChange(suite: string, baseText: string, headText: string): boolean;
/** Ignore only the changes-routing job; missing or malformed workflows route conservatively. */
export declare function compareWorkflowOutsideRoutingJob(baseText: unknown, headText: unknown): boolean;
/** CLI failures also fail closed so a routing problem runs the platform suite. */
export declare function runPlatformBaselineRoutingCli(args: string[]): string;
