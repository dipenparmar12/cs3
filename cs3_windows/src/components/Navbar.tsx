import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Bug, Check, ChevronDown, Filter, Loader2 } from 'lucide-react';
import type { SearchHistoryEntry, SearchSuggestion } from '../types/api';
import { SearchSuggestions } from './SearchSuggestions';

interface NavbarProps {
  onSearch: (query: string, selectedProviders?: string[]) => void;
  isSearching?: boolean;
  onOpenInspector: () => void;
  providers: string[];
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;
}

/** Long enough that typing a word costs one request, short enough to feel live. */
const SUGGEST_DEBOUNCE_MS = 250;

export const Navbar: React.FC<NavbarProps> = ({
  onSearch,
  isSearching = false,
  onOpenInspector,
  providers,
}) => {
  const [query, setQuery] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>(['All']);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQuery(trimmed);
      setSuggestOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.blur();
      onSearch(trimmed, selectedProviders);
      // The main process records history as part of the search, so re-reading
      // it afterwards is what keeps the list current without a second source.
      window.setTimeout(refreshHistory, 300);
    },
    [onSearch, selectedProviders, refreshHistory]
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
        // Searching the catalogue's official spelling is the whole point: it is
        // what indexers actually carry, and what the user probably mistyped.
        runSearch(
          row.kind === 'suggestion'
            ? suggestions[row.index].title
            : history[row.index].query
        );
        return;
      }
      runSearch(query);
    }
  };

  const handleToggleProvider = (p: string) => {
    if (p === 'All') {
      setSelectedProviders(['All']);
      return;
    }

    let updated = selectedProviders.filter((item) => item !== 'All');
    if (updated.includes(p)) {
      updated = updated.filter((item) => item !== p);
    } else {
      updated.push(p);
    }

    if (updated.length === 0) {
      updated = ['All'];
    }

    setSelectedProviders(updated);
  };

  const getDisplayText = (): string => {
    if (selectedProviders.includes('All') || selectedProviders.length === 0) {
      return 'All Providers';
    }
    if (selectedProviders.length === 1) {
      return selectedProviders[0];
    }
    return `${selectedProviders.length} Providers Selected`;
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
          onPickSuggestion={(suggestion) => runSearch(suggestion.title)}
          onPickHistory={(entry) => runSearch(entry.query)}
          onRemoveHistory={(value) => {
            window.cloudstream?.removeSearchHistory(value).then(setHistory);
          }}
          onClearHistory={() => {
            window.cloudstream?.clearSearchHistory().then(setHistory);
          }}
        />
      </div>

      {/* Right Controls: Layer 1 Multi-Select Provider Dropdown & Inspector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
        {/* Multi-Select Provider Selector Trigger Pill */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="btn btn-secondary"
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              borderColor: selectedProviders.includes('All') ? 'var(--border-color)' : 'var(--accent-primary)'
            }}
          >
            <Filter size={14} style={{ color: 'var(--accent-light)' }} />
            <span>{getDisplayText()}</span>
            <ChevronDown size={14} />
          </button>

          {/* Layer 1 Multi-Select Dropdown Menu */}
          {isDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: '260px',
              maxHeight: '320px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
              zIndex: 9999,
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              overflowY: 'auto'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
                Search Scope (Layer 1)
              </div>

              {/* All Providers Option */}
              <button
                onClick={() => handleToggleProvider('All')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: selectedProviders.includes('All') ? 'var(--bg-card-hover)' : 'transparent',
                  color: selectedProviders.includes('All') ? '#fff' : 'var(--text-main)',
                  border: 'none',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span>All Providers</span>
                {selectedProviders.includes('All') && <Check size={14} style={{ color: 'var(--accent-light)' }} />}
              </button>

              <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.25rem 0' }} />

              {/* Individual Active Provider Options */}
              {providers.map((p) => {
                const isChecked = selectedProviders.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => handleToggleProvider(p)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isChecked ? 'var(--bg-card-hover)' : 'transparent',
                      color: isChecked ? '#fff' : 'var(--text-main)',
                      border: 'none',
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{p}</span>
                    {isChecked && <Check size={14} style={{ color: 'var(--accent-light)' }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

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
