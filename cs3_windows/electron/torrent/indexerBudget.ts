/**
 * How long each indexer is given, in what order, and when it stops being asked.
 *
 * ## The flat timeout was the whole cost
 *
 * `IndexerRegistry` gave every indexer the same 20 seconds and ran them all at
 * once, so a torrent search took as long as its worst member — every time. The
 * spread is not subtle: the Stremio aggregators answer in a few hundred
 * milliseconds, and a scraper behind a bot wall answers by burning the full
 * budget and throwing. Twenty seconds of a viewer's time, on every search, to
 * learn nothing at all, from a site that has been blocking us for weeks.
 *
 * The circuit breaker in front of it made this *cheaper*, not cheap: three
 * consecutive failures open it, so a permanently blocked indexer costs three
 * full timeouts before it is skipped — and the cooldown was a flat five
 * minutes, after which it costs three more. A site that has decided not to
 * serve you does not change its mind in five minutes.
 *
 * ## What replaces it
 *
 * Three decisions, all from what each indexer has actually done here:
 *
 *  1. **Its deadline comes from its own measured latency.** An indexer that has
 *     answered ten searches in under a second gets a second and a half; one
 *     with no history gets the full budget, because judging it before it has
 *     answered is how a slow-but-working indexer gets designated dead.
 *  2. **A timeout weighs more than an error.** They are not comparable events:
 *     a 404 costs one round trip and a timeout costs the entire search. So a
 *     timeout counts double toward opening the circuit, and the cooldown grows
 *     each time an indexer re-opens it rather than resetting to five minutes.
 *  3. **The fast are asked first.** Not because ordering matters to a fan-out
 *     that runs in parallel — it matters to the *deadline*, which the caller
 *     can stop at once the useful answers are in.
 *
 * Pure and tested, because the situations it decides between take weeks of real
 * searching to observe and about a second to describe.
 */

/** Why an attempt ended, which is not the same question as whether it worked. */
export type AttemptOutcome = 'ok' | 'timeout' | 'error';

/** What one indexer has done here, bounded so it cannot grow without limit. */
export interface IndexerObservation {
  /**
   * Latencies of recent *successful* answers, oldest first.
   *
   * Successes only. Folding failures in would mean an indexer that times out
   * repeatedly gets a longer and longer deadline — the exact opposite of what
   * should happen to it.
   */
  latencies: number[];
  consecutiveFailures: number;
  /** Counted separately: they are the expensive kind, and they escalate faster. */
  consecutiveTimeouts: number;
  /** How many times the circuit has opened. Drives the escalating cooldown. */
  trips: number;
  openedAt?: number;
  lastOk?: number;
}

export const EMPTY_OBSERVATION: IndexerObservation = {
  latencies: [],
  consecutiveFailures: 0,
  consecutiveTimeouts: 0,
  trips: 0,
};

/** Kept small: an indexer's behaviour last month says nothing about today. */
export const LATENCY_SAMPLES = 10;

/** An indexer must have answered this many times before its history is trusted. */
export const MIN_SAMPLES_FOR_BUDGET = 3;

export const TIMEOUT_FLOOR_MS = 4_000;
export const TIMEOUT_CEILING_MS = 20_000;

/**
 * Slack over the observed p90.
 *
 * Generous on purpose. Cutting an indexer off at its own typical latency turns
 * every ordinary slow day into a timeout, which then counts against it and
 * eventually opens its circuit — a feedback loop that removes working sources.
 * The saving being chased here is the twenty-second one, not the last 300 ms.
 */
export const TIMEOUT_SLACK = 2.5;

/**
 * Failure weight needed to open the circuit.
 *
 * Three ordinary errors, or two timeouts (weighted 1.5 each), or one of each
 * plus one more. A timeout is worth more because it costs fifty times as much
 * to discover.
 */
export const TRIP_THRESHOLD = 3;
export const TIMEOUT_WEIGHT = 1.5;

/** 5 minutes, then 15, then 45, then two hours and no further. */
export const COOLDOWN_LADDER_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000, 120 * 60_000];

/**
 * The deadline for one attempt.
 *
 * `p90 × slack`, clamped — and the full budget for anything not yet measured.
 * The percentile rather than the mean because an indexer that usually answers
 * in 500 ms and occasionally takes three seconds is a normal indexer, and a
 * mean-derived deadline would cut off the tail it depends on.
 */
