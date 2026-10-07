import React from 'react';
import { Poster } from './Poster';
import { BookmarkCheck, Clock, Loader2, Search, Trash2, X } from 'lucide-react';
import type { SearchHistoryEntry, SearchSuggestion } from '../types/api';
import type { SavedSearchSummary } from '../../electron/savedSearches';

/**
 * The panel under the search box: what you searched before, and what you
 * probably mean now.
 *
 * Both lists live in one surface because they answer the same question at
 * different stages of typing — an empty box is a recall problem, a half-typed
 * box is a spelling problem.
 *
 * Saved searches are integrated directly into recent history items with clear
 * visual highlighting rather than pinned in a separate section at the top.
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
  onRemoveHistory: (entry: SearchHistoryEntry) => void;
  onClearHistory: () => void;
  /** Searches kept with Save results; preserved in props for backwards compatibility. */
  saved?: SavedSearchSummary[];
  onPickSaved?: (id: string) => void;
  /** Optional handler to run live search for a query */
  onRunFreshSearch?: (query: string) => void;
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
  onRunFreshSearch,
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
        const isSaved = Boolean(entry.isSaved);
        const isActive = combinedIndex === highlightedIndex;
        const rowClass = `search-suggest__row search-suggest__row--history${
          isSaved ? ' search-suggest__row--saved' : ''
        }${isActive ? ' search-suggest__row--active' : ''}`;

        return (
          <div
            key={`${entry.query}-${entry.savedId ?? entry.at}`}
            className={rowClass}
            onMouseEnter={() => onHighlight(combinedIndex)}
          >
            <button
              type="button"
              className="search-suggest__hit"
              title={
                isSaved
                  ? `Open saved results for "${entry.query}"`
                  : `Search for "${entry.query}"`
              }
              // Committing on mousedown beats the input's blur, which would
              // otherwise close the panel before the click ever lands.
              onMouseDown={(e) => {
                e.preventDefault();
                onPickHistory(entry);
              }}
            >
              {isSaved ? (
                <BookmarkCheck size={14} className="search-suggest__icon search-suggest__icon--saved" />
              ) : (
                <Search size={14} className="search-suggest__icon" />
              )}
              <span className="search-suggest__label">{entry.query}</span>
              {isSaved && (
                <span className="search-suggest__saved-badge" title="Results saved for this search">
                  <BookmarkCheck size={10} />
                  <span>Saved</span>
                </span>
              )}
              <span className="search-suggest__meta">
                {isSaved
                  ? `${entry.savedResultCount ?? entry.resultCount ?? 0} saved · ${relativeTime(entry.savedAt ?? entry.at)}`
                  : `${entry.resultCount !== undefined ? `${entry.resultCount} results · ` : ''}${relativeTime(entry.at)}`}
              </span>
            </button>
            {isSaved && onRunFreshSearch && (
              <button
                type="button"
                className="search-suggest__action-btn"
                title={`Run live search for "${entry.query}"`}
                aria-label={`Run live search for ${entry.query}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRunFreshSearch(entry.query);
                }}
              >
                <Search size={12} />
              </button>
            )}
            <button
              type="button"
              className="search-suggest__remove"
              aria-label={`Remove ${entry.query} from history`}
              title={`Remove ${entry.query}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemoveHistory(entry);
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
            <Poster
              src={suggestion.posterUrl}
              title={suggestion.title}
              decorative
              fallback={
                <div className="search-suggest__poster-empty">
                  {suggestion.title.slice(0, 1)}
                </div>
              }
            />

            <div className="search-suggest__body">
              <div className="search-suggest__line">
                <strong>{suggestion.title}</strong>
                {suggestion.year && <span className="search-suggest__year">{suggestion.year}</span>}
                {suggestion.type && (
                  <span className="search-suggest__type">{suggestion.type}</span>
                )}
                {/* The language, where a catalogue publishes one. It is what
                    separates two same-named works faster than a year does for
                    the dubbed and regional titles this corpus is full of. */}
                {suggestion.language && (
                  <span className="search-suggest__lang">{suggestion.language}</span>
                )}
              </div>

              {/* The native spelling, shown only when it is genuinely a
                  different name — repeating the row's own title underneath
                  itself reads as a rendering fault. */}
              {suggestion.originalTitle &&
                suggestion.originalTitle.trim().toLowerCase() !==
                  suggestion.title.trim().toLowerCase() && (
                  <div className="search-suggest__original" lang="und">
                    {suggestion.originalTitle}
                  </div>
                )}

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
