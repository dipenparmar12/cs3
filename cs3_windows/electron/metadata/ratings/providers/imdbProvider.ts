import type {
  CanonicalMediaIdentity,
  MediaRating,
  RatingFetchContext,
  RatingProvider,
} from '../types.ts';
import { fetchJson } from '../../../torrent/http.ts';

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

export class IMDbRatingProvider implements RatingProvider {
  public readonly id = 'imdb' as const;
  public readonly name = 'IMDb';

  public async fetch(
    identity: CanonicalMediaIdentity,
    context?: RatingFetchContext
  ): Promise<MediaRating | null> {
    const imdbId = identity.imdbId?.trim();
    if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
      return null;
    }

    let score: number | null = null;
    let voteCount: number | undefined = undefined;

    // 1. Try Wikidata statements if available in context
    if (context?.wikidataStatements) {
      try {
        const statements = await context.wikidataStatements;
        for (const st of statements) {
          const isImdb =
            st.reviewerLabel?.toLowerCase() === 'imdb' ||
            st.reviewer?.includes('Q37312');
          if (isImdb && st.score) {
            // e.g. "9.1/10" or "8.7"
            const match = st.score.match(/([\d.]+)/);
            if (match) {
              const val = parseFloat(match[1]);
              if (Number.isFinite(val) && val > 0 && val <= 10) {
                score = val;
              }
            }
            if (st.reviews) {
              const parsedReviews = parseInt(st.reviews, 10);
              if (Number.isFinite(parsedReviews) && parsedReviews > 0) {
                voteCount = parsedReviews;
              }
            }
          }
        }
      } catch {
        // Fall back to Cinemeta
      }
    }

    // 2. If score is still missing, query Cinemeta meta endpoint
    if (score === null) {
      try {
        const type = identity.type === 'series' || identity.type === 'tv' ? 'series' : 'movie';
        let meta = context?.cinemetaMeta ? await context.cinemetaMeta : null;
        if (!meta) {
          const res = await fetchJson<{ meta?: Record<string, unknown> }>(
            `${CINEMETA_BASE}/meta/${type}/${imdbId}.json`,
            { timeoutMs: 8_000 }
          );
          meta = res.meta ?? null;
        }

        if (meta && typeof meta.imdbRating === 'string') {
          const parsed = parseFloat(meta.imdbRating);
          if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10) {
            score = parsed;
          }
        }
        if (meta && typeof meta.imdbVotes === 'number') {
          voteCount = meta.imdbVotes;
        } else if (meta && typeof meta.imdbVotes === 'string') {
          const v = parseInt(meta.imdbVotes.replace(/,/g, ''), 10);
          if (Number.isFinite(v) && v > 0) voteCount = v;
        }
      } catch {
        // Cinemeta failed
      }
    }

    if (score === null) {
      return null;
    }

    return {
      source: 'imdb',
      score,
      maxScore: 10,
      displayValue: `${score.toFixed(1)}/10`,
      voteCount,
      url: `https://www.imdb.com/title/${imdbId}/`,
      fetchedAt: Date.now(),
    };
  }
}
