import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Paperclip, Eye, EyeOff, X, Square, Trash2, VenetianMask, Code2 } from 'lucide-react';
import { usePrivacy } from '../utils/usePrivacy';
import { isAdultMedia, isSensitiveTitle } from '../utils/adultContent';
import { EMERGENCY_BLUR_KEY_LABEL } from '../utils/emergencyBlur';
import { setAdultVisualBlurred, useAdultMode } from '../utils/useAdultMode';
import { useIsDeveloper } from '../utils/ExperienceModeContext';
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
import { ProfileMenu } from './profiles/ProfileMenu';
import { Button } from './ui';

interface NavbarProps {
  onSearch: (query: string, options?: SearchOptions) => void;
  /** Stops the active search fan-out. */
  onCancelSearch?: () => void;
  /** Fired when the query is cleared via the clear button or Esc. */
  onClearSearch?: () => void;
  /** Clears active search results from screen. */
  onClearResults?: () => void;
  /** Whether search results are currently active on screen. */
  hasSearchResults?: boolean;
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
  onOpenInspector?: () => void;
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
  /** Whether the current screen is a content-browsing context where the adult blur toggle is relevant. */
  contentContext?: boolean;
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
  onClearResults,
  hasSearchResults = false,
  onTorrentPicked,
  onTorrentPickFailed,
  isSearching = false,
  onScopeChange,
  onOpenInspector,
  externalQuery,
  onOpenSavedSearch,
  contentContext = true,
}) => {
  const isDeveloper = useIsDeveloper();
  const [query, setQuery] = useState('');
  const { active: incognito, setActive: setIncognito } = usePrivacy();
  const adult = useAdultMode();
  const [showTorrentAttachment, setShowTorrentAttachment] = useState(false);

  useEffect(() => {
    const update = () => {
      window.cloudstream
        ?.getSetting('show_torrent_attachment', 'false')
        .then((val) => setShowTorrentAttachment(val === 'true'));
    };
    update();
    const handleSettingsChanged = (e: Event) => {
      const custom = e as CustomEvent<{ key?: string; value?: unknown }>;
      if (!custom.detail || custom.detail.key === 'show_torrent_attachment') {
        update();
      }
    };
    window.addEventListener('cs3:settings-changed', handleSettingsChanged);
    return () => window.removeEventListener('cs3:settings-changed', handleSettingsChanged);
  }, []);

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

  useEffect(() => {
    const handleFocusSearch = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('cs3:focus-navbar-search', handleFocusSearch);
    return () => window.removeEventListener('cs3:focus-navbar-search', handleFocusSearch);
  }, []);

  const mergedHistory = useMemo(() => {
    const list = mergeHistoryAndSaved(history, saved);
    if (adult.allowed) return list;
    return list.filter((entry) => !isSensitiveTitle(entry.query));
  }, [history, saved, adult.allowed]);

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

  const visibleSuggestions = useMemo(() => {
    if (adult.allowed) return suggestions;
    return suggestions.filter(
      (s) =>
        !isAdultMedia(
          {
            adult: s.adult,
            title: s.title,
            originalTitle: s.originalTitle,
            type: s.type,
            genres: s.genres,
            plot: s.plot,
            sources: s.sources,
          },
          adult.adultProviders
        )
    );
  }, [suggestions, adult.allowed, adult.adultProviders]);

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
        ...visibleSuggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
      ]
    : [
        ...visibleSuggestions.map((_, index) => ({ kind: 'suggestion' as const, index })),
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
          pickSuggestion(visibleSuggestions[row.index]);
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

  const showAdultBlurControl =
    adult.allowed &&
    contentContext &&
    (adult.visibleAdultCount > 0 || !adult.blurred || adult.adultProviders.size > 0);

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
          placeholder={incognito ? "Search — incognito, searches aren't saved" : 'Search titles, or paste a link'}
          aria-label="Search movies, shows and anime"
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

        {showTorrentAttachment && !query.trim() && !isSearching && (
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
        )}

        {hasSearchResults && onClearResults && !isSearching && (
          <Button
            size="compact"
            variant="ambient"
            icon={Trash2}
            onClick={onClearResults}
            className="search-bar__clear-results-btn"
            title="Clear these results"
          >
            Clear
          </Button>
        )}

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
          <Button size="compact" variant="prominent" icon={Search} onClick={() => runSearch(query)}>
            Search
          </Button>
        )}

        <SearchSuggestions
          open={suggestOpen}
          query={query}
          suggestions={visibleSuggestions}
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

      {/* Right-side navigation controls */}
      <div className="navbar__actions">
        {/* Source Scope Selector */}
        <SearchScopePicker onScopeChange={onScopeChange} />

        {/* Subtle divider between search-scoping and session/profile controls */}
        <div className="navbar__divider" aria-hidden="true" />

        {/* Contextual Adult Content Blur / Privacy toggle */}
        {showAdultBlurControl && (
          <button
            type="button"
            onClick={() => void setAdultVisualBlurred(!adult.blurred)}
            className={`btn navbar-adult-blur-btn${
              adult.blurred ? ' navbar-adult-blur-btn--blurred' : ' navbar-adult-blur-btn--revealed'
            }`}
            aria-pressed={!adult.blurred}
            title={
              adult.blurred
                ? `Adult content posters are blurred for privacy. Click to unblur for this session (or press ${EMERGENCY_BLUR_KEY_LABEL} anywhere).`
                : `Adult content posters are visible for this session. Click to blur them immediately (or press ${EMERGENCY_BLUR_KEY_LABEL} anywhere).`
            }
          >
            {adult.blurred ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>{adult.blurred ? 'Unblur' : 'Blur'}</span>
          </button>
        )}

        {/* Incognito mode toggle */}
        <button
          type="button"
          onClick={() => setIncognito(!incognito)}
          className={`btn navbar__incognito${incognito ? ' navbar__incognito--on' : ' btn-secondary'}`}
          aria-pressed={incognito}
          title={
            incognito
              ? 'Incognito is active (Ctrl+Shift+N) — history, progress and searches aren’t saved. Click to exit'
              : 'Incognito mode (Ctrl+Shift+N) — browse without saving history or searches'
          }
          aria-label={incognito ? 'Leave incognito' : 'Go incognito'}
        >
          <VenetianMask size={16} className="navbar__incognito-icon" />
          {incognito && <span className="navbar__incognito-dot" aria-hidden />}
          <span className="navbar__incognito-label">Incognito</span>
        </button>

        {/* Developer UI Inspector trigger (developer mode only) */}
        {isDeveloper && onOpenInspector && (
          <button
            type="button"
            onClick={onOpenInspector}
            className="btn btn-secondary navbar-control-btn navbar-inspector-btn"
            title="Open Developer Inspector Drawer"
            aria-label="Open Developer Inspector"
          >
            <Code2 size={15} />
          </button>
        )}

        {/* Viewer Profile switcher & settings */}
        <ProfileMenu />
      </div>
    </header>
  );
};
