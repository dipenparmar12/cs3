import { handle, } from './channel.ts';
import type { RegisterHandlers } from './services.ts';


/**
 * How providers have actually behaved, and what to do about it.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerAnalyticsHandlers: RegisterHandlers = (services) => {
  const {
    providerAnalytics,
    providerRanking,
    providerRecommender,
  } = services;

  // --- provider analytics and ranking --------------------------------------------
  /**
   * Everything measured, plus the score derived from it.
   *
   * One channel rather than two because the UI never wants one without the
   * other: a score with no counters behind it cannot be argued with, and
   * counters with no score are a spreadsheet.
   */
  handle(
    'analytics:getLeaderboard',
    async () => {
      return {
        scores: providerRecommender.leaderboard(),
        records: providerAnalytics.all(),
        settings: providerAnalytics.getSettings(),
        criteria: providerRanking.criteria(),
      };
    },
    { scores: [], records: [], criteria: [] }
  );

  handle(
    'analytics:getRecommendations',
    async (limit?: number) => {
      return { recommendations: providerRecommender.recommendations(limit ?? 20) };
    },
    { recommendations: [] }
  );

  handle('analytics:getSettings', async () => ({
    settings: providerAnalytics.getSettings(),
    criteria: providerRanking.criteria(),
  }));

  handle(
    'analytics:setSettings',
    async (next: Partial<ReturnType<typeof providerAnalytics.getSettings>>) => {
      return { settings: providerAnalytics.setSettings(next) };
    },
    { settings: providerAnalytics.getSettings() }
  );

  handle(
    'analytics:setWeight',
    async (id: string, weight: number) => {
      providerRanking.setWeight(id, weight);
      return { criteria: providerRanking.criteria() };
    },
    { criteria: providerRanking.criteria() }
  );

  handle('analytics:resetWeights', async () => {
    providerRanking.resetWeights();
    return { criteria: providerRanking.criteria() };
  });

  /**
   * The user's thumb on the scale.
   *
   * Explicit preference outranks every measurement, because these are averages
   * over scrapes of third-party sites and someone who knows their region's best
   * source should not have to out-argue a running total.
   */
  handle('analytics:setPreference', async (provider: string, preference: 'preferred' | 'blocked' | null) => {
    providerAnalytics.setPreference(provider, preference);
    return { score: providerRanking.score(provider) };

  });

  /** The privacy control. Erases the history; the settings survive. */
  handle('analytics:reset', async (provider?: string) => {
    if (provider) providerAnalytics.resetProvider(provider);
    else providerAnalytics.reset();
    return {};
  });

  handle(
    'analytics:applyAutoEnable',
    async () => {
      return { enabled: providerRecommender.applyAutoEnable() };
    },
    { enabled: [] }
  );

  /**
   * Records an outcome only the renderer can see.
   *
   * Playback is the case this exists for: whether a source actually produced
   * pictures is known to the `<video>` element and to nothing in the main
   * process. Downloads report from the main process directly.
   */
  handle('analytics:observe', async (input: {
        provider: string;
        stage: 'search' | 'detail' | 'links' | 'playback' | 'download';
        outcome: 'success' | 'empty' | 'failure';
        produced?: number;
        latencyMs?: number;
        error?: string;
      }) => {
    providerAnalytics.observe(input);
    return {};

  });
};
