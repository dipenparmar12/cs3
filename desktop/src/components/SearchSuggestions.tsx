import React from 'react';
import { Poster } from './Poster';
import { BookmarkCheck, Building2, Clock, Loader2, Search, Trash2, User, X } from 'lucide-react';
import type { EntitySuggestion, SearchCategory, SearchHistoryEntry, SearchSuggestion } from '../types/api';
import { SEARCH_CATEGORIES, toggleCategory, wantsEntities, wantsTitles } from '../utils/searchCategories';
import { rowPosition, suggestionRows, type SuggestionRowKind } from '../utils/suggestionLayout';
import type { SavedSearchSummary } from '../../electron/savedSearches';
import { isAdultMedia } from '../utils/adultContent';
import { useAdultMode } from '../utils/useAdultMode';

/**
 * The panel under the search box: what you searched before, and what you
 * probably mean now.
 *
 * Both lists live in one surface because they answer the same question at
 * different stages of typing — an empty box is a recall problem, a half-typed
 * box is a spelling problem.
 *
 * Saved searches are integrated directly into recent history items with a subtle,
 * non-dominant indicator rather than loud row highlighting or pinned sections.
 */

interface SearchSuggestionsProps {
  open: boolean;
  suggestions: SearchSuggestion[];
  /** People and companies the query names. */
  entities: EntitySuggestion[];
  history: SearchHistoryEntry[];
  /** Block order (`utils/suggestionLayout.ts`); the navbar's arrow keys walk the same one. */
  order: SuggestionRowKind[];
  loading: boolean;
  /** Index into `rows`, driven by arrow keys. */
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onPickSuggestion: (suggestion: SearchSuggestion) => void;
  onPickEntity: (entity: EntitySuggestion) => void;
  onPickHistory: (entry: SearchHistoryEntry) => void;
  onRemoveHistory: (entry: SearchHistoryEntry) => void;
  onClearHistory: () => void;
  /** Searches kept with Save results; preserved in props for backwards compatibility. */
  saved?: SavedSearchSummary[];
  onPickSaved?: (id: string) => void;
  /** Optional handler to run live search for a query */
  onRunFreshSearch?: (query: string) => void;
  /** The category chips; none is All. */
  categories: SearchCategory[];
  /** Takes an updater, so two presses in a row each see the other. */
  onCategoriesChange: (update: (current: SearchCategory[]) => SearchCategory[]) => void;
  /** Chips only where a person can be opened; otherwise every category but Titles would lead nowhere. */
  chipsEnabled: boolean;
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
  suggestions,
  entities,
  history,
  order,
  loading,
  highlightedIndex,
  onHighlight,
  onPickSuggestion,
  onPickEntity,
  onPickHistory,
  onRemoveHistory,
  onClearHistory,
  onRunFreshSearch,
  categories,
  onCategoriesChange,
  chipsEnabled,
}) => {
  const { adultProviders } = useAdultMode();
  if (!open) return null;

  const showHistory = history.length > 0;
  const titlesWanted = wantsTitles(categories);
  const peopleOnly = !titlesWanted && wantsEntities(categories);

  // With chips the panel opens on focus even when empty, so the filters can be found before typing.
  if (!chipsEnabled && !loading && suggestions.length === 0 && entities.length === 0 && !showHistory) return null;

  // Quiet, one row, and pressing one never takes focus from the box.
  const chips = chipsEnabled && (
    <div className="search-suggest__chips" role="group" aria-label="Search for">
      {[{ id: 'all' as const, label: 'All' }, ...SEARCH_CATEGORIES].map((chip) => {
        const on = chip.id === 'all' ? categories.length === 0 : categories.includes(chip.id);
        return (
          <button
            key={chip.id}
            type="button"
            className={`search-suggest__chip${on ? ' search-suggest__chip--on' : ''}`}
            aria-pressed={on}
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              onCategoriesChange((current) => toggleCategory(current, chip.id));
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );

  /** What the row says a person is: the selected credits they hold, else Person; a company is a Studio. */
  const kindLabel = (entity: EntitySuggestion): string => {
    if (entity.kind === 'company') return 'Studio';
    const held = SEARCH_CATEGORIES.filter((c) => categories.includes(c.id) && (entity.roles as readonly string[] | undefined)?.includes(c.id));
    return held.length ? held.map((c) => c.label).join(' · ') : 'Person';
  };

  const rows = suggestionRows(order, {
    history: history.length,
    entity: entities.length,
    suggestion: suggestions.length,
  });

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
        const combinedIndex = rowPosition(rows, 'history', index);
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
                  <BookmarkCheck size={10} className="search-suggest__saved-badge-icon" />
                  <span>Saved</span>
                </span>
              )}
              <span className="search-suggest__meta">
                {relativeTime(isSaved ? (entry.savedAt ?? entry.at) : entry.at)}
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

  const suggestionBlock = titlesWanted && (loading || suggestions.length > 0) && (
    <div className="search-suggest__group">
      <div className="search-suggest__heading">
        <span>
          {loading ? <Loader2 size={12} className="spin" /> : <Search size={12} />}
          {loading ? 'Finding titles…' : 'Titles'}
        </span>
      </div>

      {suggestions.map((suggestion, index) => {
        const combinedIndex = rowPosition(rows, 'suggestion', index);
        const isAdult = isAdultMedia(
          {
            adult: suggestion.adult,
            title: suggestion.title,
            originalTitle: suggestion.originalTitle,
            type: suggestion.type,
            genres: suggestion.genres,
            plot: suggestion.plot,
            sources: suggestion.sources,
          },
          adultProviders
        );
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
              sensitive={isAdult}
              itemKey={suggestion.url || suggestion.title}
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

  // Picking one opens their films and series; Enter on the box still searches.
  const entityBlock = (entities.length > 0 || (peopleOnly && loading)) && (
    <div className="search-suggest__group search-suggest__group--entities">
      <div className="search-suggest__heading">
        <span>
          {peopleOnly && loading ? <Loader2 size={12} className="spin" /> : <User size={12} />}
          {peopleOnly && loading && entities.length === 0 ? 'Finding people…' : 'People and studios'}
        </span>
      </div>

      {entities.map((entity, index) => {
        const combinedIndex = rowPosition(rows, 'entity', index);
        const Icon = entity.kind === 'company' ? Building2 : User;
        return (
          <button
            key={entity.id}
            type="button"
            className={`search-suggest__row search-suggest__entity${
              combinedIndex === highlightedIndex ? ' search-suggest__row--active' : ''
            }`}
            title={`Films and series ${entity.kind === 'company' ? 'from' : 'with'} ${entity.name}`}
            onMouseEnter={() => onHighlight(combinedIndex)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPickEntity(entity);
            }}
          >
            <Poster
              src={entity.imageUrl}
              title={entity.name}
              decorative
              itemKey={entity.id}
              fallback={
                <div className="search-suggest__poster-empty">
                  <Icon size={16} />
                </div>
              }
            />
            <div className="search-suggest__body">
              <div className="search-suggest__line">
                <strong>{entity.name}</strong>
                <span className="search-suggest__type">{kindLabel(entity)}</span>
              </div>
              {entity.description && <div className="search-suggest__genres">{entity.description}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );

  const blocks = { history: historyBlock, entity: entityBlock, suggestion: suggestionBlock };
  return (
    <div className="search-suggest" role="listbox" aria-label="Search suggestions">
      {chips}
      {order.map((kind) => (
        <React.Fragment key={kind}>{blocks[kind]}</React.Fragment>
      ))}
    </div>
  );
};
