import { createHash } from 'node:crypto';

import type { FailureKind } from '../../../src/types/analytics';

/**
 * The provider audit's record shapes (Provider Compatibility Audit PRD §6,
 * §10.2): one stage ladder, one closed outcome set, one closed set of reasons,
 * and the redacted form every URL takes before it is written anywhere.
 *
 * The journal is the source of truth and outlives the code that wrote it, so
 * every record carries `schema` and `isStageRecord` is what a reader trusts
 * before reducing a line. Pure; free of `electron` so the tools under
 * `tools/audit/` can import it with type stripping.
 */
export const AUDIT_SCHEMA_VERSION = 1;

export const STAGES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'] as const;
export type Stage = (typeof STAGES)[number];

/** What each stage asks, for reports (§6.1). */
export const STAGE_LABELS: Record<Stage, string> = {
  S0: 'Discovered',
  S1: 'Loaded',
  S2: 'Site answers',
  S3: 'Catalogue',
  S4: 'Search',
  S5: 'Detail',
  S6: 'Links',
  S7: 'Reachable',
  S8: 'Inspected',
  S9: 'Routable',
  S10: 'Played',
};

export const OUTCOMES = ['pass', 'fail', 'unsupported', 'skipped', 'inconclusive', 'blocked'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Why a stage was skipped or inconclusive. Closed, so the summary can count
 * them; an audit that cannot name why it could not tell has a defect of its own.
 */
export const REASONS = [
  // inconclusive (§6.2)
  'head-rejected',
  'range-ignored',
  'needs-webview',
  'challenge',
  'rate-limited',
  'geo-blocked',
  'needs-auth',
  'network-flaky',
  'budget-exhausted',
  'probe-incomplete',
  'host-capability-absent',
  // skipped
  'adult-gate',
  'stage-filter',
  'type-filter',
  'expectation',
  'torrent-lane',
  'needs-credentials',
  'not-offered',
  // blocked
  'earlier-stage-failed',
] as const;
export type Reason = (typeof REASONS)[number];

/** Whose problem a failure is (§8). */
export const OWNERS = [
  'site',
  'provider-plugin',
  'runtime',
  'app-media',
  'app-host',
  'environment',
  'inconclusive-audit',
] as const;
export type Owner = (typeof OWNERS)[number];

export type ProviderVerdict =
  | 'verified-playback'
  | 'compatible'
  | 'reachable-only'
  | 'extraction-only'
  | 'browse-only'
  | 'site-down'
  | 'walled'
  | 'plugin-broken'
  | 'app-gap'
  | 'unverifiable'
  | 'skipped';

/** One stage of one candidate for one provider: a journal line. */
export interface StageRecord {
  schema: number;
  runId: string;
  /** `${archive internalName}/${provider name}`. */
  providerId: string;
  archiveSha256?: string;
  repoId?: string;
  stage: Stage;
  /** Hashed for adult providers; which title or source this stage was about. */
  candidate?: string;
  outcome: Outcome;
  reason?: Reason;
  owner?: Owner;
  cause?: FailureKind;
  groupingForm?: string;
  /** Stage-specific and already redacted (`auditUrl`, header names only). */
  evidence: Record<string, unknown>;
  shapeFingerprint?: string;
  bytes: number;
  ms: number;
  retries: number;
  at: string;
}

/**
 * Whether a parsed journal line is a record this version can reduce. A line
 * from a torn write, or from a newer schema, is skipped, never guessed at.
 */
export function isStageRecord(value: unknown): value is StageRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<StageRecord>;
  return (
    r.schema === AUDIT_SCHEMA_VERSION &&
    typeof r.runId === 'string' &&
    typeof r.providerId === 'string' &&
    STAGES.includes(r.stage as Stage) &&
    OUTCOMES.includes(r.outcome as Outcome) &&
    (r.reason === undefined || REASONS.includes(r.reason as Reason)) &&
    (r.owner === undefined || OWNERS.includes(r.owner as Owner)) &&
    typeof r.evidence === 'object' &&
    r.evidence !== null &&
    typeof r.bytes === 'number' &&
    typeof r.ms === 'number'
  );
}

/** Parses one journal line; `null` for anything not a current record. */
export function parseJournalLine(line: string): StageRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return isStageRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A URL as the audit may store it (§9): scheme, host, the *shape* of the path
 * (each segment reduced to its character classes, so `/v/9f8a7b6c/1080.m3u8`
 * reads `/a/h/n.m3u8`) and the names of its query parameters, never their
 * values: signed links carry their secret there. `fingerprint` matches the
 * same URL across runs without storing it.
 */
export function auditUrl(raw: string): { shape: string; fingerprint: string } {
  const fingerprint = createHash('sha256').update(raw.trim()).digest('hex').slice(0, 16);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { shape: '<unparseable>', fingerprint };
  }
  const path = url.pathname
    .split('/')
    .map((segment) => (segment ? segmentShape(segment) : segment))
    .join('/');
  const params = [...new Set([...url.searchParams.keys()])].sort();
  const query = params.length ? `?${params.join('&')}` : '';
  return { shape: `${url.protocol}//${url.host}${path}${query}`, fingerprint };
}

function segmentShape(segment: string): string {
  const dot = segment.lastIndexOf('.');
  const extension = dot > 0 && segment.length - dot <= 6 ? segment.slice(dot) : '';
  const stem = extension ? segment.slice(0, dot) : segment;
  const shape = /^\d+$/.test(stem) ? 'n' : /^[0-9a-f]{6,}$/i.test(stem) ? 'h' : 'a';
  return shape + extension.toLowerCase();
}

/**
 * A provider's message as the journal may keep it: printable, one line, short,
 * and with any URL reduced to its audit shape. Providers quote the body they
 * choked on, and that can be binary (a PNG where a page was expected) or carry
 * a signed link.
 */
export function printable(text: string, max = 200): string {
  const oneLine = text
    .replace(/https?:\/\/[^\s"'<>)\]}]+/g, (url) => auditUrl(url).shape)
    .replace(/[^\x20-\x7e -ɏ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Header names only; a `Referer` or `Origin` keeps its host (§9). */
export function auditHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'referer' || lower === 'origin') {
      try {
        out[name] = new URL(value).host;
      } catch {
        out[name] = '<unparseable>';
      }
    } else {
      out[name] = '';
    }
  }
  return out;
}

/**
 * A structural hash of a bridge reply: keys and value types, not values, so a
 * provider whose reply changed shape is noticed (SHAPE_DRIFT, §10.3) without
 * storing what it said. Arrays contribute the union of their items' shapes.
 */
export function shapeFingerprint(value: unknown): string {
  return createHash('sha256').update(shapeOf(value)).digest('hex').slice(0, 12);
}

function shapeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${[...new Set(value.map(shapeOf))].sort().join('|')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as object)
      .sort()
      .map((key) => `${key}:${shapeOf((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return typeof value;
}
