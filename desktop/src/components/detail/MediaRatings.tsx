import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { CanonicalMediaIdentity, MediaRating } from '../../types/ratings.ts';
import {
  emptyRatingsView,
  latestOnly,
  ratingsRequestKey,
  ratingsRowState,
  ratingsWorkKey,
  settleRatings,
  type RatingsView,
} from './ratingsRow.ts';

interface MediaRatingsProps {
  identity: CanonicalMediaIdentity;
}

function formatVotes(count?: number): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}M votes`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${val}K votes`;
  }
  return `${count.toLocaleString()} votes`;
}

/**
 * IMDb, Rotten Tomatoes, Metacritic and TMDB, as one row of chips.
 *
 * One request per title, not per render. The hero rebuilds `identity` every
 * time anything on it changes — a source count ticking, a catalogue answering —
 * and keying the request on the object made every one of those refetch and
 * flip back to loading: for a title with no ratings, the row appeared as a
 * skeleton and collapsed again on each render. The request is keyed on the
 * work (title, year, type) and the ids that refine it, and:
 *
 * - a refinement (an IMDb id arriving later) asks again but keeps what is shown
 *   until the answer lands, and an empty answer never blanks a filled row;
 * - an answer for an identity that has since changed is dropped;
 * - while the first answer is outstanding the row holds its own height, so the
 *   chips replace the placeholder in place; settled with nothing, it is gone.
 */
