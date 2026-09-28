/**
 * Searches the viewer kept, to reopen as they were.
 *
 * Each row is dated and shows a few of its posters, because what distinguishes
 * two saved searches is rarely the query alone — "dune" saved in March and
 * "dune" narrowed to one provider are different lists. Opening one draws the
 * saved rows on the search screen, which says they are saved and offers to
 * search again.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bookmark, Search, Target, Trash2 } from 'lucide-react';
import type { SavedSearchSummary } from '../../../electron/savedSearches';
import { EmptyState } from '../EmptyState';

interface Props {
  onOpen: (id: string) => void;
  /** Reports how many there are, for the tab's count. */
  onCount?: (count: number) => void;
}

function savedOn(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const SavedSearchesList: React.FC<Props> = ({ onOpen, onCount }) => {
  const [searches, setSearches] = useState<SavedSearchSummary[] | null>(null);

  const load = useCallback(async () => {
    const list = (await window.cloudstream?.listSavedSearches?.()) ?? [];
    setSearches(list);
    onCount?.(list.length);
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    const list = (await window.cloudstream?.removeSavedSearch?.(id)) ?? [];
    setSearches(list);
    onCount?.(list.length);
  };

  if (searches === null) return null;

  if (searches.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="No saved searches yet"
        description="After a search finishes, press Save results to keep the list and come back to it here."
      />
    );
  }

  return (
    <ul className="saved-searches">
      {searches.map((search) => (
        <li key={search.id} className="saved-searches__row">
          <button type="button" className="saved-searches__open" onClick={() => onOpen(search.id)}>
            <span className="saved-searches__posters" aria-hidden>
              {search.posters.length > 0 ? (
                search.posters.map((poster) => (
                  <img
                    key={poster}
                    src={poster}
                    alt=""
                    loading="lazy"
                    // Scraped artwork expires and 403s; a gap reads better than a broken-image icon.
                    onError={(event) => (event.currentTarget.style.visibility = 'hidden')}
                  />
                ))
              ) : (
                <span className="saved-searches__placeholder">
                  <Search size={18} />
                </span>
              )}
            </span>
            <span className="saved-searches__text">
              <strong>{search.query}</strong>
              <span>
                {search.resultCount} title{search.resultCount === 1 ? '' : 's'} · saved{' '}
                {savedOn(search.savedAt)}
                {search.scoped ? (
                  <span className="saved-searches__scoped" title="Searched only some sources">
                    <Target size={11} /> narrowed
                  </span>
                ) : null}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label={`Remove saved search ${search.query}`}
            title="Remove"
            onClick={() => void remove(search.id)}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
};
