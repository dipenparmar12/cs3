import React from 'react';
import { Search, X, Filter, ArrowUpDown } from 'lucide-react';
import type {
  SourceFilterState,
  ResolutionFilterValue,
  SizeFilterValue,
  LanguageFilterValue,
  SortOption,
} from '../utils/sourceFilter';
import { isFilterActive } from '../utils/sourceFilter';

interface SourceFilterBarProps {
  filterState: SourceFilterState;
  onChange: (newState: SourceFilterState) => void;
  totalCount: number;
  filteredCount: number;
  compact?: boolean;
}

export const SourceFilterBar: React.FC<SourceFilterBarProps> = ({
  filterState,
  onChange,
  totalCount,
  filteredCount,
  compact = false,
}) => {
  const active = isFilterActive(filterState);

  const setField = <K extends keyof SourceFilterState>(key: K, val: SourceFilterState[K]) => {
    onChange({ ...filterState, [key]: val });
  };

  const handleReset = () => {
    onChange({
      searchQuery: '',
      resolution: 'all',
      size: 'all',
      language: 'all',
      sortBy: 'score',
    });
  };

  return (
    <div className={`source-filter-bar${compact ? ' source-filter-bar--compact' : ''}`}>
      {/* Search Box */}
      <div className="source-filter-bar__search">
        <Search size={14} className="source-filter-bar__search-icon" />
        <input
          type="text"
          placeholder="Filter sources (title, codec, group...)"
          value={filterState.searchQuery}
          onChange={(e) => setField('searchQuery', e.target.value)}
        />
        {filterState.searchQuery && (
          <button
            type="button"
            className="source-filter-bar__clear-btn"
            onClick={() => setField('searchQuery', '')}
            title="Clear search text"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Select Controls Row */}
      <div className="source-filter-bar__controls">
        {/* Resolution Dropdown */}
        <div className="source-filter-bar__select-wrapper" title="Filter by resolution">
          <label htmlFor="filter-resolution">Res:</label>
          <select
            id="filter-resolution"
            value={filterState.resolution}
            onChange={(e) => setField('resolution', e.target.value as ResolutionFilterValue)}
          >
            <option value="all">All Res</option>
            <option value="4k">4K (2160p)</option>
            <option value="1440p">1440p (QHD)</option>
            <option value="1080p">1080p (FHD)</option>
            <option value="720p">720p (HD)</option>
            <option value="480p">480p / SD</option>
          </select>
        </div>

        {/* Size Dropdown */}
        <div className="source-filter-bar__select-wrapper" title="Filter by file size">
          <label htmlFor="filter-size">Size:</label>
          <select
            id="filter-size"
            value={filterState.size}
            onChange={(e) => setField('size', e.target.value as SizeFilterValue)}
          >
            <option value="all">All Sizes</option>
            <option value="under1gb">&lt; 1 GB</option>
            <option value="1to3gb">1 – 3 GB</option>
            <option value="3to8gb">3 – 8 GB</option>
            <option value="over8gb">&gt; 8 GB</option>
          </select>
        </div>

        {/* Language Dropdown */}
        <div className="source-filter-bar__select-wrapper" title="Filter by language / audio">
          <label htmlFor="filter-language">Lang:</label>
          <select
            id="filter-language"
            value={filterState.language}
            onChange={(e) => setField('language', e.target.value as LanguageFilterValue)}
          >
            <option value="all">All Langs</option>
            <option value="en">English</option>
            <option value="dual_multi">Dual/Multi Audio</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
            <option value="ja">Japanese</option>
            <option value="hi">Hindi</option>
            <option value="other">Other Foreign</option>
          </select>
        </div>

        {/* Sort By Dropdown */}
        <div className="source-filter-bar__select-wrapper" title="Sort sources by">
          <ArrowUpDown size={12} style={{ color: 'var(--text-subtle)' }} />
          <select
            id="filter-sort"
            value={filterState.sortBy}
            onChange={(e) => setField('sortBy', e.target.value as SortOption)}
          >
            <option value="score">Sort: Rank</option>
            <option value="seeders">Sort: Seeders</option>
            <option value="res_desc">Sort: Quality</option>
            <option value="size_desc">Sort: Size ↓</option>
            <option value="size_asc">Sort: Size ↑</option>
          </select>
        </div>

        {/* Clear Filters Button if active */}
        {active && (
          <button
            type="button"
            className="source-filter-bar__reset-btn"
            onClick={handleReset}
            title="Reset all filters"
          >
            <Filter size={12} /> Reset
          </button>
        )}
      </div>

      {/* Filter Status summary */}
      {active && (
        <div className="source-filter-bar__summary">
          <span>
            Showing <strong>{filteredCount}</strong> of <strong>{totalCount}</strong> sources
          </span>
        </div>
      )}
    </div>
  );
};
