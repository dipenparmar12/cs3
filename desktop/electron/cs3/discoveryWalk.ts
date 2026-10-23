/**
 * How the widened provider search walks the installed providers (PRD Part C,
 * Phase 2): ranked, in small batches, inside a time budget, stopping at the
 * first verified source.
 *
 * Asking every provider at once was the old behaviour. On a machine with 506
 * providers (search-stage p50 9.0 s, p90 32.8 s) that is minutes of fan-out for
 * a title the second provider already had, and it competes with the playback
 * the search exists to serve. Ranking decides the order, never eligibility:
 * every provider stays reachable, either further down the walk or through an
 * exhaustive search (`SourceQuery.exhaustive`, the player's "Keep looking").
 *
 * Pure: the clock, the batch runner and the stop test are injected.
 */

export interface WalkPlanInput {
  /** Every provider that may be asked, best first (`applySearchOrder`). */
  ranked: string[];
  /** Providers with history for this work (a source of theirs played); asked first. */
  preferred: string[];
  /** Size of the first batch, which holds the preferred providers. */
  firstBatch: number;
  /** Size of every later batch. */
  batchSize: number;
}

/** The batches, in order. Every ranked provider appears exactly once. */
export function planDiscoveryWalk(input: WalkPlanInput): string[][] {
  const ranked = [...new Set(input.ranked)];
  const known = new Set(ranked);
  const preferred = [...new Set(input.preferred)].filter((name) => known.has(name));
  const first = preferred.slice(0, Math.max(1, input.firstBatch));
  const taken = new Set(first);
  for (const name of ranked) {
    if (first.length >= Math.max(1, input.firstBatch)) break;
    if (!taken.has(name)) {
      first.push(name);
      taken.add(name);
    }
  }
  // Preferred providers that did not fit lead what follows, then the ranking.
  const preferredSet = new Set(preferred);
  const rest = [
    ...preferred.filter((name) => !taken.has(name)),
    ...ranked.filter((name) => !taken.has(name) && !preferredSet.has(name)),
  ];
  const batches = first.length > 0 ? [first] : [];
  const size = Math.max(1, input.batchSize);
  for (let i = 0; i < rest.length; i += size) batches.push(rest.slice(i, i + size));
  return batches;
}

export type WalkStop = 'finished' | 'verified' | 'budget' | 'cancelled';

export interface WalkOutcome {
  stoppedBy: WalkStop;
  /** Providers asked, in order. */
  asked: string[];
  /** Providers never asked because the walk stopped first. */
  remaining: string[];
}

export async function walkDiscovery(options: {
  batches: string[][];
  runBatch: (names: string[]) => Promise<void>;
  /** True once a source from a verified hit has been found. */
  verifiedFound: () => boolean;
  budgetMs: number;
  now: () => number;
  signal?: AbortSignal;
}): Promise<WalkOutcome> {
  const started = options.now();
  const asked: string[] = [];
  const remainingFrom = (index: number) => options.batches.slice(index).flat();
  for (let index = 0; index < options.batches.length; index += 1) {
    if (options.signal?.aborted) return { stoppedBy: 'cancelled', asked, remaining: remainingFrom(index) };
    // Checked before a batch, never during one: a batch that started is
    // allowed to answer, so the budget cannot discard replies already paid for.
    if (index > 0 && options.verifiedFound()) {
      return { stoppedBy: 'verified', asked, remaining: remainingFrom(index) };
    }
    if (index > 0 && options.now() - started >= options.budgetMs) {
      return { stoppedBy: 'budget', asked, remaining: remainingFrom(index) };
    }
    const batch = options.batches[index];
    await options.runBatch(batch);
    asked.push(...batch);
  }
  if (options.signal?.aborted) return { stoppedBy: 'cancelled', asked, remaining: [] };
  return { stoppedBy: 'finished', asked, remaining: [] };
}
