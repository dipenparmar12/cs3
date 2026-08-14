import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  ANALYTICS_STAGES,
  type AnalyticsSettings,
  type AnalyticsStage,
  type ProviderAnalyticsRecord,
  type ProviderPreference,
  type StageCounters,
  type StageOutcome,
} from '../../src/types/analytics';
import { classifyFailure } from './failureTaxonomy';

/**
 * How every provider has actually behaved, counted.
 *
 * The app can have several hundred providers switched on at once, and until now
 * it treated all of them as equally likely to be useful. That is the wrong
 * prior by a wide margin: a handful answer most queries with links that play,
 * a long tail answers slowly with links that 403, and there was no way to tell
 * them apart except by using the app for a month and remembering. This is that
 * memory, written down.
 *
 * Three decisions worth keeping:
 *
 * **Aggregate only.** Counters, not events. Nothing here records what was
 * searched for or which title was opened, because provider quality does not
 * depend on either and storing them would put a viewing history inside a file
 * whose whole purpose is to be shared with a maintainer.
 *
 * **`empty` is not `failure`.** A provider that ran correctly and has nothing
 * for this title is working. Folding the two together would rank providers by
 * catalogue breadth and quietly bury every specialist — the anime provider that
 * answers nothing about *Dune* is not broken.
 *
 * **Its own file, like diagnostics.** This is operational exhaust measured in
 * hundreds of records, and it has no business travelling inside a user's backup
 * next to their watch history.
 */

const FILE_NAME = 'cs3-provider-analytics.json';

/**
 * Weight of the smoothing prior, in observations.
 *
 * Without one, a provider that answered its first search successfully scores
 * 100% and outranks a provider with a 95% rate over four hundred calls; with it
 * they are ordered correctly and the new provider still climbs quickly. The
 * value is the number of imaginary neutral observations every provider starts
 * with, so it is also what stops a brand-new extension from being buried
 * permanently by a ranking that never gives it a turn.
 */
export const PRIOR_WEIGHT = 5;

/** Neutral success rate assumed before there is any evidence. */
export const PRIOR_RATE = 0.5;

/** Weight of the newest latency sample in the running estimate. */
const LATENCY_ALPHA = 0.25;

const DEFAULT_SETTINGS: AnalyticsSettings = {
  enabled: true,
  applyToRanking: true,
  autoEnableProven: false,
  autoEnableMinScore: 70,
  autoEnableMinSamples: 25,
};

function emptyCounters(): StageCounters {
  return {
    attempts: 0,
    successes: 0,
    empty: 0,
    failures: 0,
    produced: 0,
    latencySumMs: 0,
    latencySamples: 0,
  };
}

function emptyRecord(provider: string): ProviderAnalyticsRecord {
  const now = Date.now();
  const stages = {} as Record<AnalyticsStage, StageCounters>;
  for (const stage of ANALYTICS_STAGES) stages[stage] = emptyCounters();
  return {
    provider,
    firstSeenAt: now,
    lastSeenAt: now,
    stages,
    failureKinds: {},
  };
}

export interface ObservationInput {
  provider: string;
  stage: AnalyticsStage;
  outcome: StageOutcome;
  /** Items produced — search results, resolved links, delivered streams. */
  produced?: number;
  latencyMs?: number;
  /** Raw failure text; stored only as a category. */
  error?: string;
}

/** Provenance attached to a provider the first time it is seen, then kept. */
export interface ProviderProvenance {
  repositoryId?: string;
  repositoryName?: string;
  extensionInternalName?: string;
  extensionName?: string;
}

export class ProviderAnalytics {
  private records = new Map<string, ProviderAnalyticsRecord>();
  private preferences = new Map<string, ProviderPreference>();
  private settings: AnalyticsSettings = { ...DEFAULT_SETTINGS };
  private file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(directory?: string) {
    const base = directory ?? (app ? app.getPath('userData') : process.cwd());
    this.file = path.join(base, FILE_NAME);
    this.restore();
  }

  public get filePath(): string {
    return this.file;
  }

