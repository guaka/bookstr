export interface ReleaseRecord { body?: unknown; tagName?: unknown; tag_name?: unknown }
const RELEASE_TAG_PREFIX = 'v';

function positiveRunNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error('RUN_NUMBER must be a positive safe integer');
  }
  return number;
}

function releaseRunId(value: unknown) {
  const release = value as ReleaseRecord | null | undefined;
  const body = String(release?.body ?? '');
  return body.match(/Bookstr Android workflow run ID: (\d+)/)?.[1] ?? null;
}

function releaseRunNumber(value: unknown) {
  const release = value as ReleaseRecord | null | undefined;
  const body = String(release?.body ?? '');
  const bodyNumber = body.match(/Bookstr Android run number: (\d+)/)?.[1];
  const tag = String(release?.tagName ?? release?.tag_name ?? '');
  const legacyTagNumber = tag.match(/^v0\.0\.3-ci\.(\d+)$/)?.[1];
  const number = Number(bodyNumber ?? legacyTagNumber ?? 0);
  return Number.isSafeInteger(number) ? number : 0;
}

export function formatUtcReleaseTimestamp(runStartedAt: unknown) {
  if (typeof runStartedAt !== 'string') throw new Error('RUN_STARTED_AT must be a valid ISO timestamp');
  const timestamp = Date.parse(runStartedAt);
  if (!Number.isFinite(timestamp)) {
    throw new Error('RUN_STARTED_AT must be a valid ISO timestamp');
  }
  const utcMinute = new Date(timestamp).toISOString().slice(0, 16);
  return `${utcMinute.slice(0, 10).replace(/-/g, '')}-${utcMinute.slice(11, 16).replace(':', '')}`;
}

export function resolveAndroidReleaseVersion({ runStartedAt, runNumber, runId, releases }: {runStartedAt: unknown; runNumber: unknown; runId: unknown; releases: unknown}) {
  const number = positiveRunNumber(runNumber);
  if (typeof runId !== 'string' || !/^\d+$/.test(runId)) {
    throw new Error('RUN_ID must be a numeric GitHub workflow run ID');
  }
  if (!Array.isArray(releases)) throw new Error('releases must be an array');

  const baseVersion = `0.1-${formatUtcReleaseTimestamp(runStartedAt)}`;
  const retryVersion = `${baseVersion}-r${number}`;
  const records: unknown[] = releases;
  const ownsVersion = (version: string) => records.some(value => {
    const release = value as ReleaseRecord | null | undefined;
    return (
    `${RELEASE_TAG_PREFIX}${version}` === (release?.tagName ?? release?.tag_name)
    && releaseRunId(release) === runId
    );
  });

  if (ownsVersion(baseVersion)) return baseVersion;
  if (ownsVersion(retryVersion)) return retryVersion;

  const baseTaken = records.some(value => {
    const release = value as ReleaseRecord | null | undefined;
    return (
    `${RELEASE_TAG_PREFIX}${baseVersion}` === (release?.tagName ?? release?.tag_name)
    );
  });
  if (!baseTaken) return baseVersion;

  const retryTaken = records.some(value => {
    const release = value as ReleaseRecord | null | undefined;
    return (
    `${RELEASE_TAG_PREFIX}${retryVersion}` === (release?.tagName ?? release?.tag_name)
    );
  });
  if (!retryTaken) return retryVersion;

  throw new Error(`Both release tags for ${baseVersion} are already owned by another workflow run`);
}

export function latestPublishedAndroidRunNumber(releases: unknown): number {
  if (!Array.isArray(releases)) throw new Error('releases must be an array');
  const records: unknown[] = releases;
  return records.reduce<number>((latest, release) => Math.max(latest, releaseRunNumber(release)), 0);
}
