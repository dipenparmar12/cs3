import type {
  CriterionScore,
  ProviderAnalyticsRecord,
  ProviderScore,
  RankingCriterionInfo,
  RecommendationBand,
} from '../../src/types/analytics';
import { PRIOR_RATE, PRIOR_WEIGHT, ProviderAnalytics } from './providerAnalytics';

/**
 * Turns measured behaviour into an order.
 *
 * The app can have several hundred providers enabled and used to treat them as
 * interchangeable — every search asked all of them, every result list was
 * ordered by whoever answered first, and the source picker offered a dead link
 * beside a working one with nothing to tell them apart. This decides which of
 * those is worth asking first and which answer is worth playing.
 *
 * ## Why a registry rather than a formula
 *
 * The criteria worth scoring on will change: response time, subtitle
 * availability, resolution, language, geography and user preference are all
 * plausible and none is measurable yet. Hard-coding the current two into the
 * comparison — or worse, into the UI that displays it — would mean every
 * addition rewrites the ordering logic and the settings screen together. So a
 * criterion is a row in a table: an id, a weight, a minimum sample count, and a
 * function from one provider's record to `0..1` or `null` for "cannot say".
 * Adding one is adding an entry.
 *
 * A criterion that returns `null` is **excluded from the denominator**, not
 * scored as zero. That distinction is the whole reason the null exists: a
 * provider nobody has tried to download from must not be ranked below one that
 * has failed every download.
 *
 * ## Why the scores are smoothed
 *
 * Rates come from {@link ProviderAnalytics.rate}, which blends a neutral prior
 * into every ratio. Without it the ranking is self-fulfilling: a provider that
 * answered its single search scores 100%, sorts above a provider with 95% over
 * four hundred calls, gets asked first, and stays there. With it, a new
 * provider starts mid-table, climbs on evidence, and can never be permanently
 * buried by one unlucky first call — which matters because these are scrapes of
 * third-party sites and a single failure is usually the site's fault.
 */

/** Observations at which a provider's score is considered fully evidenced. */
const CONFIDENCE_SCALE = 25;

/** A search answered faster than this is as good as instant. */
const FAST_MS = 1_200;
/** A search slower than this scores zero on responsiveness. */
const SLOW_MS = 25_000;

/** Half-life for "has this provider worked recently", in days. */
const FRESHNESS_HALF_LIFE_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

interface CriterionDefinition {
  id: string;
  label: string;
  description: string;
  defaultWeight: number;
  minSamples: number;
  /** False for criteria registered ahead of the data that would feed them. */
  available: boolean;
  evaluate(
    record: ProviderAnalyticsRecord,
    analytics: ProviderAnalytics,
    context: RankingContext
  ): { score: number | null; samples: number; detail: string };
}

/**
 * Anything a criterion needs that is not a measurement.
 *
 * Exactly one thing so far, and it is deliberately the only kind of input
 * allowed here: a *declaration*, from a source outside this app, that can be
 * quoted rather than trusted. Nothing computed from the user's own behaviour
 * belongs on this path — that is what the counters are for.
 */
export interface RankingContext {
  /**
   * The maintainer's own health flag for the extension a provider came from:
   * `0` down, `1` ok, `2` slow, `3` beta. `undefined` when the repository index
   * did not say, which is a real and common answer.
   */
  declaredStatus?: (extensionInternalName: string) => number | undefined;
}

/**
 * The criteria, in the order they are shown.
 *
 * The two the product brief asks for first — *does this provider return
 * sources* and *do those sources actually play* — are split into four here,
 * because "returned sources" and "returned sources for this title" are
 * different failures and averaging them hides a provider that answers
 * everything with nothing.
 *
 * Weights are ordered by how much each predicts a good outcome for the viewer.
 * Playback success is weighted highest deliberately: it is the only criterion
 * measured against what the user was actually trying to do.
 */
