/**
 * Provider performance measurement and the ranking built on top of it.
 *
 * Imported by both sides of the IPC boundary, like the other files in this
 * directory.
 *
 * The shapes here are deliberately **aggregate only**. A user's searches and
 * the titles they open are not inputs to provider quality — what matters is
 * that a provider answered, how fast, and whether what it returned turned into
 * bytes. Counting that requires no record of what was asked for, so none is
 * kept. Failures are stored as categories rather than messages for the same
 * reason: a scraper error can quote the page it was reading, and that page was
 * chosen by the user.
 */

/**
 * The five stages a provider is judged on, in pipeline order.
 *
 * They are separate because a provider can be excellent at one and useless at
 * the next, and averaging them together hides exactly the case worth catching:
 * an extension that returns forty search results and resolves none of them.
 */
export type AnalyticsStage = 'search' | 'detail' | 'links' | 'playback' | 'download';

export const ANALYTICS_STAGES: AnalyticsStage[] = [
  'search',
  'detail',
  'links',
  'playback',
  'download',
];

/**
 * How a stage ended.
 *
 * `empty` is not a failure. A provider that ran correctly and has nothing for
 * this title is behaving properly, and counting it as a fault would rank
 * catalogues by how broad their catalogue is rather than how well they work.
 * It is still tracked separately, because a provider that is *always* empty is
 * not earning its place in a search either.
 */
export type StageOutcome = 'success' | 'empty' | 'failure';

export interface StageCounters {
  attempts: number;
  successes: number;
  /** Ran cleanly, produced nothing. */
  empty: number;
  failures: number;
  /** Items produced across all attempts — results, links, streams. */
  produced: number;
  latencySumMs: number;
  latencySamples: number;
  /**
   * Exponentially weighted latency. Kept alongside the mean because the mean
   * never recovers: a provider that was fast for a year and is now timing out
   * has a fine average and is unusable.
   */
  recentLatencyMs?: number;
}

export interface ProviderAnalyticsRecord {
  provider: string;
  /** Provenance, so a failing provider can be traced to whose code it is. */
  repositoryId?: string;
  repositoryName?: string;
  extensionInternalName?: string;
  extensionName?: string;

  firstSeenAt: number;
  lastSeenAt: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;

  stages: Record<AnalyticsStage, StageCounters>;
  /** Failure categories and their counts. Categories, never raw messages. */
  failureKinds: Record<string, number>;
}

/**
 * Why a call failed, in the small closed set the ranking and the diagnostics
 * both reason about.
 *
 * Chosen so that each one implies a different response. `blocked` and
 * `not-found` look identical in a log and mean opposite things: the first is a
 * provider that needs headers or a browser, the second is a link that has
 * simply gone.
 */
export type FailureKind =
  | 'timeout'
  | 'runtime-unavailable'
  | 'blocked'
  | 'not-found'
  | 'server-error'
  | 'network'
  | 'expired'
  | 'unreadable-reply'
  | 'unsupported-operation'
  | 'provider-error'
  | 'unknown';

/** One criterion's contribution to a provider's score. */
export interface CriterionScore {
  id: string;
  label: string;
  weight: number;
  /** 0..1, or null when there is not enough evidence to judge. */
  score: number | null;
  /** Observations behind the score, which is what `confidence` is built from. */
  samples: number;
  /** Plain-language reading, for the UI. */
  detail: string;
}

export type RecommendationBand = 'strong' | 'good' | 'unproven' | 'weak' | 'failing';

export interface ProviderScore {
  provider: string;
  repositoryId?: string;
  repositoryName?: string;
  extensionInternalName?: string;
  extensionName?: string;
  /** 0..100. */
  score: number;
  /** 0..1 — how much evidence is behind the score, not how good the score is. */
  confidence: number;
  samples: number;
  band: RecommendationBand;
  criteria: CriterionScore[];
  /** Set when the user has pinned or blocked this provider by hand. */
  preference?: ProviderPreference;
}

export type ProviderPreference = 'preferred' | 'blocked';

/** A criterion as the settings UI sees it: named, described, and re-weightable. */
export interface RankingCriterionInfo {
  id: string;
  label: string;
  description: string;
  weight: number;
  /** Observations needed before the criterion is allowed to contribute. */
  minSamples: number;
  /** False for criteria that are registered but not yet measurable. */
  available: boolean;
}

export interface AnalyticsSettings {
  /** Master switch. Off means nothing is recorded and nothing is ranked. */
  enabled: boolean;
  /** Let the ranking reorder search results and pick default sources. */
  applyToRanking: boolean;
  /**
   * Enable a provider automatically once it has proved itself. Off by default:
   * turning sources on without being asked is a surprise, however well meant.
   */
  autoEnableProven: boolean;
  /** Score a provider must reach, over `autoEnableMinSamples`, to be enabled. */
  autoEnableMinScore: number;
  autoEnableMinSamples: number;
  /**
   * Per-criterion weights, by id. Absent ids fall back to the criterion's own
   * default, so a build that adds a criterion does not need a migration.
   */
  criterionWeights?: Record<string, number>;
}

export interface ProviderRecommendation {
  provider: string;
  extensionInternalName?: string;
  extensionName?: string;
  repositoryId?: string;
  repositoryName?: string;
  score: number;
  confidence: number;
  band: RecommendationBand;
  /** Why it is being recommended, in one sentence. */
  reason: string;
  /** Whether acting on this would enable something currently switched off. */
  currentlyEnabled: boolean;
}
