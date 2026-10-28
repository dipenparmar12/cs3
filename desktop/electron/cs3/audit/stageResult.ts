import { STAGES, type Outcome, type ProviderVerdict, type Reason, type Stage, type StageRecord } from './schema.ts';

/**
 * From journal lines to what a provider is (Provider Compatibility Audit PRD
 * §6.1–6.3, AC-1, AC-9). Pure.
 *
 * Stages are independent: a pass never implies the next, and a provider's
 * headline is the deepest stage with passing evidence, never one boolean.
 * Several candidates (titles, sources) can answer one stage; one pass is
 * enough to pass it, and only when none passed does a failure stand.
 */

/** The last record for each (provider, stage, candidate): a resumed run rewrites, never adds. */
export function reduceJournal(records: Iterable<StageRecord>): Map<string, StageRecord[]> {
  const latest = new Map<string, StageRecord>();
  for (const record of records) {
    latest.set(`${record.providerId}\u0000${record.stage}\u0000${record.candidate ?? ''}`, record);
  }
  const byProvider = new Map<string, StageRecord[]>();
  for (const record of latest.values()) {
    const list = byProvider.get(record.providerId) ?? [];
    list.push(record);
    byProvider.set(record.providerId, list);
  }
  return byProvider;
}

/** Most informative first: what a stage says when its candidates disagree. */
const PRECEDENCE: Outcome[] = ['pass', 'fail', 'inconclusive', 'unsupported', 'skipped', 'blocked'];

export interface StageSummary {
  outcome: Outcome;
  /** The records behind that outcome, for reasons and owners. */
  records: StageRecord[];
}

export function summariseStages(records: StageRecord[]): Map<Stage, StageSummary> {
  const byStage = new Map<Stage, StageRecord[]>();
  for (const record of records) {
    const list = byStage.get(record.stage) ?? [];
    list.push(record);
    byStage.set(record.stage, list);
  }
  const out = new Map<Stage, StageSummary>();
  for (const [stage, list] of byStage) {
    const outcome = PRECEDENCE.find((o) => list.some((r) => r.outcome === o))!;
    out.set(stage, { outcome, records: list.filter((r) => r.outcome === outcome) });
  }
  return out;
}

/** The deepest stage that passed, in ladder order; `null` when none did. */
export function deepestStage(stages: Map<Stage, StageSummary>): Stage | null {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (stages.get(STAGES[i])?.outcome === 'pass') return STAGES[i];
  }
  return null;
}

const WALL_REASONS: ReadonlySet<Reason> = new Set<Reason>(['needs-webview', 'challenge']);

export function deriveVerdict(stages: Map<Stage, StageSummary>): ProviderVerdict {
  const is = (stage: Stage, outcome: Outcome) => stages.get(stage)?.outcome === outcome;
  const passed = (stage: Stage) => is(stage, 'pass');
  const owners = (stage: Stage) => new Set(stages.get(stage)?.records.map((r) => r.owner));
  const walledAt = (stage: Stage) =>
    is(stage, 'inconclusive') && stages.get(stage)!.records.some((r) => r.reason && WALL_REASONS.has(r.reason));

  const present = [...stages.values()];
  if (present.length === 0 || present.every((s) => s.outcome === 'skipped')) return 'skipped';
  if (passed('S10')) return 'verified-playback';
  if (is('S1', 'fail')) return 'plugin-broken';
  if (is('S2', 'fail')) return 'site-down';
  if (passed('S8')) return is('S9', 'fail') ? 'app-gap' : 'compatible';
  if (passed('S7')) return is('S8', 'fail') && owners('S8').has('app-media') ? 'app-gap' : 'reachable-only';
  if (walledAt('S2') || walledAt('S3') || walledAt('S7')) return 'walled';
  if (passed('S6')) return 'extraction-only';
  const contentStages: Stage[] = ['S3', 'S4', 'S5', 'S6'];
  if (
    contentStages.some(
      (stage) => is(stage, 'fail') && (owners(stage).has('provider-plugin') || owners(stage).has('runtime'))
    )
  ) {
    return 'plugin-broken';
  }
  if ((passed('S3') || passed('S4') || passed('S5')) && !is('S6', 'fail')) return 'browse-only';
  return 'unverifiable';
}

export interface ProviderResult {
  providerId: string;
  deepest: Stage | null;
  verdict: ProviderVerdict;
  stages: Partial<Record<Stage, Outcome>>;
  bytes: number;
  ms: number;
}

export function providerResult(providerId: string, records: StageRecord[]): ProviderResult {
  const stages = summariseStages(records);
  const outcomes: Partial<Record<Stage, Outcome>> = {};
  for (const [stage, summary] of stages) outcomes[stage] = summary.outcome;
  return {
    providerId,
    deepest: deepestStage(stages),
    verdict: deriveVerdict(stages),
    stages: outcomes,
    bytes: records.reduce((sum, r) => sum + r.bytes, 0),
    ms: records.reduce((sum, r) => sum + r.ms, 0),
  };
}

/**
 * AC-1: every discovered provider is accounted for exactly once. `missing`
 * were discovered and never reached the journal (a run cut short); `extra`
 * reached it without being discovered (a reducer or discovery bug).
 */
export function conservation(
  discovered: Iterable<string>,
  results: ProviderResult[]
): { discovered: number; byVerdict: Partial<Record<ProviderVerdict, number>>; missing: string[]; extra: string[]; holds: boolean } {
  const wanted = new Set(discovered);
  const seen = new Set(results.map((r) => r.providerId));
  const byVerdict: Partial<Record<ProviderVerdict, number>> = {};
  for (const result of results) {
    if (wanted.has(result.providerId)) byVerdict[result.verdict] = (byVerdict[result.verdict] ?? 0) + 1;
  }
  const missing = [...wanted].filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !wanted.has(id));
  return { discovered: wanted.size, byVerdict, missing, extra, holds: missing.length === 0 && extra.length === 0 };
}