  private restore(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed?.settings) this.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      if (Array.isArray(parsed?.providers)) {
        for (const raw of parsed.providers) {
          const record = this.reviveRecord(raw);
          if (record) this.records.set(record.provider, record);
        }
      }
      if (parsed?.preferences && typeof parsed.preferences === 'object') {
        for (const [name, value] of Object.entries(parsed.preferences)) {
          if (value === 'preferred' || value === 'blocked') this.preferences.set(name, value);
        }
      }
    } catch {
      // No history yet, or a file written by a build with a different shape.
      // Starting from zero is correct in both cases and costs only accuracy
      // that rebuilds itself within a session of ordinary use.
    }
  }

  /**
   * Rebuilds one record, filling in stages the stored file does not have.
   *
   * A stage added in a later build must not make every existing record
   * unreadable — losing a user's whole ranking history to a schema addition is
   * a far worse outcome than carrying a few zeroed counters.
   */
  private reviveRecord(raw: unknown): ProviderAnalyticsRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as Partial<ProviderAnalyticsRecord>;
    if (typeof source.provider !== 'string' || !source.provider) return null;

    const record = emptyRecord(source.provider);
    record.firstSeenAt = typeof source.firstSeenAt === 'number' ? source.firstSeenAt : Date.now();
    record.lastSeenAt = typeof source.lastSeenAt === 'number' ? source.lastSeenAt : record.firstSeenAt;
    record.lastSuccessAt = typeof source.lastSuccessAt === 'number' ? source.lastSuccessAt : undefined;
    record.lastFailureAt = typeof source.lastFailureAt === 'number' ? source.lastFailureAt : undefined;
    record.repositoryId = source.repositoryId;
    record.repositoryName = source.repositoryName;
    record.extensionInternalName = source.extensionInternalName;
    record.extensionName = source.extensionName;

    for (const stage of ANALYTICS_STAGES) {
      const stored = source.stages?.[stage];
      if (!stored) continue;
      record.stages[stage] = { ...emptyCounters(), ...stored };
    }
    if (source.failureKinds && typeof source.failureKinds === 'object') {
      record.failureKinds = { ...source.failureKinds };
    }
    return record;
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    // A search across thirty providers produces thirty observations inside a
    // second. Writing per observation would make the measurement the slowest
    // part of the thing being measured.
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeNow();
    }, 2_000);
    this.writeTimer.unref?.();
  }

  private writeNow(): void {
    try {
      fs.writeFileSync(
        this.file,
        JSON.stringify({
          version: 1,
          settings: this.settings,
          preferences: Object.fromEntries(this.preferences),
          providers: [...this.records.values()],
        }),
        'utf8'
      );
    } catch {
      // Losing the history costs ranking accuracy and nothing else.
    }
  }

  public flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.writeNow();
  }

  // --- recording -----------------------------------------------------------

  /**
   * Attaches repository/extension provenance to a provider.
   *
   * Called from the plugin manager, which is the only layer that knows it.
   * Without it a failing provider is a bare name, and the whole point of
   * ranking is to be able to say *whose* code and *which* repository is behind
   * a result.
   */
  public describe(provider: string, provenance: ProviderProvenance): void {
    if (!provider) return;
    const record = this.records.get(provider);
    if (!record) {
      // Nothing has been measured yet. Provenance alone is not worth a record;
      // it will be attached on the first observation instead.
      this.pendingProvenance.set(provider, provenance);
      return;
    }
    Object.assign(record, provenance);
    this.scheduleWrite();
  }

  private pendingProvenance = new Map<string, ProviderProvenance>();

  /** Records one measured outcome. Cheap, synchronous, never throws. */
  public observe(input: ObservationInput): void {
    if (!this.settings.enabled) return;
    if (!input.provider) return;

    let record = this.records.get(input.provider);
    if (!record) {
      record = emptyRecord(input.provider);
      const pending = this.pendingProvenance.get(input.provider);
      if (pending) {
        Object.assign(record, pending);
        this.pendingProvenance.delete(input.provider);
      }
      this.records.set(input.provider, record);
    }

    const counters = record.stages[input.stage];
    counters.attempts++;
    if (input.outcome === 'success') counters.successes++;
    else if (input.outcome === 'empty') counters.empty++;
    else counters.failures++;

    if (typeof input.produced === 'number' && input.produced > 0) {
      counters.produced += input.produced;
    }

    if (typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs)) {
      counters.latencySumMs += input.latencyMs;
      counters.latencySamples++;
      counters.recentLatencyMs =
        counters.recentLatencyMs === undefined
          ? input.latencyMs
          : counters.recentLatencyMs * (1 - LATENCY_ALPHA) + input.latencyMs * LATENCY_ALPHA;
    }

    const now = Date.now();
    record.lastSeenAt = now;
    if (input.outcome === 'success') record.lastSuccessAt = now;
    if (input.outcome === 'failure') {
      record.lastFailureAt = now;
      const kind = classifyFailure(input.error);
      record.failureKinds[kind] = (record.failureKinds[kind] ?? 0) + 1;
    }

    this.scheduleWrite();
  }

  /** Convenience for the common "one call, one outcome" shape. */
  public observeMany(inputs: ObservationInput[]): void {
    for (const input of inputs) this.observe(input);
  }

  // --- reading -------------------------------------------------------------

  public get(provider: string): ProviderAnalyticsRecord | undefined {
    return this.records.get(provider);
  }

  public all(): ProviderAnalyticsRecord[] {
    return [...this.records.values()];
  }

  public getSettings(): AnalyticsSettings {
    return { ...this.settings };
  }

  public setSettings(next: Partial<AnalyticsSettings>): AnalyticsSettings {
    this.settings = { ...this.settings, ...next };
    this.flush();
    return this.getSettings();
  }

  public getPreference(provider: string): ProviderPreference | undefined {
    return this.preferences.get(provider);
  }

  public getPreferences(): Record<string, ProviderPreference> {
    return Object.fromEntries(this.preferences);
  }

  /**
   * Pins or blocks a provider by hand.
   *
   * A user's explicit choice outranks every measurement, and passing `null`
   * returns the provider to being judged on its record. Without this the
   * ranking is unarguable, which is the wrong property for a system whose
   * inputs are noisy scrapes of third-party sites.
   */
  public setPreference(provider: string, preference: ProviderPreference | null): void {
    if (preference === null) this.preferences.delete(provider);
    else this.preferences.set(provider, preference);
    this.flush();
  }

  /** Forgets everything measured. The privacy control, and the reset button. */
  public reset(): void {
    this.records.clear();
    this.pendingProvenance.clear();
    this.flush();
  }

  public resetProvider(provider: string): void {
    this.records.delete(provider);
    this.flush();
  }

  // --- derived quantities the ranking needs --------------------------------

  /**
   * Smoothed success rate for one stage.
   *
   * `empty` counts as neither success nor failure and is excluded from the
   * denominator entirely, so a specialist provider is judged on the queries it
   * actually had something for.
   */
  public rate(record: ProviderAnalyticsRecord, stage: AnalyticsStage): {
    rate: number;
    samples: number;
  } {
    const counters = record.stages[stage];
    const judged = counters.successes + counters.failures;
    const rate =
      (counters.successes + PRIOR_WEIGHT * PRIOR_RATE) / (judged + PRIOR_WEIGHT);
    return { rate, samples: judged };
  }

  /** Mean latency, preferring the recent estimate when there is one. */
  public latency(record: ProviderAnalyticsRecord, stage: AnalyticsStage): number | null {
    const counters = record.stages[stage];
    if (counters.recentLatencyMs !== undefined) return counters.recentLatencyMs;
    if (counters.latencySamples === 0) return null;
    return counters.latencySumMs / counters.latencySamples;
  }

  /** Total judged observations across every stage — the confidence input. */
  public totalSamples(record: ProviderAnalyticsRecord): number {
    let total = 0;
    for (const stage of ANALYTICS_STAGES) {
      total += record.stages[stage].successes + record.stages[stage].failures;
    }
    return total;
  }
}
