#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
export declare function planShards(log: string, seconds: Record<string, number>, count: number): {
    estimatedSeconds: number;
    tests: string[];
}[];
/** Fail closed unless an instrumentation log contains exactly the selected tests. */
export declare function verifySelection(log: string, selection: string): void;
/** Add durations without changing AndroidJUnitRunner's protocol or hiding failures. */
export declare function timingRecorder(now: () => number, snapshot: (text: string) => void): (line: string) => string;
export declare function captureDiagnostics(adb: string, directory: string, run?: typeof execFileSync): void;
export declare function runCli(args: string[]): Promise<void>;
export declare function invokeIfMain(url: string, argv: string[]): Promise<void>;
