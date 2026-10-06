import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Film,
  Loader2,
  MessageSquare,
  Play,
  RotateCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';

import { Poster } from '../Poster';
import type {
  RelatedMediaCategory,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../types/relatedMedia';
import type { TitleVideo } from '../../types/metadata';
import { TitleVideoKind } from '../../types/metadata';
import { formatVideoDuration } from '../../utils/videoGallery';

export interface ReviewsAndExplanationsProps {
  title: string;
  originalTitle?: string;
  year?: number;
  season?: number;
  episode?: number;
  onPlayVideo?: (video: TitleVideo) => void;
}

const CATEGORY_LABELS: Record<RelatedMediaCategory, string> = {
  review: 'Reviews',
  explanation: 'Explanations',
  recap: 'Recaps',
  analysis: 'Analysis',
  interview: 'Interviews',
  discussion: 'Discussions',
  other: 'Other',
};

const CATEGORY_ORDER: RelatedMediaCategory[] = [
  'review',
  'explanation',
  'analysis',
  'recap',
  'interview',
  'discussion',
  'other',
];

const INITIAL_VISIBLE_COUNT = 12;

export const ReviewsAndExplanations: React.FC<ReviewsAndExplanationsProps> = ({
  title,
  originalTitle,
  year,
  season,
  episode,
  onPlayVideo,
}) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [results, setResults] = useState<RelatedMediaResult[]>([]);
  const [activeCategory, setActiveCategory] = useState<RelatedMediaCategory | 'all'>('all');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(
    async (forceRefresh = false) => {
      if (!title.trim()) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setStatus('loading');
      setErrorMessage(null);

      try {
        const req: RelatedMediaSearchRequest = {
          title,
          originalTitle,
          year,
          season,
          episode,
          type: 'all',
          forceRefresh,
        };

        const res = await window.cloudstream?.findRelatedMedia?.(req);
        if (controller.signal.aborted) return;

        if (res?.ok && Array.isArray(res.results)) {
          setResults(res.results);
          setStatus('loaded');
          setVisibleCount(INITIAL_VISIBLE_COUNT);
        } else {
          setResults([]);
          setStatus('loaded');
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setErrorMessage(err instanceof Error ? err.message : 'Could not fetch reviews and explanations.');
          setStatus('error');
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [title, originalTitle, year, season, episode]
  );

  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus(results.length > 0 ? 'loaded' : 'idle');
  }, [results.length]);

  const handleOpenLink = useCallback((url: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    void window.cloudstream?.openExternalLink?.(url);
  }, []);

  const handleCardClick = useCallback(
    (item: RelatedMediaResult) => {
      // If it's a video and onPlayVideo is provided, open with the video player popup
      if (item.type === 'video' && onPlayVideo) {
        const isYouTube = item.source.provider.toLowerCase().includes('youtube');
        const video: TitleVideo = {
          id: item.id,
          title: item.title,
          url: item.source.url,
          kind: TitleVideoKind.Featurette,
          label: item.title,
          host: isYouTube ? 'youtube' : 'web',
          publisher: item.creator?.name || item.source.provider,
          durationSeconds: item.durationSeconds,
          publishedAt: item.publishedAt,
          thumbnailUrl: item.thumbnailUrl,
        };
        onPlayVideo(video);
      } else {
        // Open in external browser
        handleOpenLink(item.source.url);
      }
    },
    [onPlayVideo, handleOpenLink]
  );

  // Group counts by category
  const categoryCounts = useMemo(() => {
    const counts = new Map<RelatedMediaCategory, number>();
    for (const item of results) {
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    }
    return counts;
  }, [results]);

  // Filtered results based on active tab
  const filteredResults = useMemo(() => {
    if (activeCategory === 'all') return results;
    return results.filter((r) => r.category === activeCategory);
  }, [results, activeCategory]);

  const visibleResults = useMemo(() => {
    return filteredResults.slice(0, visibleCount);
  }, [filteredResults, visibleCount]);

  const hasMore = filteredResults.length > visibleCount;

  return (
    <section className="detail-facts reviews-section" aria-label="Reviews and Explanations">
      <div className="detail-facts__head-row">
        <h2 className="detail-facts__heading">
          <MessageSquare size={18} aria-hidden />
          <span>Reviews &amp; Explanations</span>
          {status === 'loaded' && results.length > 0 && (
            <span className="detail-facts__count">{filteredResults.length}</span>
          )}
        </h2>

        {status === 'loaded' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm trailer-gallery__more-btn"
            onClick={() => void handleSearch(true)}
            title="Refresh reviews and explanations"
          >
            <RotateCw size={13} />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {status === 'idle' && (
        <div className="reviews-section__invite">
          <p className="reviews-section__invite-text">
            Discover reviews, ending explanations, story breakdowns, analysis, and recaps
            publicly available across YouTube, Dailymotion, and the web.
          </p>
          <button
            type="button"
            className="btn btn-primary reviews-section__search-btn"
            onClick={() => void handleSearch(false)}
          >
            <Sparkles size={16} />
            <span>Search Reviews &amp; Explanations</span>
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="reviews-section__loading" role="status">
          <div className="reviews-section__loading-row">
            <Loader2 size={16} className="spin" />
            <span>Searching public platforms for reviews and explanations…</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleCancel}
            title="Cancel search"
          >
            <X size={14} />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="reviews-section__error" role="alert">
          <AlertCircle size={16} />
          <span>{errorMessage || 'Failed to search for reviews.'}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleSearch(false)}
          >
            <RotateCw size={13} />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {status === 'loaded' && results.length === 0 && (
        <div className="reviews-section__empty">
          <p>No related reviews, explanations, or recaps were found on public platforms.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void handleSearch(true)}
          >
            <Search size={13} />
            <span>Search Again</span>
          </button>
        </div>
      )}

      {status === 'loaded' && results.length > 0 && (
        <>
          {/* Category Filter Chips */}
          <div className="reviews-filters" role="tablist" aria-label="Review categories">
            <button
              type="button"
              role="tab"
              aria-selected={activeCategory === 'all'}
              className={`reviews-filter-btn ${activeCategory === 'all' ? 'reviews-filter-btn--active' : ''}`}
              onClick={() => {
                setActiveCategory('all');
                setVisibleCount(INITIAL_VISIBLE_COUNT);
              }}
            >
              All
              <span className="reviews-filter-count">{results.length}</span>
            </button>

            {CATEGORY_ORDER.map((cat) => {
              const count = categoryCounts.get(cat) || 0;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === cat}
                  className={`reviews-filter-btn ${activeCategory === cat ? 'reviews-filter-btn--active' : ''}`}
                  onClick={() => {
                    setActiveCategory(cat);
                    setVisibleCount(INITIAL_VISIBLE_COUNT);
                  }}
                >
                  {CATEGORY_LABELS[cat]}
                  <span className="reviews-filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Cards Grid */}
          <div className="reviews-grid">
            {visibleResults.map((item) => {
              const duration = formatVideoDuration(item.durationSeconds);
              const isVideo = item.type === 'video';

              return (
                <div
                  key={item.id}
                  className="reviews-card"
                  onClick={() => handleCardClick(item)}
                  title={item.title}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCardClick(item);
                    }
                  }}
                >
                  <div className="reviews-card__frame">
                    <Poster
                      src={item.thumbnailUrl}
                      title={item.title}
                      decorative
                      className="reviews-card__image"
                      fallback={
                        <div className="reviews-card__placeholder">
                          {isVideo ? <Film size={24} /> : <MessageSquare size={24} />}
                        </div>
                      }
                    />

                    {isVideo ? (
                      <div className="reviews-card__play" aria-hidden>
                        <Play size={18} fill="currentColor" />
                      </div>
                    ) : (
                      <div className="reviews-card__play" aria-hidden>
                        <ExternalLink size={16} />
                      </div>
                    )}

                    {duration && <span className="reviews-card__duration">{duration}</span>}
                  </div>

                  <div className="reviews-card__body">
                    <div className="reviews-card__badges">
                      <span className="reviews-card__source-badge">{item.source.provider}</span>
                      <span className={`reviews-card__cat-badge reviews-card__cat-badge--${item.category}`}>
                        {CATEGORY_LABELS[item.category] || item.category}
                      </span>
                    </div>

                    <h3 className="reviews-card__title">{item.title}</h3>

                    <div className="reviews-card__footer">
                      <span className="reviews-card__creator">
                        {item.creator?.name || item.source.provider}
                      </span>
                      {item.publishedAt && (
                        <span className="reviews-card__date">{item.publishedAt}</span>
                      )}
                      <button
                        type="button"
                        className="reviews-card__ext-btn"
                        onClick={(e) => handleOpenLink(item.source.url, e)}
                        title={`Open in browser: ${item.source.url}`}
                        aria-label="Open in external browser"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="reviews-section__more-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setVisibleCount((prev) => prev + INITIAL_VISIBLE_COUNT)}
              >
                Load more ({filteredResults.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
