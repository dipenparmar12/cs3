import type { ProviderScore, RecommendationBand } from '../../types/analytics';

/**
 * The ranking, said in words someone choosing a source can act on.
 *
 * Everything here already existed — `ProviderRanking` has been measuring
 * success rate, latency, whether links resolve and whether anything actually
 * played since it was written — and exactly one screen read it: a settings
 * panel with eight weighted criteria, sample counts and a re-weighting slider.
 * That panel is right for someone tuning the ranking and wrong for the person
 * looking at a list of two hundred providers wondering which are worth
 * switching on, who is asking a much smaller question.
 *
 * So this is a translation and deliberately not a second opinion: it reads the
 * band the ranking already assigned rather than re-deriving one from the score,
 * because two places computing "is this provider any good" is how the settings
 * panel and the source list come to disagree in front of the same user.
 *
 * ## The label that is not a grade
 *
 * `unproven` is kept as its own answer and never folded into the middle of the
 * scale. A provider with four observations is not average; it is unmeasured,
 * and printing "Average" over it is a verdict the evidence does not support —
 * on a fresh install that is *every* provider. It is also the direction that
 * does harm: the ranking's fourth rule is that it never auto-disables, and a
 * label that quietly reads as mediocre is the same punishment applied by
 * suggestion.
 */

export type HealthLevel = 'excellent' | 'good' | 'average' | 'poor' | 'unknown';

export interface ProviderHealth {
  level: HealthLevel;
  /** One or two words, for a chip beside a provider name. */
  label: string;
  /**
   * The sentence behind the label.
   *
   * Always says how much evidence it rests on. "Poor" from six searches and
   * "Poor" from four hundred are different claims, and a viewer deciding
   * whether to switch a source off is entitled to know which one they are
   * being shown.
   */
  detail: string;
}

const LEVELS: Record<RecommendationBand, HealthLevel> = {
  strong: 'excellent',
  good: 'good',
  weak: 'average',
  failing: 'poor',
  unproven: 'unknown',
};

const LABELS: Record<HealthLevel, string> = {
  excellent: 'Excellent',
  good: 'Good',
  average: 'Average',
  poor: 'Poor',
  unknown: 'Not measured',
};

const UNMEASURED: ProviderHealth = {
  level: 'unknown',
  label: LABELS.unknown,
  detail: 'This source has not been used enough here to judge yet.',
};

function samplesPhrase(samples: number): string {
  if (samples <= 0) return 'nothing recorded';
  return `${samples} recorded outcome${samples === 1 ? '' : 's'}`;
}

export function healthOf(score: ProviderScore | undefined): ProviderHealth {
  if (!score) return UNMEASURED;

  /**
   * A hand-set preference is stated as a choice, not measured as a quality.
   *
   * Someone who pinned a provider does not need to be told it is excellent, and
   * someone who blocked one has not made a claim about how well it works. The
   * ranking encodes both as bands so that ordering works; the label has to say
   * what actually happened.
   */
  if (score.preference === 'preferred') {
    return {
      level: 'excellent',
      label: 'Always preferred',
      detail: 'You pinned this source, so it is asked first regardless of its score.',
    };
  }
  if (score.preference === 'blocked') {
    return {
      level: 'poor',
      label: 'Switched off by you',
      detail: 'You blocked this source. Nothing here is a measurement of it.',
    };
  }

  const level = LEVELS[score.band] ?? 'unknown';
  if (level === 'unknown') return UNMEASURED;

  return {
    level,
    label: LABELS[level],
    detail: `Scores ${Math.round(score.score)} out of 100 from ${samplesPhrase(score.samples)}.`,
  };
}

/**
 * Health by provider name, ready for a list to look up per row.
 *
 * Built once per render of a list rather than searched per row: the scope
 * picker draws several hundred rows through a virtualiser, and a linear scan
 * inside each one turns a scroll into quadratic work over the leaderboard.
 */
export function healthIndex(scores: readonly ProviderScore[]): Map<string, ProviderHealth> {
  const index = new Map<string, ProviderHealth>();
  for (const score of scores) index.set(score.provider, healthOf(score));
  return index;
}

/**
 * Whether this is worth putting on screen at all.
 *
 * An unmeasured provider gets no chip. A row of two hundred "Not measured"
 * badges on a fresh install is noise that teaches the viewer to ignore the
 * column before it ever has anything to say — and the badge exists precisely so
 * that the few rows carrying a verdict are noticed.
 */
export function isWorthShowing(health: ProviderHealth): boolean {
  return health.level !== 'unknown';
}