const CRITERIA: CriterionDefinition[] = [
  {
    id: 'search-reliability',
    label: 'Answers searches',
    description:
      'How often a search reaches the provider and comes back without an error. Timeouts, blocks and extension crashes all count against this.',
    defaultWeight: 1.0,
    minSamples: 3,
    available: true,
    evaluate(record, analytics) {
      const { rate, samples } = analytics.rate(record, 'search');
      const counters = record.stages.search;
      return {
        score: rate,
        samples,
        detail:
          samples === 0
            ? 'No searches recorded yet.'
            : `${counters.successes} of ${counters.successes + counters.failures} searches answered (${pct(rate)}).`,
      };
    },
  },
  {
    id: 'search-yield',
    label: 'Finds titles',
    description:
      'Of the searches that succeeded, how many actually returned results. A provider that answers instantly with nothing scores low here and high on reliability — which is exactly the difference worth seeing.',
    defaultWeight: 0.6,
    minSamples: 5,
    available: true,
    evaluate(record) {
      const counters = record.stages.search;
      const productive = counters.successes;
      const ran = counters.successes + counters.empty;
      if (ran === 0) return { score: null, samples: 0, detail: 'No completed searches yet.' };
      const rate = productive / ran;
      return {
        score: rate,
        samples: ran,
        detail: `${productive} of ${ran} completed searches returned results (${pct(rate)}).`,
      };
    },
  },
  {
    id: 'detail-reliability',
    label: 'Loads details',
    description:
      'Whether opening a result produces a usable details page. A provider whose search works but whose detail pages have changed shape fails here.',
    defaultWeight: 0.6,
    minSamples: 3,
    available: true,
    evaluate(record, analytics) {
      const { rate, samples } = analytics.rate(record, 'detail');
      if (samples === 0) return { score: null, samples: 0, detail: 'No titles opened yet.' };
      return {
        score: rate,
        samples,
        detail: `${record.stages.detail.successes} of ${samples} detail loads succeeded (${pct(rate)}).`,
      };
    },
  },
  {
    id: 'link-resolution',
    label: 'Produces playable links',
    description:
      'Whether the provider resolves a title into links at all. This is the step that produces "the extension provider returned no playable links".',
    defaultWeight: 1.2,
    minSamples: 3,
    available: true,
    evaluate(record) {
      const counters = record.stages.links;
      const attempted = counters.successes + counters.empty + counters.failures;
      if (attempted === 0) return { score: null, samples: 0, detail: 'No link resolutions yet.' };
      // Empty counts against this one, unlike search: a provider that offers a
      // title and then has no way to play it has wasted the user's click.
      // Smoothed by hand rather than through `analytics.rate`, which excludes
      // `empty` from its denominator by design.
      const rate = (counters.successes + PRIOR_WEIGHT * PRIOR_RATE) / (attempted + PRIOR_WEIGHT);
      return {
        score: clamp01(rate),
        samples: attempted,
        detail: `${counters.successes} of ${attempted} attempts produced links (${pct(counters.successes / attempted)}), ${counters.produced} links in total.`,
      };
    },
  },
  {
    id: 'playback-success',
    label: 'Plays',
    description:
      'Whether a link from this provider actually delivered video. The only criterion measured against what the viewer was trying to do, and weighted accordingly.',
    defaultWeight: 1.5,
    minSamples: 2,
    available: true,
    evaluate(record, analytics) {
      const { rate, samples } = analytics.rate(record, 'playback');
      if (samples === 0) return { score: null, samples: 0, detail: 'Nothing played from this provider yet.' };
      return {
        score: rate,
        samples,
        detail: `${record.stages.playback.successes} of ${samples} playback attempts started (${pct(rate)}).`,
      };
    },
  },
  {
    id: 'download-success',
    label: 'Downloads',
    description:
      'Whether a link from this provider downloaded successfully. Separate from playback because a link can stream and fail to download, and the reverse.',
    defaultWeight: 0.5,
    minSamples: 2,
    available: true,
    evaluate(record, analytics) {
      const { rate, samples } = analytics.rate(record, 'download');
      if (samples === 0) return { score: null, samples: 0, detail: 'Nothing downloaded from this provider yet.' };
      return {
        score: rate,
        samples,
        detail: `${record.stages.download.successes} of ${samples} downloads completed (${pct(rate)}).`,
      };
    },
  },
  {
    id: 'response-time',
    label: 'Responds quickly',
    description:
      'Recent search latency. Weighted lightly on purpose — a slow provider that always works is more useful than a fast one that never does.',
    defaultWeight: 0.5,
    minSamples: 3,
    available: true,
    evaluate(record, analytics) {
      const latency = analytics.latency(record, 'search');
      const samples = record.stages.search.latencySamples;
      if (latency === null || samples === 0) {
        return { score: null, samples: 0, detail: 'No timings recorded yet.' };
      }
      const score = clamp01(1 - (latency - FAST_MS) / (SLOW_MS - FAST_MS));
      return {
        score,
        samples,
        detail: `Recently answering in about ${(latency / 1000).toFixed(1)}s.`,
      };
    },
  },
  {
    id: 'freshness',
    label: 'Still working',
    description:
      'How recently anything from this provider succeeded. Scrapers break when the site they read changes, and the last success is the earliest signal of it.',
    defaultWeight: 0.4,
    minSamples: 1,
    available: true,
    evaluate(record, analytics) {
      const total = analytics.totalSamples(record);
      if (total === 0) return { score: null, samples: 0, detail: 'Never used.' };
      if (!record.lastSuccessAt) {
        return { score: 0, samples: total, detail: 'Has never succeeded at anything.' };
      }
      const days = (Date.now() - record.lastSuccessAt) / DAY_MS;
      const score = clamp01(Math.exp((-days * Math.LN2) / FRESHNESS_HALF_LIFE_DAYS));
      const when =
        days < 1 ? 'today' : days < 2 ? 'yesterday' : `${Math.round(days)} days ago`;
      return { score, samples: total, detail: `Last worked ${when}.` };
    },
  },
  {
    id: 'usage',
    label: 'Proven by use',
    description:
      'How much evidence exists at all. Contributes a little so a provider with a long clean record outranks an equally clean one with three calls behind it.',
    defaultWeight: 0.25,
    minSamples: 1,
    available: true,
    evaluate(record, analytics) {
      const total = analytics.totalSamples(record);
      if (total === 0) return { score: null, samples: 0, detail: 'Never used.' };
      const score = clamp01(1 - Math.exp(-total / (CONFIDENCE_SCALE * 2)));
      return { score, samples: total, detail: `${total} recorded outcomes.` };
    },
  },

  // Registered ahead of the data, and reported to the settings screen as
  // unavailable rather than hidden. A criterion nobody can see is a criterion
  // nobody asks for; one shown greyed out is a promise with a visible cost.
  {
    id: 'resolution-availability',
    label: 'Offers high resolutions',
    description: 'Whether the provider’s links tend to be 1080p or better. Not yet measured.',
    defaultWeight: 0.4,
    minSamples: 5,
    available: false,
    evaluate: () => ({ score: null, samples: 0, detail: 'Not measured yet.' }),
  },
  {
    id: 'subtitle-availability',
    label: 'Supplies subtitles',
    description: 'Whether the provider returns subtitles alongside its links. Not yet measured.',
    defaultWeight: 0.3,
    minSamples: 5,
    available: false,
    evaluate: () => ({ score: null, samples: 0, detail: 'Not measured yet.' }),
  },
  {
    id: 'language-availability',
    label: 'Matches your languages',
    description: 'Whether the audio and subtitle languages match your preferences. Not yet measured.',
    defaultWeight: 0.3,
    minSamples: 5,
    available: false,
    evaluate: () => ({ score: null, samples: 0, detail: 'Not measured yet.' }),
  },
  {
    /**
     * The one criterion that is not a measurement, and the reason it exists.
     *
     * On a fresh install every provider has zero observations, so every
     * criterion above returns `null`, every provider scores the neutral
     * midpoint, and the ordering is whatever the map happened to iterate in.
     * That is the moment a new user forms their opinion of the app — and it is
     * the moment the ranking, which is built entirely on evidence, has none.
     *
     * There is evidence, though; it is just not ours. Every CloudStream
     * repository index carries a `status` per plugin — `0` down, `1` ok, `2`
     * slow, `3` beta — set by the person who maintains the scraper. It has been
     * parsed into `SitePlugin.status` all along and read by nothing. Quoting it
     * is honest in a way that a hand-written table of "good providers" would
     * not be: it is the author's own claim about their own extension, it
     * updates when they update it, and it needs no judgement from us about
     * third-party code we did not write.
     *
     * Weighted low on purpose. It is a claim, not a result, and it must lose to
     * the counters the moment those have anything to say — a provider the
     * maintainer calls healthy that has failed nine of ten searches here should
     * rank below one they marked beta that works.
     */
    id: 'maintainer-status',
    label: 'Maintainer’s own status',
    description:
      'What the extension’s author publishes about it in their repository — working, slow, beta, ' +
      'or down. A claim rather than a measurement, so it counts for little once this app has ' +
      'watched the provider itself.',
    defaultWeight: 0.4,
    // No floor: a declaration is not a sample, and requiring three of them
    // would exclude the criterion from every provider, forever.
    minSamples: 0,
    available: true,
    evaluate(record, _analytics, context) {
      const status = record.extensionInternalName
        ? context.declaredStatus?.(record.extensionInternalName)
        : undefined;
      if (status === undefined) {
        return { score: null, samples: 0, detail: 'The repository does not publish a status.' };
      }
      const table: Record<number, { score: number; detail: string }> = {
        0: { score: 0, detail: 'The maintainer marks this extension as down.' },
        1: { score: 1, detail: 'The maintainer marks this extension as working.' },
        2: { score: 0.5, detail: 'The maintainer marks this extension as slow.' },
        3: { score: 0.25, detail: 'The maintainer marks this extension as beta.' },
      };
      const entry = table[status];
      return entry
        ? { score: entry.score, samples: 1, detail: entry.detail }
        : {
            score: null,
            samples: 0,
            detail: `The repository publishes an unrecognised status (${status}).`,
          };
    },
  },
];

