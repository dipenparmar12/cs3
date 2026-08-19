import React, { useMemo } from 'react';
import { ArrowUpDown, Languages, MonitorPlay, Radio, RotateCcw, Search, X } from 'lucide-react';
import type { TorrentResult } from '../types/torrent';
import type {
  SourceFilterState,
  ResolutionFilterValue,
  SizeFilterValue,
  LanguageFilterValue,
  SortOption,
} from '../utils/sourceFilter';
import { buildFacet, DEFAULT_FILTER_STATE, isFilterActive } from '../utils/sourceFilter';
import { FacetMenu, type FacetOption } from './FacetMenu';

/**
 * The filter strip above a list of playable sources.
 *
 * Rendered in two very different places: the source picker on the detail page,
 * and the source panel inside the player's sidebar — a narrow column laid over
 * the video. It used to be three stacked rows (a full-width text box, four
 * labelled selects, a status line), which in the sidebar consumed most of the
 * panel and pushed the sources themselves out of view.
 *
 * It is one row now. Each dimension is a chip that reads as its current value,
 * and its options — with the count each would leave — open on click. Nothing is
 * hidden; it is just not all shouted at once. Options that would match nothing
 * are not offered, so the menus stay short even with a dozen indexers and
 * several extension providers answering the same query.
 */

const SORT_OPTIONS: FacetOption[] = [
  { value: 'seeders', label: 'Most seeders' },
  { value: 'res_desc', label: 'Best quality' },
  { value: 'size_desc', label: 'Largest first' },
  { value: 'size_asc', label: 'Smallest first' },
];

interface SourceFilterBarProps {
  /** The unfiltered set, needed to count what each option would leave. */
  sources: TorrentResult[];
  filterState: SourceFilterState;
  onChange: (newState: SourceFilterState) => void;
  filteredCount: number;
  compact?: boolean;
}

export const SourceFilterBar: React.FC<SourceFilterBarProps> = ({
  sources,
  filterState,
  onChange,
  filteredCount,
  compact = false,
}) => {
  const active = isFilterActive(filterState);

  const setField = <K extends keyof SourceFilterState>(key: K, val: SourceFilterState[K]) => {
    onChange({ ...filterState, [key]: val });
  };

  const facets = useMemo(
    () => ({
      resolution: buildFacet(sources, filterState, 'resolution'),
      size: buildFacet(sources, filterState, 'size'),
      language: buildFacet(sources, filterState, 'language'),
      source: buildFacet(sources, filterState, 'source'),
    }),
    [sources, filterState]
  );

  return (
    <div className={`source-filter${compact ? ' source-filter--compact' : ''}`}>
      <div className="source-filter__search">
        <Search size={13} />
        <input
          type="text"
          placeholder="Filter by title, codec, group…"
          value={filterState.searchQuery}
          onChange={(event) => setField('searchQuery', event.target.value)}
          aria-label="Filter sources by text"
        />
        {filterState.searchQuery && (
          <button
            type="button"
            onClick={() => setField('searchQuery', '')}
            title="Clear search text"
            aria-label="Clear search text"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {facets.resolution.length > 1 && (
        <FacetMenu
          label="Quality"
          icon={<MonitorPlay size={12} />}
          value={filterState.resolution}
          options={facets.resolution}
          onChange={(value) => setField('resolution', value as ResolutionFilterValue)}
        />
      )}

      {facets.size.length > 1 && (
        <FacetMenu
          label="Size"
          value={filterState.size}
          options={facets.size}
          onChange={(value) => setField('size', value as SizeFilterValue)}
        />
      )}

      {facets.language.length > 1 && (
        <FacetMenu
          label="Language"
          icon={<Languages size={12} />}
          value={filterState.language}
          options={facets.language}
          onChange={(value) => setField('language', value as LanguageFilterValue)}
        />
      )}

      {facets.source.length > 1 && (
        <FacetMenu
          label="Source"
          title="Show only sources from one indexer or provider"
          icon={<Radio size={12} />}
          value={filterState.source}
          options={facets.source}
          onChange={(value) => setField('source', value)}
        />
      )}

      <FacetMenu
        label="Rank"
        icon={<ArrowUpDown size={12} />}
        value={filterState.sortBy}
        options={SORT_OPTIONS}
        allValue="score"
        allLabel="Best match"
        title="Sort sources"
        onChange={(value) => setField('sortBy', value as SortOption)}
      />

      <span className="source-filter__count">
        {active ? `${filteredCount} of ${sources.length}` : `${sources.length}`}
      </span>

      {active && (
        <button
          type="button"
          className="source-filter__reset"
          onClick={() => onChange({ ...DEFAULT_FILTER_STATE })}
          title="Reset all filters"
          aria-label="Reset all filters"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
};
