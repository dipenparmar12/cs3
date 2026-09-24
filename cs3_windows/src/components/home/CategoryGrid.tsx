import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import type { SearchResponse } from '../../types/api';
import type { HomeCategoryState } from '../../views/homeCategoryState';
import { PosterCard } from '../PosterCard';
import { useTitleInteractions } from '../useTitleInteractions';
import { mergePage } from '../../utils/homeRows';
import { describeError } from '../../utils/errors';

/**
 * One home row, all of it, loading the next page as it is scrolled.
 *
 * A row used to be its first page and nothing else — `discover:more` existed
 * with no caller. Scrolling near the end asks for the next page and appends it;
 * a page that adds nothing new is the end of the row, and the grid says so
 * rather than leaving a spinner that never resolves.
 *
 * The state is the caller's (see `homeCategoryState.ts`), so a title opened
 * from here and closed again comes back to the same place in the same grid.
 */
export const CategoryGrid: React.FC<{
  category: HomeCategoryState;
  onChange: (next: HomeCategoryState) => void;
  onBack: () => void;
  onOpen: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
}> = ({ category, onChange, onBack, onOpen, onPlayDirectly }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // The observer outlives renders; a page that lands is appended to the state
  // as it is now, not as it was when the observer was installed.
  const latest = useRef(category);
  latest.current = category;
  const busy = useRef(false);
  // A page landing after Back must not reopen the grid it came from.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    const current = latest.current;
    if (busy.current || current.done) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await window.cloudstream?.getMoreDiscovery?.(current.id, {
        skip: current.skip,
        page: current.page + 1,
      });
      // Left, or moved to another row, while the page was in flight.
      if (!mounted.current || latest.current.id !== current.id) return;
      if (!response?.ok) {
        setError(response?.error ?? 'More titles could not be loaded.');
        return;
      }
      const page = response.items ?? [];
      const merged = mergePage(current.items, page);
      onChange({
        ...current,
        items: merged.items,
        skip: current.skip + page.length,
        page: current.page + 1,
        done: merged.added === 0,
      });
    } catch (err) {
      if (mounted.current) setError(describeError(err));
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [onChange]);

  /*
   * Re-observed whenever the grid grows. An observer reports a change of
   * state, so a page too short to push the sentinel off screen would otherwise
   * leave it "still intersecting" with nothing to say — and the grid would
   * stop one page in. A fresh observer reports where the sentinel is now.
   */
  useEffect(() => {
    const node = sentinel.current;
    if (!node || category.done || error) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '900px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, category.done, category.id, category.items.length, error]);

  const { interactionFor } = useTitleInteractions(category.items);

  return (
    <div className="category-page">
      <header className="category-page__head">
        <button type="button" className="category-page__back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden /> Home
        </button>
        <div className="category-page__title">
          <h2>{category.title}</h2>
          {category.subtitle && <p>{category.subtitle}</p>}
        </div>
        <span className="category-page__count">
          {category.items.length} title{category.items.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="poster-grid">
        {category.items.map((item, index) => (
          <PosterCard
            key={`${item.url}-${index}`}
            item={item}
            onSelectMedia={onOpen}
            onPlayDirectly={item.url.startsWith('search://') ? undefined : onPlayDirectly}
            interaction={interactionFor(item)}
          />
        ))}
      </div>

      <div ref={sentinel} className="category-page__end" role="status">
        {loading ? (
          <>
            <Loader2 size={16} className="spin" aria-hidden /> Loading more…
          </>
        ) : error ? (
          <>
            <span>{error}</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void loadMore()}>
              <RefreshCw size={12} aria-hidden /> Try again
            </button>
          </>
        ) : category.done ? (
          <span>That is everything in this row.</span>
        ) : null}
      </div>
    </div>
  );
};
