import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Bug, Loader2 } from 'lucide-react';
import { SearchScopePicker } from './SearchScopePicker';
import type {
  ExactMedia,
  SearchHistoryEntry,
  SearchOptions,
  SearchSuggestion,
} from '../types/api';
import { SearchSuggestions } from './SearchSuggestions';

interface NavbarProps {
  onSearch: (query: string, options?: SearchOptions) => void;
  isSearching?: boolean;
  /** Fired when the scope picker closes having changed the scope. */
  onScopeChange?: () => void;
  onOpenInspector: () => void;
  /**
   * The query the app believes is running, when it was not typed here.
   *
   * The box used to hold its own text and nothing else, so a search started
   * anywhere else left it showing the previous one: pressing "Search title" on
   * *Avengers: Age of Ultron* ran the right search and the bar still read
   * "Avengers". The results were right and the one visible statement of what
   * had been asked was wrong — which is worse than either alone, because it is
   * the thing a user checks when the results surprise them.
   *
   * Not fully controlled: typing must stay local so every keystroke does not
   * re-render the app. This is the app *telling* the box what it just ran.
   */
  externalQuery?: string;
}

/** Long enough that typing a word costs one request, short enough to feel live. */
const SUGGEST_DEBOUNCE_MS = 250;

export const Navbar: React.FC<NavbarProps> = ({
  onSearch,
  isSearching = false,
  onScopeChange,
  onOpenInspector,
  externalQuery,
}) => {
  const [query, setQuery] = useState('');

  /**
   * Adopts a query the app started elsewhere.
   *
   * Guarded on the previous *external* value rather than on `query`, so a user
   * who edits the box after such a search keeps their edit — re-syncing on
   * every render would fight their typing.
   */
  const lastExternal = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (externalQuery === undefined) return;
    if (externalQuery === lastExternal.current) return;
    lastExternal.current = externalQuery;
    setQuery(externalQuery);
  }, [externalQuery]);

  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refreshHistory = useCallback(() => {
    window.cloudstream?.getSearchHistory().then(setHistory);
  }, []);

  useEffect(() => refreshHistory(), [refreshHistory]);

  /**
   * Fetches suggestions for the current query, debounced.
   *
   * The request counter is what keeps the dropdown honest: catalogues answer
   * out of order, and a slow reply for "spid" landing after a fast one for
   * "spider man" would otherwise replace the right list with a stale one.
   */
  const requestId = useRef(0);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const id = ++requestId.current;
    setSuggestLoading(true);

    const timer = window.setTimeout(async () => {
      const response = await window.cloudstream?.suggestTitles(trimmed);
      if (id !== requestId.current) return;
      setSuggestions(response?.suggestions ?? []);
      setSuggestLoading(false);
    }, SUGGEST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  // A fresh query means the previous highlight points at a different row.
  useEffect(() => setHighlightedIndex(-1), [query]);

  const runSearch = useCallback(
    (text: string, exact?: ExactMedia) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQuery(trimmed);
      setSuggestOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      onSearch(trimmed, exact ? { exact } : undefined);
      /**
       * Re-read on the next tick, not after a guessed delay.
       *
       * This used to wait 300 ms and hope the main process had recorded the
       * query by then. Once searches became streaming that stopped being true —
       * recording happened on completion, seconds later — so the list the user
       * opened was always missing the search they had just run, which looks
       * exactly like the order being wrong. The query is now recorded when the
       * search opens, so this only has to outlast the IPC round trip.
       */
      window.setTimeout(refreshHistory, 0);
    },
    [onSearch, refreshHistory]
  );

  // The result counts arrive when each search finishes.
  useEffect(() => {
    const dispose = window.cloudstream?.onSearchUpdate?.((snapshot) => {
      if (snapshot.done) refreshHistory();
    });
    return () => dispose?.();
  }, [refreshHistory]);

  /**
   * Picking a row is a choice of *work*, not a shortcut for typing its name.
   *
   * Searching the suggestion's title text put the franchise straight back:
   * choosing "Spider-Man: No Way Home" returned every Spider-Man film, so the
   * pick achieved nothing beyond fixing a typo. The identity travels with the
   * query instead, and the results honour it.
   */
  const pickSuggestion = useCallback(
    (suggestion: SearchSuggestion) => {
      runSearch(suggestion.title, {
        title: suggestion.title,
        year: suggestion.year,
        type: suggestion.type,
        imdbId: suggestion.imdbId,
        url: suggestion.url,
        posterUrl: suggestion.posterUrl,
      });
    },
    [runSearch]
  );

  const historyFirst = query.trim().length < 2;
  const orderedRows: Array<{ kind: 'suggestion' | 'history'; index: number }> = historyFirst
    ? [
        ...history.map((_, index) => ({ kind: 'history' as const, index })),
        ...suggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
      ]
    : [
        ...suggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
        ...history.map((_, index) => ({ kind: 'history' as const, index })),
      ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setSuggestOpen(false);
      setHighlightedIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (orderedRows.length === 0) return;
      e.preventDefault();
      setSuggestOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((current) => {
        const next = current + step;
        if (next < 0) return orderedRows.length - 1;
        if (next >= orderedRows.length) return -1;
        return next;
      });
      return;
    }

    if (e.key === 'Enter') {
      const row = orderedRows[highlightedIndex];
      if (row) {
        // Enter on a highlighted row is the same commitment as clicking it, so
        // it carries the same identity rather than degrading to a text search.
        if (row.kind === 'suggestion') pickSuggestion(suggestions[row.index]);
        else runSearch(history[row.index].query);
        return;
      }
      runSearch(query);
    }
  };

  return (
    <header className="navbar">
      {/* Search Input Bar */}
      <div className="search-bar">
        {isSearching ? (
          <Loader2 size={18} className="search-icon spin" style={{ color: 'var(--accent-light)' }} />
        ) : (
          <Search size={18} className="search-icon" />
        )}
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          placeholder="Search movies, anime, TV shows across providers or paste URL..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setSuggestOpen(true);
            refreshHistory();
          }}
          onBlur={() => setSuggestOpen(false)}
          role="combobox"
          aria-expanded={suggestOpen}
          aria-autocomplete="list"
        />
        <button
          onClick={() => runSearch(query)}
          disabled={isSearching}
          className="btn btn-primary"
          style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          {isSearching ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
          <span>{isSearching ? 'Searching…' : 'Search'}</span>
        </button>

        <SearchSuggestions
          open={suggestOpen}
          query={query}
          suggestions={suggestions}
          history={history}
          loading={suggestLoading}
          highlightedIndex={highlightedIndex}
          onHighlight={setHighlightedIndex}
          onPickSuggestion={pickSuggestion}
          onPickHistory={(entry) => runSearch(entry.query)}
          onRemoveHistory={(value) => {
            window.cloudstream?.removeSearchHistory(value).then(setHistory);
          }}
          onClearHistory={() => {
            window.cloudstream?.clearSearchHistory().then(setHistory);
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
        <SearchScopePicker onScopeChange={onScopeChange} />

        {/* F12 Provider Inspector Button */}
        <button
          onClick={onOpenInspector}
          className="btn btn-secondary btn-icon"
          title="F12 - Open Provider Inspector & Debugger"
        >
          <Bug size={16} />
        </button>
      </div>
    </header>
  );
};
