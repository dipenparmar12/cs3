import { Clapperboard } from 'lucide-react';
import type { Franchise } from '../../types/metadata';
import type { SearchResponse, TvType } from '../../types/api';

/**
 * The film series this title belongs to, in release order (franchise PRD).
 *
 * Each entry opens as an ordinary Cinemeta catalogue item, so its sources are
 * found by the viewer's providers the way any catalogue title's are — the rail
 * never carries a playable address of its own.
 */
export function FranchiseRail({
  franchise,
  onSelectMedia,
}: {
  franchise: Franchise;
  onSelectMedia: (item: SearchResponse) => void;
}) {
  const currentIndex = franchise.entries.findIndex((entry) => entry.current);
  return (
    <section className="detail-facts">
      <div className="detail-facts__head-row">
        <h2 className="detail-facts__heading">
          {franchise.name}
          <span className="detail-facts__count">{franchise.entries.length}</span>
        </h2>
      </div>
      <ol className="franchise-rail">
        {franchise.entries.map((entry, index) => {
          const relation =
            currentIndex < 0 || entry.current ? null : index < currentIndex ? 'Earlier' : 'Later';
          const open = () =>
            onSelectMedia({
              name: entry.title,
              url: `cs3meta://cinemeta/movie/${entry.imdbId}`,
              apiName: 'Cinemeta',
              type: 'Movie' as TvType,
              year: entry.year,
              imdbId: entry.imdbId,
            });
          return (
            <li key={entry.imdbId}>
              <button
                type="button"
                className={`franchise-rail__item${entry.current ? ' franchise-rail__item--current' : ''}`}
                onClick={entry.current ? undefined : open}
                disabled={entry.current}
                aria-current={entry.current ? 'page' : undefined}
              >
                <span className="franchise-rail__index">
                  <Clapperboard size={13} aria-hidden="true" /> {index + 1}
                </span>
                <span className="franchise-rail__title">{entry.title}</span>
                <span className="franchise-rail__meta">
                  {entry.year ?? 'Year unknown'}
                  {entry.current ? ' · Viewing now' : relation ? ` · ${relation}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
