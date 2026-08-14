import type {
  ProviderRecommendation,
  ProviderScore,
} from '../../src/types/analytics';
import type { PluginManager } from '../pluginManager';
import type { ProviderAnalytics } from './providerAnalytics';
import type { ProviderRanking } from './providerRanking';

/**
 * Turns measurements into advice, and — only when asked — into action.
 *
 * The product goal is that a new user should not have to research which
 * repositories are good before they can watch anything. The path there is not
 * to guess on their behalf on day one; it is to measure, then recommend, then
 * (with permission) act.
 *
 * Three rules keep that from becoming a system that switches things on behind
 * someone's back:
 *
 * 1. **Recommendation is free; enabling is not.** Anything can be recommended.
 *    Auto-enabling requires `autoEnableProven`, which is off by default.
 * 2. **Evidence before confidence.** A provider needs both a score and enough
 *    observations behind it. A single lucky search must never enable anything.
 * 3. **Nothing is ever auto-disabled.** A provider that scores badly is
 *    reported, not switched off. The measurements are scrapes of third-party
 *    sites; a site being down for a week is not consent to remove it, and a
 *    user who chose a source should find it where they left it.
 */

/** Recommendations below this are not worth the user's attention. */
const MIN_RECOMMENDABLE_SCORE = 60;

/** Confidence at which the band stops saying "unproven". */
const MIN_RECOMMENDABLE_CONFIDENCE = 0.3;

export class ProviderRecommender {
  private analytics: ProviderAnalytics;
  private ranking: ProviderRanking;
  private plugins: PluginManager;

  constructor(analytics: ProviderAnalytics, ranking: ProviderRanking, plugins: PluginManager) {
    this.analytics = analytics;
    this.ranking = ranking;
    this.plugins = plugins;
  }

  /**
   * Providers worth suggesting, best first.
   *
   * Includes ones already enabled. That looks redundant and is not: the list
   * doubles as "these are the ones carrying your searches", which is the
   * answer to "why is search slow" and "which of my two hundred providers
   * actually matters".
   */
  public recommendations(limit = 20): ProviderRecommendation[] {
    const enabled = new Set(this.plugins.getProvidersList());
    const disabledByUser = new Set(this.plugins.getDisabledProviders());

    const scored = this.analytics
      .all()
      .map((record) => this.ranking.score(record.provider))
      .filter(
        (score) =>
          score.score >= MIN_RECOMMENDABLE_SCORE &&
          score.confidence >= MIN_RECOMMENDABLE_CONFIDENCE &&
          score.preference !== 'blocked'
      )
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

    return scored.slice(0, limit).map((score) => ({
      provider: score.provider,
      extensionInternalName: score.extensionInternalName,
      extensionName: score.extensionName,
      repositoryId: score.repositoryId,
      repositoryName: score.repositoryName,
      score: score.score,
      confidence: score.confidence,
      band: score.band,
      reason: explain(score),
      currentlyEnabled: enabled.has(score.provider) && !disabledByUser.has(score.provider),
    }));
  }

  /**
   * Enables providers that have proved themselves, when the user has opted in.
   *
   * Returns the names it turned on so the caller can say so plainly. Silence
   * would be the wrong outcome even for a feature the user asked for — a
   * source list that grew on its own with no explanation is indistinguishable
   * from a bug.
   */
  public applyAutoEnable(): string[] {
    const settings = this.analytics.getSettings();
    if (!settings.enabled || !settings.autoEnableProven) return [];

    const disabled = new Set(this.plugins.getDisabledProviders());
    if (disabled.size === 0) return [];

    const promote: string[] = [];
    for (const name of disabled) {
      const score = this.ranking.score(name);
      if (score.preference === 'blocked') continue;
      if (score.samples < settings.autoEnableMinSamples) continue;
      if (score.score < settings.autoEnableMinScore) continue;
      promote.push(name);
    }

    if (promote.length > 0) this.plugins.setProvidersEnabled(promote, true);
    return promote;
  }

  /**
   * Ranked view of everything currently installed.
   *
   * Distinct from {@link recommendations}: this one hides nothing, because the
   * settings screen has to be able to show a provider its bad score as well as
   * a good one. A ranking you can only see when it agrees with you is not
   * inspectable.
   */
  public leaderboard(): ProviderScore[] {
    const installed = this.plugins.getProvidersList();
    const measured = this.analytics.all().map((record) => record.provider);
    const names = [...new Set([...installed, ...measured])];
    return this.ranking.rank(names).map((name) => this.ranking.score(name));
  }
}

/** One sentence saying what earned the recommendation. */
function explain(score: ProviderScore): string {
  const best = score.criteria
    .filter((criterion) => criterion.score !== null && criterion.samples > 0)
    .sort((a, b) => (b.score ?? 0) * b.weight - (a.score ?? 0) * a.weight)[0];

  const evidence = `${score.samples} recorded outcome${score.samples === 1 ? '' : 's'}`;
  if (!best) return `Scores ${score.score}/100 over ${evidence}.`;
  return `Scores ${score.score}/100 over ${evidence}. ${best.detail}`;
}
