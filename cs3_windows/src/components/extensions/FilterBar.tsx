import React, { useState } from 'react';
import { Search, X, SlidersHorizontal } from 'lucide-react';
import { Chip } from './primitives';
import { isAdultTag, type FacetOption, type StatusFilter } from './useExtensionFilters';

/**
 * Search, status, and the multi-select tag filter.
 *
 * Content tags are the primary control and sit on their own row, unabbreviated,
 * because they are what people filter by. Language and category are secondary
 * and stay collapsed until asked for — the corpus spans thirty-odd languages,
 * and a row of thirty chips would bury the four tags that matter.
 */

interface Props {
  query: string;
  onQuery: (value: string) => void;
  status: StatusFilter;
  onStatus: (value: StatusFilter) => void;
  tags: Set<string>;
  onToggleTag: (value: string) => void;
  languages: Set<string>;
  onToggleLanguage: (value: string) => void;
  categories: Set<string>;
  onToggleCategory: (value: string) => void;
  facets: { tags: FacetOption[]; languages: FacetOption[]; categories: FacetOption[] };
  activeCount: number;
  onReset: () => void;
  /** Category only means something in the catalogue view. */
  showCategories?: boolean;
  /** Which tab is asking, so the status list offers only what it can apply. */
  scope: 'sources' | 'repositories' | 'extensions';
}

/**
 * Status options per tab.
 *
 * Offering all six everywhere would let the user pick one that silently does
 * nothing — "Active only" has no meaning in a catalogue of things that are not
 * installed, and "Not installed" has none in a tree of things that are. A filter
 * that appears to apply and does not is worse than one that is absent.
 */
const STATUS_OPTIONS: Record<Props['scope'], Array<{ value: StatusFilter; label: string }>> = {
  sources: [
    { value: 'all', label: 'Everything' },
    { value: 'enabled', label: 'Answering searches' },
    { value: 'disabled', label: 'Switched off' },
    { value: 'problems', label: 'Needs attention' },
  ],
  repositories: [
    { value: 'all', label: 'Everything' },
    { value: 'installed', label: 'Installed' },
    { value: 'available', label: 'Not installed' },
  ],
  extensions: [
    { value: 'all', label: 'Everything' },
    { value: 'installed', label: 'Installed' },
    { value: 'available', label: 'Not installed' },
    { value: 'problems', label: 'Reported down or slow' },
  ],
};

export const FilterBar: React.FC<Props> = ({
  query,
  onQuery,
  status,
  onStatus,
  tags,
  onToggleTag,
  languages,
  onToggleLanguage,
  categories,
  onToggleCategory,
  facets,
  activeCount,
  onReset,
  showCategories,
  scope,
}) => {
  const [showMore, setShowMore] = useState(false);
  const hasSecondary = facets.languages.length > 0 || (showCategories && facets.categories.length > 0);

  return (
    <div className="ext-panel ext-filters">
      <div className="ext-filters__row">
        <div className="ext-search">
          <Search size={14} className="ext-search__icon" />
          <input
            className="ext-search__input"
            type="text"
            value={query}
            placeholder="Search repositories, extensions and providers…"
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>

        <select
          className="ext-select"
          value={status}
          aria-label="Status filter"
          onChange={(event) => onStatus(event.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS[scope].map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {hasSecondary && (
          <button
            type="button"
            className="ext-btn"
            aria-pressed={showMore}
            onClick={() => setShowMore((open) => !open)}
          >
            <SlidersHorizontal size={12} />
            More filters
            {languages.size + categories.size > 0 && (
              <span className="ext-chip__count">{languages.size + categories.size}</span>
            )}
          </button>
        )}

        {activeCount > 0 && (
          <button type="button" className="ext-btn" onClick={onReset}>
            <X size={12} />
            Clear {activeCount}
          </button>
        )}
      </div>

      {facets.tags.length > 0 && (
        <div className="ext-filters__row">
          <span className="ext-filters__label">Content</span>
          {facets.tags.map((tag) => (
            <Chip
              key={tag.value}
              pressed={tags.has(tag.value)}
              count={tag.count}
              adult={isAdultTag(tag.value)}
              onClick={() => onToggleTag(tag.value)}
            >
              {tag.label}
            </Chip>
          ))}
        </div>
      )}

      {showMore && facets.languages.length > 0 && (
        <div className="ext-filters__row">
          <span className="ext-filters__label">Language</span>
          {facets.languages.map((language) => (
            <Chip
              key={language.value}
              pressed={languages.has(language.value)}
              count={language.count}
              onClick={() => onToggleLanguage(language.value)}
            >
              {language.label}
            </Chip>
          ))}
        </div>
      )}

      {showMore && showCategories && facets.categories.length > 0 && (
        <div className="ext-filters__row">
          <span className="ext-filters__label">Category</span>
          {facets.categories.map((category) => (
            <Chip
              key={category.value}
              pressed={categories.has(category.value)}
              count={category.count}
              onClick={() => onToggleCategory(category.value)}
            >
              {category.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
};
