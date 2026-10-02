import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Bug, Loader2, Paperclip, EyeOff, X, Square } from 'lucide-react';
import { usePrivacy } from '../utils/usePrivacy';
import { DeveloperOnly } from '../utils/ExperienceModeContext';
import { SearchScopePicker } from './SearchScopePicker';
import type {
  ExactMedia,
  SearchHistoryEntry,
  SearchOptions,
  SearchSuggestion,
} from '../types/api';
import { SearchSuggestions } from './SearchSuggestions';
import type { SavedSearchSummary } from '../../electron/savedSearches';
import { mergeHistoryAndSaved } from '../utils/searchHistoryMerge';

interface NavbarProps {
  onSearch: (query: string, options?: SearchOptions) => void;
  /** Stops the active search fan-out. */
  onCancelSearch?: () => void;
  /** Fired when the query is cleared via the clear button or Esc. */
  onClearSearch?: () => void;
  /**
   * A torrent was picked from disk, so the app can open its page.
   *
   * The Navbar runs the dialog rather than the parent, because the control
   * lives here and a press that has to travel up before it can open a file
   * would show its spinner in the wrong place.
   */
  onTorrentPicked?: (infoHash: string) => void;
  /** A picked file that could not be read, said where the press happened. */
  onTorrentPickFailed?: (message: string) => void;
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
  /** Reopens a search kept with Save results. */
  onOpenSavedSearch?: (id: string) => void;
}

/**
 * Long enough to coalesce a burst of keystrokes, short enough to feel live.
 *
 * Was 250 ms, chosen when the main process answered a whole fan-out per call
 * and every request was worth suppressing. Two things changed underneath it:
 * the reply is now answered from cache with no I/O, and a superseded fan-out is
 * aborted rather than run to completion. So the debounce no longer has to pay
 * for itself in avoided requests, and 250 ms of deliberate stillness at the
 * front of a 300–900 ms round trip is a third of the delay this work exists to
 * remove.
 */
const SUGGEST_DEBOUNCE_MS = 110;

/**
 * Below this the box shows history rather than titles.
 *
 * One character is enough to ask — the brief asks for rows after the first one
 * or two — and the main process narrows a single-character query to Cinemeta
 * alone rather than fanning out three ways for a list nothing can rank.
 */
const SUGGEST_MIN_LENGTH = 1;

