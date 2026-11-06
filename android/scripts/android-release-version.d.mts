export interface ReleaseRecord {
    body?: unknown;
    tagName?: unknown;
    tag_name?: unknown;
}
export declare function formatUtcReleaseTimestamp(runStartedAt: unknown): string;
export declare function resolveAndroidReleaseVersion({ runStartedAt, runNumber, runId, releases }: {
    runStartedAt: unknown;
    runNumber: unknown;
    runId: unknown;
    releases: unknown;
}): string;
export declare function latestPublishedAndroidRunNumber(releases: unknown): number;
