// Portable rights normalization shared by Electron, web, iOS, and Android.
// This is intentionally stricter than the legacy four-field adapter: a file
// may be displayed when rights are unknown, but it may only be seeded when
// redistribution is explicitly allowed.

const STATUS = new Set(['public_domain', 'open_license', 'copyrighted', 'unknown']);
const REDISTRIBUTION = new Set(['allowed', 'noncommercial', 'forbidden', 'unknown']);
type RightsStatus = 'public_domain' | 'open_license' | 'copyrighted' | 'unknown';
type Redistribution = 'allowed' | 'noncommercial' | 'forbidden' | 'unknown';
type JsonRecord = Record<string, unknown>;

function objectValue(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clean(value: unknown): string {
  const text = String(value ?? '').trim();
  return text && !['null', 'undefined'].includes(text.toLowerCase()) ? text : '';
}

function safeURL(value: unknown): string {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function first(...values: unknown[]): string {
  return values.map(clean).find(Boolean) || '';
}

function statusFrom(value: unknown): RightsStatus {
  const aliases: Record<string, RightsStatus> = {
    pd: 'public_domain',
    'public-domain': 'public_domain',
    'public domain': 'public_domain',
    publicdomain: 'public_domain',
    open: 'open_license',
    'open-license': 'open_license',
    'open license': 'open_license',
    copyright: 'copyrighted',
  };
  const normalized = clean(value).toLowerCase();
  if (STATUS.has(normalized)) return normalized as RightsStatus;
  return aliases[normalized] || 'unknown';
}

function inferStatus(status: RightsStatus, license: string, licenseURL: string, copyright: unknown): RightsStatus {
  const evidence = `${license} ${licenseURL}`.toLowerCase();
  if (/public[ -]domain|no known copyright restrictions|creativecommons\.org\/publicdomain\/(?:zero|mark)|\bcc0(?:\s|$|[./-])/.test(evidence)) return 'public_domain';
  if (/creative\s*commons|creativecommons\.org\/licenses\/|\bcc[ -]?by|gnu free documentation|\bgfdl\b|free art license|open publication license|unlicense/.test(evidence)) return 'open_license';
  if (status !== 'unknown') return status;
  if (typeof copyright === 'boolean') return copyright ? 'copyrighted' : 'public_domain';
  if (/all rights reserved|copyrighted|copyright ©|^©/.test(evidence)) return 'copyrighted';
  return 'unknown';
}

function inferRedistribution(value: string, status: RightsStatus, license: string, licenseURL: string): Redistribution {
  const explicit = clean(value).toLowerCase().replace(/[ -]+/g, '_');
  if (REDISTRIBUTION.has(explicit)) return explicit as Redistribution;
  const evidence = `${license} ${licenseURL}`.toLowerCase();
  if (/noncommercial|non-commercial|\b(?:cc[- ]?by[- ]?nc|cc[- ]?nc)\b|\/by-nc(?:[-/]|\b)/.test(evidence)) return 'noncommercial';
  if (/forbidden|no redistribution|do not redistribute|all rights reserved/.test(evidence)) return 'forbidden';
  if (status === 'public_domain' || status === 'open_license') return 'allowed';
  return 'unknown';
}

export function normalizeRightsV2(ref: unknown = {}) {
  const source: JsonRecord = ref && typeof ref === 'object' && !Array.isArray(ref) ? ref as JsonRecord : {};
  const metadata = objectValue(source.metadata);
  const nested = source.rights && typeof source.rights === 'object' && !Array.isArray(source.rights) ? source.rights as JsonRecord : {};
  const rawLicense = first(source.license, typeof source.rights === 'string' ? source.rights : '', nested.license, metadata.license, metadata.rights);
  let licenseURL = safeURL(first(
    source.license_url, source.licenseUrl, nested.license_url, nested.licenseUrl,
    metadata.license_url, metadata.licenseUrl,
  ));
  if (!licenseURL) {
    const match = rawLicense.match(/https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses\/[a-z-]+|publicdomain\/zero)\/\d(?:\.\d)?\/?/i)
      || rawLicense.match(/https?:\/\/[^\s<>"']+/i);
    if (match) licenseURL = safeURL(match[0].replace(/[),.;]+$/, ''));
  }
  const status = inferStatus(statusFrom(first(
    source.rights_status, source.rightsStatus, source.status,
    nested.status, nested.rights_status, metadata.rights_status, metadata.rightsStatus,
  )), rawLicense, licenseURL, source.copyright ?? metadata.copyright);
  const redistribution = inferRedistribution(first(
    source.redistribution, source.redistribution_policy, source.redistributionPolicy,
    nested.redistribution, nested.redistribution_policy, metadata.redistribution,
  ), status, rawLicense, licenseURL);
  const rightsSource = first(source.rights_source, source.rightsSource, nested.source, metadata.rights_source, metadata.rightsSource);
  const jurisdiction = first(source.jurisdiction, source.rights_jurisdiction, nested.jurisdiction, metadata.jurisdiction);
  const evidenceURL = safeURL(first(source.evidence_url, source.evidenceUrl, nested.evidence_url, nested.evidenceUrl, metadata.evidence_url));
  const attribution = first(source.attribution, nested.attribution, metadata.attribution);
  return {
    rights_status: status,
    license: rawLicense,
    license_url: licenseURL,
    rights_source: rightsSource,
    jurisdiction,
    redistribution,
    evidence_url: evidenceURL,
    attribution,
    public_seed_allowed: (status === 'public_domain' || status === 'open_license') && redistribution === 'allowed',
  };
}

export function publicSeedAllowed(ref: unknown): boolean {
  return normalizeRightsV2(ref).public_seed_allowed;
}
