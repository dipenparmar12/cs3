import type {
  CanonicalMediaIdentity,
  MediaRating,
  RatingFetchContext,
  RatingProvider,
} from '../../../../src/types/ratings.ts';

export class MetacriticRatingProvider implements RatingProvider {
  public readonly id = 'metacritic' as const;
  public readonly name = 'Metacritic';

  public async fetch(
    identity: CanonicalMediaIdentity,
    context?: RatingFetchContext
  ): Promise<MediaRating | null> {
    if (!context?.wikidataStatements) {
      return null;
    }

    try {
      const statements = await context.wikidataStatements;
      let metascore: number | undefined;
      let userScore: number | undefined;
      let voteCount: number | undefined;

      for (const st of statements) {
        const isMetacritic =
          st.reviewerLabel?.toLowerCase().includes('metacritic') ||
          st.reviewer?.includes('Q210394');

        if (!isMetacritic || !st.score) continue;

        const crit = (st.criterionLabel || '').toLowerCase();

        // Check for 100-point scale: "85/100" or "85"
        const hundredMatch = st.score.match(/(\d+)\s*\/\s*100/);
        // Check for 10-point scale (usually user score): "8.5/10"
        const tenMatch = st.score.match(/([\d.]+)\s*\/\s*10/);

        if (crit.includes('user') || crit.includes('audience')) {
          if (tenMatch) {
            userScore = parseFloat(tenMatch[1]);
          } else if (hundredMatch) {
            userScore = parseFloat((parseInt(hundredMatch[1], 10) / 10).toFixed(1));
          }
        } else {
          // Metascore (critic score)
          if (hundredMatch) {
            metascore = parseInt(hundredMatch[1], 10);
          } else {
            const rawInt = parseInt(st.score, 10);
            if (Number.isFinite(rawInt) && rawInt > 10 && rawInt <= 100) {
              metascore = rawInt;
            }
          }
        }

        if (st.reviews) {
          const parsedReviews = parseInt(st.reviews, 10);
          if (Number.isFinite(parsedReviews) && parsedReviews > 0) {
            voteCount = Math.max(voteCount ?? 0, parsedReviews);
          }
        }
      }

      if (metascore === undefined && userScore === undefined) {
        return null;
      }

      const primaryScore = metascore ?? (userScore !== undefined ? userScore * 10 : 0);
      let displayValue = `${primaryScore}/100`;

      if (metascore !== undefined && userScore !== undefined) {
        displayValue = `Metascore ${metascore}/100 · User ${userScore.toFixed(1)}/10`;
      } else if (metascore !== undefined) {
        displayValue = `${metascore}/100`;
      } else if (userScore !== undefined) {
        displayValue = `User ${userScore.toFixed(1)}/10`;
      }

      const searchTitle = identity.title || identity.originalTitle || '';
      const url = `https://www.metacritic.com/search/${encodeURIComponent(searchTitle)}/`;

      return {
        source: 'metacritic',
        score: primaryScore,
        maxScore: 100,
        displayValue,
        voteCount,
        userScore,
        url,
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