export const MediaRatings: React.FC<MediaRatingsProps> = ({ identity }) => {
  const workKey = ratingsWorkKey(identity);
  const requestKey = ratingsRequestKey(identity);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [view, setView] = useState<RatingsView>(() => emptyRatingsView(workKey));
  const [refreshing, setRefreshing] = useState(false);
  const tickets = useRef(latestOnly());

  const load = useCallback(
    async (forceRefresh: boolean) => {
      const api = window.cloudstream;
      if (!api?.getMediaRatings) {
        setView((current) => settleRatings(current, workKey, null));
        return;
      }
      const ticket = tickets.current.issue();
      if (forceRefresh) setRefreshing(true);
      let found: MediaRating[] | null = null;
      try {
        const res = await (forceRefresh ? api.refreshMediaRatings : api.getMediaRatings)(identityRef.current);
        if (res.ok && Array.isArray(res.ratings)) found = res.ratings;
      } catch {
        // Failure isolation: whatever was shown stays.
      }
      if (!tickets.current.isCurrent(ticket)) return;
      setRefreshing(false);
      setView((current) => settleRatings(current, workKey, found));
    },
    [workKey]
  );

  useEffect(() => {
    void load(false);
    // `requestKey` is what changes the answer; `load` itself only changes with the work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refreshing) return;
    void load(true);
  };

  const openUrl = (e: React.MouseEvent, url?: string) => {
    e.stopPropagation();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const row = ratingsRowState(view, workKey);
  if (row === 'hidden') return null;
  const ratings = row === 'chips' ? view.ratings : [];

  return (
    <div className="media-ratings" aria-label="Ratings" aria-busy={row === 'placeholder' || undefined}>
      <div className="media-ratings__chips">
        {row === 'placeholder' ? (
          <>
            <span className="media-ratings__chip media-ratings__chip--skeleton" aria-hidden />
            <span className="media-ratings__chip media-ratings__chip--skeleton" aria-hidden />
            <span className="media-ratings__chip media-ratings__chip--skeleton" aria-hidden />
          </>
        ) : (
          ratings.map((r) => {
            if (r.source === 'imdb') {
              return (
                <div
                  key="imdb"
                  className="media-ratings__chip media-ratings__chip--imdb"
                  onClick={(e) => openUrl(e, r.url)}
                  title={r.url ? `View on IMDb (${r.url})` : 'IMDb rating'}
                  role={r.url ? 'link' : undefined}
                >
                  <span className="media-ratings__badge media-ratings__badge--imdb">IMDb</span>
                  <div className="media-ratings__values">
                    <span className="media-ratings__score">{r.score.toFixed(1)}/10</span>
                    {r.voteCount ? (
                      <span className="media-ratings__votes">({formatVotes(r.voteCount)})</span>
                    ) : null}
                  </div>
                  {r.url && <ExternalLink size={11} className="media-ratings__external" />}
                </div>
              );
            }

            if (r.source === 'rottenTomatoes') {
              const hasBoth = r.criticsScore !== undefined && r.audienceScore !== undefined;
              return (
                <div
                  key="rottenTomatoes"
                  className="media-ratings__chip media-ratings__chip--rt"
                  onClick={(e) => openUrl(e, r.url)}
                  title={r.url ? `View on Rotten Tomatoes (${r.url})` : 'Rotten Tomatoes rating'}
                  role={r.url ? 'link' : undefined}
                >
                  <span className="media-ratings__badge media-ratings__badge--rt">RT</span>
                  <div className="media-ratings__values">
                    {r.criticsScore !== undefined && (
                      <span className="media-ratings__sub-score" title="Critics Tomatometer">
                        <span className="media-ratings__label">Critics:</span>{' '}
                        <strong className={r.criticsScore >= 60 ? 'rt-fresh' : 'rt-rotten'}>
                          {r.criticsScore}%
                        </strong>
                      </span>
                    )}
                    {hasBoth && <span className="media-ratings__dot">·</span>}
                    {r.audienceScore !== undefined && (
                      <span className="media-ratings__sub-score" title="Audience Popcornmeter">
                        <span className="media-ratings__label">Audience:</span>{' '}
                        <strong className={r.audienceScore >= 60 ? 'rt-fresh' : 'rt-rotten'}>
                          {r.audienceScore}%
                        </strong>
                      </span>
                    )}
                    {!hasBoth && r.criticsScore === undefined && r.audienceScore === undefined && (
                      <span className="media-ratings__score">{r.displayValue}</span>
                    )}
                  </div>
                  {r.url && <ExternalLink size={11} className="media-ratings__external" />}
                </div>
              );
            }

            if (r.source === 'metacritic') {
              const metaVal = r.score;
              const metaColorClass =
                metaVal >= 61
                  ? 'meta-positive'
                  : metaVal >= 40
                    ? 'meta-mixed'
                    : 'meta-negative';

              return (
                <div
                  key="metacritic"
                  className="media-ratings__chip media-ratings__chip--metacritic"
                  onClick={(e) => openUrl(e, r.url)}
                  title={r.url ? `View on Metacritic (${r.url})` : 'Metacritic score'}
                  role={r.url ? 'link' : undefined}
                >
                  <span className={`media-ratings__badge media-ratings__badge--metacritic ${metaColorClass}`}>
                    MC
                  </span>
                  <div className="media-ratings__values">
                    <span className="media-ratings__sub-score" title="Metascore">
                      <span className="media-ratings__label">Metascore:</span>{' '}
                      <strong>{r.score}/100</strong>
                    </span>
                    {r.userScore !== undefined && (
                      <>
                        <span className="media-ratings__dot">·</span>
                        <span className="media-ratings__sub-score" title="User Score">
                          <span className="media-ratings__label">User:</span>{' '}
                          <strong>{r.userScore.toFixed(1)}/10</strong>
                        </span>
                      </>
                    )}
                  </div>
                  {r.url && <ExternalLink size={11} className="media-ratings__external" />}
                </div>
              );
            }

            if (r.source === 'tmdb') {
              return (
                <div
                  key="tmdb"
                  className="media-ratings__chip media-ratings__chip--tmdb"
                  onClick={(e) => openUrl(e, r.url)}
                  title={r.url ? `View on TMDB (${r.url})` : 'The Movie Database rating'}
                  role={r.url ? 'link' : undefined}
                >
                  <span className="media-ratings__badge media-ratings__badge--tmdb">TMDB</span>
                  <div className="media-ratings__values">
                    <span className="media-ratings__score">{r.score.toFixed(1)}/10</span>
                    {r.voteCount ? (
                      <span className="media-ratings__votes">({formatVotes(r.voteCount)})</span>
                    ) : null}
                  </div>
                  {r.url && <ExternalLink size={11} className="media-ratings__external" />}
                </div>
              );
            }

            return null;
          })
        )}
        {ratings.length > 0 && (
          <button
            type="button"
            className={`media-ratings__refresh${refreshing ? ' media-ratings__refresh--spinning' : ''}`}
            onClick={handleRefresh}
            title="Refresh ratings"
            aria-label="Refresh ratings"
          >
            <RefreshCw size={12} />
          </button>
        )}
      </div>
    </div>
  );
};