export const Navbar: React.FC<NavbarProps> = ({
  onSearch,
  onCancelSearch,
  onClearSearch,
  onTorrentPicked,
  onTorrentPickFailed,
  isSearching = false,
  onScopeChange,
  onOpenInspector,
  externalQuery,
  onOpenSavedSearch,
}) => {
  const [query, setQuery] = useState('');
  const { active: incognito, setActive: setIncognito } = usePrivacy();

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

  const [saved, setSaved] = useState<SavedSearchSummary[]>([]);

  const refreshHistory = useCallback(() => {
    window.cloudstream?.getSearchHistory().then(setHistory);
    window.cloudstream?.listSavedSearches?.().then((list) => setSaved(list ?? []));
  }, []);

  useEffect(() => refreshHistory(), [refreshHistory]);

  const mergedHistory = useMemo(() => {
    return mergeHistoryAndSaved(history, saved);
  }, [history, saved]);

  const trimmedQuery = query.trim();
  const displayHistory = useMemo(() => {
    if (!trimmedQuery) {
      return mergedHistory.slice(0, 15);
    }
    const lower = trimmedQuery.toLowerCase();
    return mergedHistory
      .filter((entry) => entry.query.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [mergedHistory, trimmedQuery]);

  /**
   * Fetches suggestions for the current query, debounced.
   *
   * The request counter is what keeps the dropdown honest: catalogues answer
   * out of order, and a slow reply for "spid" landing after a fast one for
   * "spider man" would otherwise replace the right list with a stale one.
   */
  const requestId = useRef(0);
  /**
   * The query the rows on screen belong to.
   *
   * A ref rather than state because the push listener below is mounted once and
   * must read the *current* query without being torn down and rebuilt on every
   * keystroke — the same arrangement `DetailView` uses for late metadata.
   */
  const activeQuery = useRef('');

  useEffect(() => {
    const trimmed = query.trim();
    activeQuery.current = trimmed;

    if (trimmed.length < SUGGEST_MIN_LENGTH) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    const id = ++requestId.current;

    const timer = window.setTimeout(async () => {
      const response = await window.cloudstream?.suggestTitles(trimmed);
      if (id !== requestId.current) return;

      /**
       * Rows are only ever *replaced*, never blanked while more are coming.
       *
       * The reply is the instant answer — this query's cached rows, or a
       * shorter query's re-filtered — and for a query nothing has seen before
       * it is legitimately empty. Clearing the list on that would make the
       * dropdown flash empty between every word, so the previous rows stay put
       * until the catalogues answer with better ones.
       */
      if (response?.suggestions?.length) setSuggestions(response.suggestions);
      // Only claim to be finished when the main process says it is. An empty
      // instant answer with `done: false` is work in progress, not a result.
      setSuggestLoading(!response?.done);
    }, SUGGEST_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query]);

  /**
   * Catalogues landing behind the instant answer.
   *
   * Mounted once. The guard is on the query rather than on a request id because
   * the fan-out lives in the main process and outlives this effect's closure —
   * exactly the guard `metadata:extendedUpdate` needs, for the same reason.
   */
  useEffect(() => {
    const dispose = window.cloudstream?.onSuggestionUpdate?.((update) => {
      if (update.query !== activeQuery.current) return;
      setSuggestions(update.suggestions);
      if (update.done) setSuggestLoading(false);
    });
    return () => dispose?.();
  }, []);

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

  const historyFirst = query.trim().length < SUGGEST_MIN_LENGTH;
  const orderedRows: Array<{ kind: 'suggestion' | 'history'; index: number }> = historyFirst
    ? [
        ...displayHistory.map((_, index) => ({ kind: 'history' as const, index })),
        ...suggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
      ]
    : [
        ...suggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
        ...displayHistory.map((_, index) => ({ kind: 'history' as const, index })),
      ];

  const handleClear = useCallback(() => {
    setQuery('');
    lastExternal.current = '';
    setSuggestOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
    onClearSearch?.();
    if (isSearching) {
      onCancelSearch?.();
    }
  }, [isSearching, onClearSearch, onCancelSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (suggestOpen) {
        setSuggestOpen(false);
        setHighlightedIndex(-1);
      } else if (query) {
        handleClear();
      } else if (isSearching) {
        onCancelSearch?.();
      }
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
        if (row.kind === 'suggestion') {
          pickSuggestion(suggestions[row.index]);
        } else {
          const entry = displayHistory[row.index];
          if (entry?.isSaved && entry.savedId && onOpenSavedSearch) {
            setSuggestOpen(false);
            onOpenSavedSearch(entry.savedId);
          } else if (entry) {
            runSearch(entry.query);
          }
        }
        return;
      }
      runSearch(query);
    }
  };

  const [picking, setPicking] = useState(false);

  const pickTorrent = useCallback(async () => {
    setPicking(true);
    try {
      const result = await window.cloudstream?.pickTorrentFiles?.();
      // A cancelled dialog is not a failure and must not report one.
      if (result?.cancelled) return;
      if (!result?.ok) {
        onTorrentPickFailed?.(result?.error ?? 'That file could not be opened.');
        return;
      }
      const opened = (result.results ?? []).filter((row) => row.ok && row.infoHash);
      if (opened.length === 0) {
        onTorrentPickFailed?.(
          (result.results ?? [])[0]?.error ?? 'That was not a readable .torrent file.'
        );
        return;
      }
      // The last one opened wins the page; the rest are imported and reachable.
      onTorrentPicked?.(opened[opened.length - 1].infoHash!);
    } finally {
      setPicking(false);
    }
  }, [onTorrentPicked, onTorrentPickFailed]);

  return (
    <header className={`navbar${incognito ? ' navbar--incognito' : ''}`}>
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
          placeholder={
            incognito
              ? "Incognito: searches aren't saved. Search movies, anime, TV shows…"
              : 'Search movies, anime, TV shows across providers or paste URL...'
          }
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

        {query.length > 0 && (
          <button
            type="button"
            onMouseDown={(e) => {
              // Keep focus on the input so typing or clearing feels instant
              e.preventDefault();
            }}
            onClick={handleClear}
            className="search-bar__clear"
            title="Clear search (Esc)"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        )}

        {/*
          The other way in.
          
          Drag-and-drop is a gesture plenty of people never use — it is awkward
          on a trackpad and invisible if nobody has told you it exists. This is
          the same import behind a control that looks like one, next to the box
          where somebody is already looking for something to watch.
        */}
        <button
          type="button"
          onClick={() => void pickTorrent()}
          disabled={picking}
          className="search-bar__attach"
          title="Open a .torrent file"
          aria-label="Open a torrent file"
        >
          {picking ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} />}
        </button>

        {isSearching ? (
          <button
            type="button"
            onClick={onCancelSearch}
            className="btn search-bar__stop-btn"
            title="Stop searching"
            aria-label="Stop search"
          >
            <Square size={11} fill="currentColor" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => runSearch(query)}
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            title="Search"
            aria-label="Search"
          >
            <Search size={14} />
            <span>Search</span>
          </button>
        )}

        <SearchSuggestions
          open={suggestOpen}
          query={query}
          suggestions={suggestions}
          history={displayHistory}
          loading={suggestLoading}
          highlightedIndex={highlightedIndex}
          onHighlight={setHighlightedIndex}
          onPickSuggestion={pickSuggestion}
          onPickHistory={(entry) => {
            if (entry.isSaved && entry.savedId && onOpenSavedSearch) {
              setSuggestOpen(false);
              onOpenSavedSearch(entry.savedId);
            } else {
              runSearch(entry.query);
            }
          }}
          onRunFreshSearch={(text) => runSearch(text)}
          onRemoveHistory={async (entry) => {
            if (entry.savedId) {
              await window.cloudstream?.removeSavedSearch?.(entry.savedId);
            }
            const nextHistory = await window.cloudstream?.removeSearchHistory(entry.query);
            setHistory(nextHistory ?? []);
            const nextSaved = await window.cloudstream?.listSavedSearches?.();
            setSaved(nextSaved ?? []);
          }}
          onClearHistory={async () => {
            await window.cloudstream?.clearSearchHistory();
            const savedList = await window.cloudstream?.listSavedSearches?.();
            if (savedList && savedList.length > 0) {
              for (const item of savedList) {
                await window.cloudstream?.removeSavedSearch?.(item.id);
              }
            }
            setHistory([]);
            setSaved([]);
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
        <SearchScopePicker onScopeChange={onScopeChange} />

        <button
          type="button"
          onClick={() => setIncognito(!incognito)}
          className={`btn btn-icon navbar__incognito${incognito ? ' navbar__incognito--on' : ' btn-secondary'}`}
          aria-pressed={incognito}
          title={
            incognito
              ? "Incognito: activity isn't being saved. Bookmarks and downloads you choose are still kept. (Ctrl+Shift+N to leave)"
              : 'Incognito (Ctrl+Shift+N): stop saving history, progress and searches for this session'
          }
        >
          <EyeOff size={16} />
          {incognito && <span>Incognito</span>}
        </button>

        {/*
          The inspector is a debugger, and a bug icon in the main toolbar is the
          single clearest signal that this is a developer tool rather than a
          place to watch films. It is in developer mode only; F12 opens it there
          too, and that shortcut is gated with it so the two cannot disagree.
        */}
        <DeveloperOnly>
          <button
            onClick={onOpenInspector}
            className="btn btn-secondary btn-icon"
            title="F12 — provider inspector"
          >
            <Bug size={16} />
          </button>
        </DeveloperOnly>
      </div>
    </header>
  );
};
