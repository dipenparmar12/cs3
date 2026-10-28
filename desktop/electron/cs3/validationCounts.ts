import type { ProviderAnalyticsRecord } from '../../src/types/analytics';
import type { SourceVerdict } from '../../src/utils/sourceVerdict.ts';

/**
 * Why sources from one provider were left, counted (Content Validation PRD
 * §11, Phase 5), and the one of those counts the ranking reads.
 *
 * Counters, like the rest of the analytics record: never which title or which
 * link. `unplayable` is not counted, because it says nothing the playback
 * counters do not. Pure.
 */
export function countVerdict(record: ProviderAnalyticsRecord, verdict: SourceVerdict): boolean {
  if (verdict === 'unplayable') return false;
  const counts = (record.validation ??= {});
  counts[verdict] = (counts[verdict] ?? 0) + 1;
  return true;
}

/**
 * How often what this provider played was the title asked for.
 *
 * Starts are the playback stage's successes (a clip that started is one of
 * them); each confirmed mismatch is one of those that was not the title.
 * Smoothed toward the same neutral prior as every other rate, so one advert
 * never condemns a provider. `null` before anything has played.
 */
export function rightContentRate(
  record: ProviderAnalyticsRecord,
  priorWeight: number,
  priorRate: number
): { rate: number | null; samples: number; mismatches: number } {
  const mismatches = record.validation?.['confirmed-mismatch'] ?? 0;
  const samples = Math.max(record.stages.playback.successes, mismatches);
  if (samples === 0) return { rate: null, samples: 0, mismatches: 0 };
  return { rate: (samples - mismatches + priorWeight * priorRate) / (samples + priorWeight), samples, mismatches };
}