export function timeoutFor(
  observation: IndexerObservation,
  ceilingMs: number = TIMEOUT_CEILING_MS
): number {
  const samples = observation.latencies;
  if (samples.length < MIN_SAMPLES_FOR_BUDGET) return ceilingMs;

  const sorted = [...samples].sort((a, b) => a - b);
  // Index, not interpolation: with ten samples this is the ninth, and the
  // difference from a "proper" percentile is far below the slack multiplier.
  const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];

  const budget = Math.round(p90 * TIMEOUT_SLACK);
  return Math.max(TIMEOUT_FLOOR_MS, Math.min(ceilingMs, budget));
}

/** Records an attempt. Returns a new observation; never mutates. */
export function observe(
  observation: IndexerObservation,
  outcome: AttemptOutcome,
  latencyMs: number
): IndexerObservation {
  if (outcome === 'ok') {
    /**
     * A success clears everything, including the trip count.
     *
     * An indexer that is answering again is not on probation for what it did
     * during an outage — leaving `trips` set would hand it a 45-minute cooldown
     * for its next single hiccup, months later.
     */
    return {
      latencies: [...observation.latencies, latencyMs].slice(-LATENCY_SAMPLES),
      consecutiveFailures: 0,
      consecutiveTimeouts: 0,
      trips: 0,
      openedAt: undefined,
      lastOk: Date.now(),
    };
  }

  const next: IndexerObservation = {
    ...observation,
    consecutiveFailures: observation.consecutiveFailures + 1,
    consecutiveTimeouts:
      outcome === 'timeout' ? observation.consecutiveTimeouts + 1 : observation.consecutiveTimeouts,
  };

  if (!next.openedAt && failureWeight(next) >= TRIP_THRESHOLD) {
    next.openedAt = Date.now();
    next.trips = observation.trips + 1;
  }
  return next;
}

function failureWeight(observation: IndexerObservation): number {
  const errors = observation.consecutiveFailures - observation.consecutiveTimeouts;
  return errors + observation.consecutiveTimeouts * TIMEOUT_WEIGHT;
}

/** How long this indexer stays skipped, longer each time it trips. */
export function cooldownMs(observation: IndexerObservation): number {
  const rung = Math.min(COOLDOWN_LADDER_MS.length - 1, Math.max(0, observation.trips - 1));
  return COOLDOWN_LADDER_MS[rung];
}

export function isSkipped(observation: IndexerObservation, now = Date.now()): boolean {
  if (!observation.openedAt) return false;
  return now - observation.openedAt < cooldownMs(observation);
}

/**
 * How long an indexer stays skipped for, in words a settings screen can print.
 *
 * The health panel already names *which* indexer is down; a viewer looking at a
 * search that found less than they expected wants to know whether it comes back
 * in five minutes or two hours.
 */
export function describeSkip(observation: IndexerObservation, now = Date.now()): string {
  if (!observation.openedAt) return '';
  const remaining = cooldownMs(observation) - (now - observation.openedAt);
  if (remaining <= 0) return '';
  const minutes = Math.ceil(remaining / 60_000);
  const cause = observation.consecutiveTimeouts > 0 ? 'timing out' : 'failing';
  return `Paused for ${minutes} more minute${minutes === 1 ? '' : 's'} after repeatedly ${cause}`;
}

/**
 * Ask the fast ones first.
 *
 * Three bands, and the middle one is the interesting choice: an indexer that has
 * never been measured goes *ahead* of one that is recovering from failure. A
 * newly added Torznab endpoint deserves a place in front of a site that timed
 * out an hour ago, and putting the unproven last is how a new indexer never
 * accumulates the history that would let it be ranked at all.
 */
export function searchOrder<T extends { id: string }>(
  entries: readonly T[],
  observations: ReadonlyMap<string, IndexerObservation>
): T[] {
  const band = (id: string): number => {
    const obs = observations.get(id);
    if (!obs || obs.latencies.length === 0) return 1; // unproven
    if (obs.consecutiveFailures > 0) return 2; // recovering
    return 0; // proven
  };

  return [...entries].sort((a, b) => {
    const bandDelta = band(a.id) - band(b.id);
    if (bandDelta !== 0) return bandDelta;
    // Within the proven band, fastest first. Elsewhere the order is stable,
    // which keeps a list of unproven indexers in the order the user arranged.
    const left = observations.get(a.id);
    const right = observations.get(b.id);
    if (!left?.latencies.length || !right?.latencies.length) return 0;
    return timeoutFor(left) - timeoutFor(right);
  });
}
