import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Loader2, RefreshCw } from 'lucide-react';
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
/** One page of a row, from wherever the row comes from. */
export type CategoryPageLoader<T extends HomeCategoryState> = (current: T) => Promise<{
  ok: boolean;
  items?: SearchResponse[];
  error?: string;
  /** The source's own "there is more"; absent means "keep asking until a page adds nothing". */
  hasNext?: boolean;
}>;

/**
 * `loadPage` makes the grid serve any paged row — a provider's own catalogue
 * on a streaming-service page as well as a home row. Absent, it pages the home
 * screen's discovery rows as it always has.
 */
export function CategoryGrid<T extends HomeCategoryState>({
  category,
  onChange,
  onBack,
  onOpen,
  onPlayDirectly,
  loadPage,
  backLabel = 'Home',
}: {
  category: T;
  onChange: (next: T) => void;
  onBack: () => void;
  onOpen: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  loadPage?: CategoryPageLoader<T>;
  backLabel?: string;
}): React.ReactElement {
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const viewport = containerRef.current?.closest<HTMLElement>('.view-viewport');
    if (!viewport) return;

    const handleScroll = () => {
      setScrolled(viewport.scrollTop > 30);
    };

    handleScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToTop = useCallback(() => {
    const viewport = containerRef.current?.closest<HTMLElement>('.view-viewport');
    if (viewport) {
      viewport.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const loadMore = useCallback(async () => {
    const current = latest.current;
    if (busy.current || current.done) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = loadPage
        ? await loadPage(current)
        : await window.cloudstream?.getMoreDiscovery?.(current.id, {
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
      const hasNext = 'hasNext' in response ? response.hasNext : undefined;
      onChange({
        ...current,
        items: merged.items,
        skip: current.skip + page.length,
        page: current.page + 1,
        done: merged.added === 0 || hasNext === false,
      });
    } catch (err) {
      if (mounted.current) setError(describeError(err));
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [onChange, loadPage]);

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
    <div className="category-page" ref={containerRef}>
      <header className={`category-page__head${scrolled ? ' category-page__head--scrolled' : ''}`}>
        <div className="category-page__head-start">
          <button
            type="button"
            className="category-page__back"
            onClick={onBack}
            title={`Back to ${backLabel}`}
          >
            <ArrowLeft size={16} aria-hidden />
            <span>{backLabel}</span>
          </button>
          <div className="category-page__title">
            <h2>{category.title}</h2>
            {category.subtitle && <p>{category.subtitle}</p>}
          </div>
        </div>

        <div className="category-page__head-end">
          <span className="category-page__count">
            {category.items.length} title{category.items.length === 1 ? '' : 's'}
          </span>
          {scrolled && (
            <button
              type="button"
              className="category-page__top-btn"
              onClick={scrollToTop}
              title="Scroll to top"
              aria-label="Scroll to top"
            >
              <ArrowUp size={13} aria-hidden />
              <span>Top</span>
            </button>
          )}
        </div>
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
}
