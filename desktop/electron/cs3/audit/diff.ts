import { STAGES, type ProviderVerdict, type Stage } from './schema.ts';

/**
 * What changed between two audit runs, and whose change it was (Provider
 * Compatibility Audit PRD §10.3, AC-10). Pure.
 *
 * The line that turns "something broke" into an owner: if the plugin's build
 * changed, the provider did it; if only the runtime or the app changed with
 * the plugin identical, we did; if only the site's answer changed, the site.
 * A provider whose own retries disagreed in this run is FLAKY, never a
 * regression.
 */
export interface RunEntry {
  providerId: string;
  deepest: Stage | null;
  verdict: ProviderVerdict;
  /** Capabilities seen: `subtitles`, `multi-audio`, `dash`… */
  capabilities?: string[];
  shapeFingerprint?: string;
  /** This run's own retries disagreed. */
  flaky?: boolean;
  blame: { archiveSha256?: string; runtime?: string; appSha?: string; siteAlive?: boolean };
}

export type ChangeClass =
  | 'REGRESSED'
  | 'IMPROVED'
  | 'NEW_BROKEN'
  | 'NEW_SUPPORT'
  | 'FLAKY'
  | 'SHAPE_DRIFT'
  | 'GONE'
  /** One side was skipped (adult gate, needs sign-in…): nothing to compare. */
  | 'NOT_COMPARED'
  | 'UNCHANGED';

export type BlameDimension = 'plugin' | 'runtime' | 'app' | 'site';

export interface Change {
  providerId: string;
  change: ChangeClass;
  from?: { deepest: Stage | null; verdict: ProviderVerdict };
  to?: { deepest: Stage | null; verdict: ProviderVerdict };
  moved: BlameDimension[];
  /** Who most likely caused it, read from `moved`. */
  owner: 'provider' | 'ours' | 'site' | 'unknown';
  gained?: string[];
}

/** Better verdicts rank higher; a stage reached outranks any verdict. */
const VERDICT_RANK: Record<ProviderVerdict, number> = {
  'verified-playback': 10,
  compatible: 9,
  'app-gap': 7,
  'reachable-only': 6,
  'extraction-only': 5,
  'browse-only': 4,
  walled: 3,
  unverifiable: 2,
  'plugin-broken': 1,
  'site-down': 1,
  skipped: 0,
};

const BROKEN: ReadonlySet<ProviderVerdict> = new Set<ProviderVerdict>(['plugin-broken', 'site-down', 'unverifiable']);

function depth(stage: Stage | null): number {
  return stage === null ? -1 : STAGES.indexOf(stage);
}

function compare(a: RunEntry, b: RunEntry): number {
  return depth(b.deepest) - depth(a.deepest) || VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict];
}

function movedDimensions(a: RunEntry, b: RunEntry): BlameDimension[] {
  const moved: BlameDimension[] = [];
  if (a.blame.archiveSha256 !== b.blame.archiveSha256) moved.push('plugin');
  if (a.blame.runtime !== b.blame.runtime) moved.push('runtime');
  if (a.blame.appSha !== b.blame.appSha) moved.push('app');
  if (a.blame.siteAlive !== b.blame.siteAlive) moved.push('site');
  return moved;
}

function ownerOf(moved: BlameDimension[]): Change['owner'] {
  if (moved.includes('plugin')) return 'provider';
  if (moved.includes('runtime') || moved.includes('app')) return 'ours';
  if (moved.includes('site')) return 'site';
  return 'unknown';
}

export function diffRuns(previous: RunEntry[], current: RunEntry[]): Change[] {
  const before = new Map(previous.map((entry) => [entry.providerId, entry]));
  const changes: Change[] = [];
  const summary = (e: RunEntry) => ({ deepest: e.deepest, verdict: e.verdict });

  for (const now of current) {
    const was = before.get(now.providerId);
    before.delete(now.providerId);
    if (!was) {
      changes.push({
        providerId: now.providerId,
        change: BROKEN.has(now.verdict) ? 'NEW_BROKEN' : 'NEW_SUPPORT',
        to: summary(now),
        moved: [],
        owner: 'unknown',
      });
      continue;
    }
    const moved = movedDimensions(was, now);
    const base = { providerId: now.providerId, from: summary(was), to: summary(now), moved, owner: ownerOf(moved) };
    const order = compare(was, now);
    const gained = (now.capabilities ?? []).filter((c) => !(was.capabilities ?? []).includes(c));
    if (order !== 0 && (was.verdict === 'skipped' || now.verdict === 'skipped')) {
      changes.push({ ...base, change: 'NOT_COMPARED' });
    } else if (order !== 0 && (now.flaky || (order < 0 && now.verdict === 'unverifiable' && moved.length === 0))) {
      // Could not tell this time, and nothing that would explain a change moved.
      changes.push({ ...base, change: 'FLAKY' });
    }
    else if (order < 0) changes.push({ ...base, change: 'REGRESSED' });
    else if (order > 0) changes.push({ ...base, change: 'IMPROVED' });
    else if (gained.length > 0) changes.push({ ...base, change: 'NEW_SUPPORT', gained });
    else if (was.shapeFingerprint && now.shapeFingerprint && was.shapeFingerprint !== now.shapeFingerprint) {
      changes.push({ ...base, change: 'SHAPE_DRIFT' });
    } else changes.push({ ...base, change: 'UNCHANGED' });
  }
  for (const gone of before.values()) {
    changes.push({ providerId: gone.providerId, change: 'GONE', from: summary(gone), moved: [], owner: 'unknown' });
  }
  return changes;
}

/** Exit code 1 for the CLI when anything regressed (§11). */
export function hasRegressions(changes: Change[]): boolean {
  return changes.some((c) => c.change === 'REGRESSED');
}