export class ProviderRanking {
  private weights = new Map<string, number>();
  private analytics: ProviderAnalytics;
  private context: RankingContext = {};

  constructor(analytics: ProviderAnalytics) {
    this.analytics = analytics;
    for (const criterion of CRITERIA) this.weights.set(criterion.id, criterion.defaultWeight);
    this.restoreWeights();
  }

  /**
   * Supplies the non-measured inputs, after construction.
   *
   * Set rather than injected because `PluginManager` and `ProviderRanking` are
   * both constructed in `main.ts` and each would otherwise need the other
   * first. A ranking with no context is still correct — the criterion returns
   * `null` and is excluded from the denominator, exactly as it is for a
   * repository that publishes no status.
   */
  public setContext(context: RankingContext): void {
    this.context = context;
  }

  private restoreWeights(): void {
    const stored = this.analytics.getSettings().criterionWeights;
    if (!stored) return;
    for (const [id, weight] of Object.entries(stored)) {
      if (this.weights.has(id) && Number.isFinite(weight)) {
        this.weights.set(id, Math.max(0, weight));
      }
    }
  }

  public criteria(): RankingCriterionInfo[] {
    return CRITERIA.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      weight: this.weights.get(criterion.id) ?? criterion.defaultWeight,
      minSamples: criterion.minSamples,
      available: criterion.available,
    }));
  }

  public setWeight(id: string, weight: number): void {
    if (!this.weights.has(id)) return;
    this.weights.set(id, Math.max(0, Number.isFinite(weight) ? weight : 0));
    this.analytics.setSettings({
      criterionWeights: Object.fromEntries(this.weights),
    });
  }

  public resetWeights(): void {
    for (const criterion of CRITERIA) this.weights.set(criterion.id, criterion.defaultWeight);
    this.analytics.setSettings({ criterionWeights: Object.fromEntries(this.weights) });
  }

  /**
   * Scores one provider.
   *
   * A provider with no record at all is reported as `unproven` at the neutral
   * midpoint rather than at zero. Zero would be a ranking that never gives a
   * new extension a turn, and the whole point of measuring is to find the good
   * ones — including the ones installed yesterday.
   */
  public score(provider: string): ProviderScore {
    const record = this.analytics.get(provider);
    const preference = this.analytics.getPreference(provider);

    if (!record) {
      return {
        provider,
        score: 50,
        confidence: 0,
        samples: 0,
        band: preference === 'blocked' ? 'failing' : 'unproven',
        criteria: CRITERIA.filter((c) => c.available).map((c) => ({
          id: c.id,
          label: c.label,
          weight: this.weights.get(c.id) ?? c.defaultWeight,
          score: null,
          samples: 0,
          detail: 'Never used.',
        })),
        preference,
      };
    }

    const criteria: CriterionScore[] = [];
    let weighted = 0;
    let weightTotal = 0;

    for (const criterion of CRITERIA) {
      if (!criterion.available) continue;
      const weight = this.weights.get(criterion.id) ?? criterion.defaultWeight;
      const outcome = criterion.evaluate(record, this.analytics, this.context);

      // Below the sample floor the criterion has an opinion but not the
      // evidence to act on it, so it is shown and not counted.
      const counts =
        outcome.score !== null && outcome.samples >= criterion.minSamples && weight > 0;
      if (counts) {
        weighted += outcome.score! * weight;
        weightTotal += weight;
      }

      criteria.push({
        id: criterion.id,
        label: criterion.label,
        weight,
        score: outcome.score,
        samples: outcome.samples,
        detail: counts
          ? outcome.detail
          : outcome.score === null
            ? outcome.detail
            : `${outcome.detail} Not counted yet — needs ${criterion.minSamples} observations.`,
      });
    }

    const samples = this.analytics.totalSamples(record);
    const confidence = clamp01(1 - Math.exp(-samples / CONFIDENCE_SCALE));
    const raw = weightTotal > 0 ? weighted / weightTotal : 0.5;
    const score = Math.round(clamp01(raw) * 100);

    return {
      provider,
      repositoryId: record.repositoryId,
      repositoryName: record.repositoryName,
      extensionInternalName: record.extensionInternalName,
      extensionName: record.extensionName,
      score,
      confidence,
      samples,
      band: band(score, confidence, preference),
      criteria,
      preference,
    };
  }

  public scoreAll(providers: string[]): ProviderScore[] {
    return providers.map((provider) => this.score(provider));
  }

  /**
   * Orders providers best-first.
   *
   * A user's explicit choice wins outright — pinned providers lead and blocked
   * ones trail — because the measurements are noisy scrapes of third-party
   * sites and someone who knows their region's best source should not have to
   * argue with a running average. Ties fall back to name so the order is stable
   * between renders; an ordering that shuffles on every search reads as a bug.
   */
  public rank(providers: string[]): string[] {
    const scores = new Map<string, ProviderScore>();
    for (const provider of providers) scores.set(provider, this.score(provider));

    return [...providers].sort((a, b) => {
      const sa = scores.get(a)!;
      const sb = scores.get(b)!;
      const pa = preferenceRank(sa);
      const pb = preferenceRank(sb);
      if (pa !== pb) return pa - pb;
      if (sb.score !== sa.score) return sb.score - sa.score;
      // Between equal scores prefer the better-evidenced one.
      if (sb.confidence !== sa.confidence) return sb.confidence - sa.confidence;
      return a.localeCompare(b);
    });
  }
}

function preferenceRank(score: ProviderScore): number {
  if (score.preference === 'preferred') return 0;
  if (score.preference === 'blocked') return 2;
  return 1;
}

function band(
  score: number,
  confidence: number,
  preference?: 'preferred' | 'blocked'
): RecommendationBand {
  if (preference === 'blocked') return 'failing';
  if (preference === 'preferred') return 'strong';
  // Confidence gates the *label*, not the number. Calling a provider "strong"
  // on four observations is the claim that ages worst.
  if (confidence < 0.25) return 'unproven';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'good';
  if (score >= 40) return 'weak';
  return 'failing';
}
