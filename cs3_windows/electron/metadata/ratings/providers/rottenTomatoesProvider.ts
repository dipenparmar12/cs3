import type {
  CanonicalMediaIdentity,
  MediaRating,
  RatingFetchContext,
  RatingProvider,
} from '../types.ts';

export class RottenTomatoesRatingProvider implements RatingProvider {
  public readonly id = 'rottenTomatoes' as const;
  public readonly name = 'Rotten Tomatoes';

  public async fetch(
    identity: CanonicalMediaIdentity,
    context?: RatingFetchContext
  ): Promise<MediaRating | null> {
    if (!context?.wikidataStatements) {
      return null;
    }

    try {
      const statements = await context.wikidataStatements;
      let criticsScore: number | undefined;
      let audienceScore: number | undefined;
      let voteCount: number | undefined;

      for (const st of statements) {
        const isRt =
          st.reviewerLabel?.toLowerCase().includes('rotten tomatoes') ||
          st.reviewer?.includes('Q105584');

        if (!isRt || !st.score) continue;

        const crit = (st.criterionLabel || '').toLowerCase();
        let numVal: number | null = null;

        // e.g. "94%", "7.1/10", "71%"
        const pctMatch = st.score.match(/(\d+)%/);
        if (pctMatch) {
          numVal = parseInt(pctMatch[1], 10);
        } else {
          const tenMatch = st.score.match(/([\d.]+)\s*\/\s*10/);
          if (tenMatch) {
            numVal = Math.round(parseFloat(tenMatch[1]) * 10);
          }
        }

        if (numVal === null || !Number.isFinite(numVal)) continue;

        if (crit.includes('audience') || crit.includes('popcorn') || crit.includes('reception')) {
          audienceScore = numVal;
        } else if (crit.includes('tomatometer') || crit.includes('critic') || crit.includes('rated reviews')) {
          if (criticsScore === undefined || crit.includes('tomatometer')) {
            criticsScore = numVal;
          }
        } else {
          // Default to critics / Tomatometer
          if (criticsScore === undefined) {
            criticsScore = numVal;
          }
        }

        if (st.reviews) {
          const parsedReviews = parseInt(st.reviews, 10);
          if (Number.isFinite(parsedReviews) && parsedReviews > 0) {
            voteCount = Math.max(voteCount ?? 0, parsedReviews);
          }
        }
      }

      if (criticsScore === undefined && audienceScore === undefined) {
        return null;
      }

      const primaryScore = criticsScore ?? audienceScore ?? 0;
      let displayValue = `${primaryScore}%`;
      if (criticsScore !== undefined && audienceScore !== undefined) {
        displayValue = `Critics ${criticsScore}% · Audience ${audienceScore}%`;
      } else if (audienceScore !== undefined && criticsScore === undefined) {
        displayValue = `Audience ${audienceScore}%`;
      }

      const searchTitle = identity.title || identity.originalTitle || '';
      const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(searchTitle)}`;

      return {
        source: 'rottenTomatoes',
        score: primaryScore,
        maxScore: 100,
        displayValue,
        voteCount,
        criticsScore,
        audienceScore,
        url,
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
