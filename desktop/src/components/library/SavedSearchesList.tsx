/**
 * Searches the viewer kept, to reopen as they were.
 *
 * Each row is dated and shows a few of its posters, because what distinguishes
 * two saved searches is rarely the query alone — "dune" saved in March and
 * "dune" narrowed to one provider are different lists. Opening one draws the
 * saved rows on the search screen, which says they are saved and offers to
 * search again.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Search, Target, Trash2 } from 'lucide-react';
import type { SavedSearchSummary } from '../../../electron/savedSearches';
import { EmptyState } from '../EmptyState';
import { ScreenSearchNoMatches } from '../ScreenSearch';
import { matchesScreenQuery } from '../../utils/screenSearch';
import { useAdultMode } from '../../utils/useAdultMode';
import { isSensitiveTitle } from '../../utils/adultContent';

interface Props {
  onOpen: (id: string) => void;
  /** Reports how many there are, for the tab's count. */
  onCount?: (count: number) => void;
  /** The Library's find query; narrows the list without fetching anything. */
  query?: string;
  /** Reports how many the query leaves, for the find field's count. */
  onMatches?: (count: number) => void;
  onClearQuery?: () => void;
}

function savedOn(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const SavedSearchesList: React.FC<Props> = ({ onOpen, onCount, query = '', onMatches, onClearQuery }) => {
  const [searches, setSearches] = useState<SavedSearchSummary[] | null>(null);
  const adult = useAdultMode();
  const visibleSearches = useMemo(
    () => (adult.allowed ? searches : searches?.filter((s) => !isSensitiveTitle(s.query)) ?? null),
    [searches, adult.allowed]
  );
  const shown = useMemo(
    () => visibleSearches?.filter((search) => matchesScreenQuery(query, [search.query])) ?? [],
    [visibleSearches, query]
  );

  useEffect(() => {
    if (visibleSearches !== null) {
      onCount?.(visibleSearches.length);
      onMatches?.(shown.length);
    }
  }, [visibleSearches, shown.length, onCount, onMatches]);

  const load = useCallback(async () => {
    const list = (await window.cloudstream?.listSavedSearches?.()) ?? [];
    setSearches(list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    const list = (await window.cloudstream?.removeSavedSearch?.(id)) ?? [];
    setSearches(list);
  };

  if (visibleSearches === null) return null;

  if (visibleSearches.length === 0) {
    return (
      <EmptyState
        icon={Bookmark}
        title="No saved searches yet"
        description="After a search finishes, press Save results to keep the list and come back to it here."
      />
    );
  }

  if (shown.length === 0) {
    return <ScreenSearchNoMatches query={query} where="saved searches" onClear={() => onClearQuery?.()} />;
  }

  return (
    <ul className="saved-searches">
      {shown.map((search) => {
        const sensitive = isSensitiveTitle(search.query);
        return (
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
                    className={sensitive && adult.blurred ? 'cs-poster--blurred' : undefined}
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
        );
      })}
    </ul>
  );
};
