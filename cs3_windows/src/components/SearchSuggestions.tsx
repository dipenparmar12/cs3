import React from 'react';
import { Clock, Loader2, Search, Trash2, X } from 'lucide-react';
import type { SearchHistoryEntry, SearchSuggestion } from '../types/api';

/**
 * The panel under the search box: what you searched before, and what you
 * probably mean now.
 *
 * Both lists live in one surface because they answer the same question at
 * different stages of typing — an empty box is a recall problem, a half-typed
 * box is a spelling problem. Splitting them into two controls would make the
 * user decide which one they need before they have typed anything.
 */

interface SearchSuggestionsProps {
  open: boolean;
  query: string;
  suggestions: SearchSuggestion[];
  history: SearchHistoryEntry[];
  loading: boolean;
  /** Index into the combined list, driven by arrow keys. */
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onPickSuggestion: (suggestion: SearchSuggestion) => void;
  onPickHistory: (entry: SearchHistoryEntry) => void;
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
}

function relativeTime(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(at).toLocaleDateString();
}

export const SearchSuggestions: React.FC<SearchSuggestionsProps> = ({
  open,
  query,
  suggestions,
  history,
  loading,
  highlightedIndex,
  onHighlight,
  onPickSuggestion,
  onPickHistory,
  onRemoveHistory,
  onClearHistory,
}) => {
  if (!open) return null;

  const hasQuery = query.trim().length >= 2;
  const showHistory = history.length > 0;

  if (!loading && suggestions.length === 0 && !showHistory) return null;

  // History is offered first while the box is empty and demoted once the user
  // is typing, because at that point they are naming something new.
  const historyFirst = !hasQuery;

  const historyBlock = showHistory && (
    <div className="search-suggest__group">
      <div className="search-suggest__heading">
        <span>
          <Clock size={12} /> Recent searches
        </span>
        <button
          type="button"
          className="search-suggest__clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClearHistory}
        >
          <Trash2 size={12} /> Clear all
        </button>
      </div>

      {history.map((entry, index) => {
        const combinedIndex = historyFirst ? index : suggestions.length + index;
        return (
          <div
            key={entry.query}
            className={`search-suggest__row search-suggest__row--history${
              combinedIndex === highlightedIndex ? ' search-suggest__row--active' : ''
            }`}
            onMouseEnter={() => onHighlight(combinedIndex)}
          >
            <button
              type="button"
              className="search-suggest__hit"
              // Committing on mousedown beats the input's blur, which would
              // otherwise close the panel before the click ever lands.
              onMouseDown={(e) => {
                e.preventDefault();
                onPickHistory(entry);
              }}
            >
              <Search size={14} className="search-suggest__icon" />
              <span className="search-suggest__label">{entry.query}</span>
              <span className="search-suggest__meta">
                {entry.resultCount !== undefined && `${entry.resultCount} results · `}
                {relativeTime(entry.at)}
              </span>
            </button>
            <button
              type="button"
              className="search-suggest__remove"
              aria-label={`Remove ${entry.query} from history`}
              onMouseDown={(e) => {
                e.preventDefault();
                onRemoveHistory(entry.query);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );

  const suggestionBlock = (loading || suggestions.length > 0) && (
    <div className="search-suggest__group">
      <div className="search-suggest__heading">
        <span>
          {loading ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
          {loading ? 'Finding titles…' : 'Titles'}
        </span>
      </div>

      {suggestions.map((suggestion, index) => {
        const combinedIndex = historyFirst ? history.length + index : index;
        return (
          <button
            key={`${suggestion.url}-${suggestion.title}`}
            type="button"
            className={`search-suggest__row search-suggest__title${
              combinedIndex === highlightedIndex ? ' search-suggest__row--active' : ''
            }`}
            onMouseEnter={() => onHighlight(combinedIndex)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPickSuggestion(suggestion);
            }}
          >
            {suggestion.posterUrl ? (
              <img src={suggestion.posterUrl} alt="" loading="lazy" />
            ) : (
              <div className="search-suggest__poster-empty">
                {suggestion.title.slice(0, 1)}
              </div>
            )}

            <div className="search-suggest__body">
              <div className="search-suggest__line">
                <strong>{suggestion.title}</strong>
                {suggestion.year && <span className="search-suggest__year">{suggestion.year}</span>}
                {suggestion.type && (
                  <span className="search-suggest__type">{suggestion.type}</span>
                )}
              </div>

              {suggestion.genres.length > 0 && (
                <div className="search-suggest__genres">
                  {suggestion.genres.slice(0, 3).join(' · ')}
                </div>
              )}

              {suggestion.plot && (
                <p className="search-suggest__plot">{suggestion.plot}</p>
              )}
            </div>

            {/* Two catalogues independently naming the same title is the best
                signal available that it is the real thing, so it is shown. */}
            {suggestion.sources.length > 1 && (
              <span className="search-suggest__confirm" title={suggestion.sources.join(', ')}>
                {suggestion.sources.length}×
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="search-suggest" role="listbox" aria-label="Search suggestions">
      {historyFirst ? (
        <>
          {historyBlock}
          {suggestionBlock}
        </>
      ) : (
        <>
          {suggestionBlock}
          {historyBlock}
        </>
      )}
    </div>
  );
};
