import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ExternalLink, RefreshCw, Star } from 'lucide-react';
import type { CanonicalMediaIdentity, MediaRating } from '../../types/ratings.ts';

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

export const MediaRatings: React.FC<MediaRatingsProps> = ({ identity }) => {
  const [ratings, setRatings] = useState<MediaRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadRatings = useCallback(async (forceRefresh = false) => {
    if (!window.cloudstream?.getMediaRatings) return;
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const fn = forceRefresh
        ? window.cloudstream.refreshMediaRatings
        : window.cloudstream.getMediaRatings;
      const res = await fn(identity);
      if (isMounted.current && res.ok && Array.isArray(res.ratings)) {
        setRatings(res.ratings);
      }
    } catch {
      // Failure isolation: preserve whatever was previously loaded
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [identity]);

  useEffect(() => {
    void loadRatings(false);
  }, [loadRatings]);

  const handleRefresh = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (refreshing) return;
    void loadRatings(true);
  };

  const openUrl = (e: React.MouseEvent, url?: string) => {
    e.stopPropagation();
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // If initial load completed and 0 ratings found across all sources, keep area minimal
  if (!loading && ratings.length === 0) {
    return null;
  }

  return (
    <div className="media-ratings" aria-label="Media Ratings from IMDb, Rotten Tomatoes, Metacritic, and TMDB">
      <div className="media-ratings__header">
        <span className="media-ratings__title">Ratings</span>
        <button
          type="button"
          className={`media-ratings__refresh${refreshing ? ' media-ratings__refresh--spinning' : ''}`}
          onClick={handleRefresh}
          title="Refresh ratings from public sources"
          aria-label="Refresh ratings"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="media-ratings__chips">
        {loading && ratings.length === 0 ? (
          <div className="media-ratings__loading-skeleton">
            <span className="media-ratings__chip media-ratings__chip--skeleton" />
            <span className="media-ratings__chip media-ratings__chip--skeleton" />
            <span className="media-ratings__chip media-ratings__chip--skeleton" />
          </div>
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
      </div>
    </div>
  );
};
