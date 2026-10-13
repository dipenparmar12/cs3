import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { SearchResponse } from '../../types/api';
import { RAIL_LIMIT } from '../../utils/homeRows';

/**
 * One home row: a heading, a rail of its first few titles, and "Show all".
 *
 * ## Drawn only when it is about to be seen
 *
 * The home screen rendered every poster of every row at once — 834 cards on a
 * real install, most of them five screens down. A row far from the viewport
 * now holds a placeholder of the same height and draws its posters once it is
 * within about a screen of being scrolled to, so the page lays out at its full
 * length from the start and costs only what is on screen.
 *
 * ## "Show all" rather than an endless rail
 *
 * A rail is for scanning; nobody pages through a hundred posters sideways.
 * The rail stops at {@link RAIL_LIMIT} and the row opens as a grid that keeps
 * loading as it is scrolled.
 */
export const HomeRow: React.FC<{
  title: string;
  subtitle?: string;
  refreshing?: boolean;
  items: SearchResponse[];
  /** Whether the row has more than the rail shows, here or behind a next page. */
  hasMore: boolean;
  onShowAll: () => void;
  renderCard: (item: SearchResponse, index: number) => React.ReactNode;
}> = ({ title, subtitle, refreshing, items, hasMore, onShowAll, renderCard }) => {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '700px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  const shown = items.slice(0, RAIL_LIMIT);
  const more = hasMore || items.length > shown.length;

  return (
    <section className="home-row" ref={ref}>
      <header>
        <h3>{title}</h3>
        {subtitle && <span className="home-row__subtitle">{subtitle}</span>}
        {refreshing && <Loader2 size={12} className="spin" />}
        {more && (
          <button type="button" className="home-row__more" onClick={onShowAll}>
            Show all <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </header>
      {near ? (
        <div className="home-rail">
          {shown.map(renderCard)}
          {more && (
            <button
              type="button"
              className="home-rail__all"
              onClick={onShowAll}
              aria-label={`Show all of ${title}`}
            >
              <span>Show all</span>
              <ChevronRight size={20} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <div className="home-rail home-rail--pending" aria-hidden />
      )}
    </section>
  );
};
