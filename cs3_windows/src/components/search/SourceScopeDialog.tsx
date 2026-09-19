import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Minus,
  Package,
  Radio,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type { ProviderLoadProgress } from '../../../electron/pluginManager';
import { isWorthShowing, type ProviderHealth } from './providerHealth';
import {
  prettyType,
  stateOf,
  type CheckState,
  type ChosenSource,
  type Facets,
  type FacetSelection,
  type Row,
} from './sourceScopeModel';

export type { CheckState, ChosenSource, Facets, FacetSelection, Row };

const Box: React.FC<{ state: CheckState }> = ({ state }) => (
  <span className={`scope__box scope__box--${state}`} aria-hidden>
    {state === 'on' && <Check size={12} strokeWidth={3} />}
    {state === 'mixed' && <Minus size={12} strokeWidth={3} />}
  </span>
);

const ROW_HEIGHT = 34;
const OVERSCAN = 8;
const ASSUMED_VIEWPORT = 460;
const CHIP_COLLAPSE_THRESHOLD = 12;

interface SourceRowItemProps {
  row: Row;
  index: number;
  isActive: boolean;
  state: CheckState;
  health?: ProviderHealth;
  onToggleRow: (row: Row) => void;
  onToggleCollapse: (key: string) => void;
  onIncludeSection?: (row: Row) => void;
  onExcludeSection?: (row: Row) => void;
  onSetActive: (index: number) => void;
}

const SourceRowItem = React.memo<SourceRowItemProps>(
  ({
    row,
    index,
    isActive,
    state,
    health,
    onToggleRow,
    onToggleCollapse,
    onIncludeSection,
    onExcludeSection,
    onSetActive,
  }) => {
    if (row.kind === 'note') {
      return (
        <p key={row.key} className="scope-modal__note" style={{ height: ROW_HEIGHT }}>
          {row.label}
        </p>
      );
    }

    const rowId = `scope-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    return (
      <div
        id={rowId}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.expanded}
        aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
        aria-disabled={row.members.length === 0 || undefined}
        className={[
          'scope-modal__row',
          `scope-modal__row--${row.kind}`,
          `scope-modal__row--d${row.depth}`,
          isActive ? 'scope-modal__row--active' : '',
          state !== 'off' ? 'scope-modal__row--on' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ height: ROW_HEIGHT }}
        title={row.title}
        onMouseDown={() => onSetActive(index)}
      >
        {row.expanded !== undefined ? (
          <button
            className="scope-modal__twisty"
            onClick={() => onToggleCollapse(row.key)}
            aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
            tabIndex={-1}
          >
            {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="scope-modal__twisty scope-modal__twisty--empty" />
        )}

        <button
          className="scope-modal__pick"
          onClick={() => onToggleRow(row)}
          disabled={row.members.length === 0}
          tabIndex={-1}
        >
          <Box state={state} />
          {row.icon === 'package' && <Package size={14} />}
          {row.icon === 'radio' && <Radio size={14} />}
          <span className="scope-modal__name">{row.label}</span>
          {row.lang && <span className="scope-modal__lang">{row.lang.toUpperCase()}</span>}
          {row.members.length > 1 && (
            <span className="scope-modal__count">{row.members.length}</span>
          )}
          {health && isWorthShowing(health) ? (
            <span
              className={`scope-modal__health scope-modal__health--${health.level}`}
              title={health.detail}
            >
              {health.label}
            </span>
          ) : null}
        </button>

        {(row.kind === 'repo' || row.kind === 'ext') && row.members.length > 0 && (
          <div className="scope-modal__row-actions">
            <button
              type="button"
              className="scope-modal__row-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onIncludeSection?.(row);
              }}
              title={`Select all in ${row.label}`}
              tabIndex={-1}
            >
              All
            </button>
            <button
              type="button"
              className="scope-modal__row-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onExcludeSection?.(row);
              }}
              title={`Deselect all in ${row.label}`}
              tabIndex={-1}
            >
              None
            </button>
          </div>
        )}
      </div>
    );
  }
);
SourceRowItem.displayName = 'SourceRowItem';

interface SourceVirtualTreeProps {
  rows: Row[];
  providers: Set<string>;
  indexers: Set<string>;
  healthFor?: (provider: string) => ProviderHealth | undefined;
  clampedActive: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onSetActive: (index: number) => void;
  onToggleRow: (row: Row) => void;
  onToggleCollapse: (key: string) => void;
  onIncludeSection?: (row: Row) => void;
  onExcludeSection?: (row: Row) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  activeRowDomId?: string;
}

const SourceVirtualTree: React.FC<SourceVirtualTreeProps> = ({
  rows,
  providers,
  indexers,
  healthFor,
  clampedActive,
  scrollerRef,
  onSetActive,
  onToggleRow,
  onToggleCollapse,
  onIncludeSection,
  onExcludeSection,
  onKeyDown,
  activeRowDomId,
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(ASSUMED_VIEWPORT);
  const rafId = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight || ASSUMED_VIEWPORT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollerRef]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const targetScrollTop = event.currentTarget.scrollTop;
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      setScrollTop(targetScrollTop);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, []);

  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisible = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN
  );
  const windowed = rows.slice(firstVisible, lastVisible);

  return (
    <div
      className="scope-modal__tree"
      ref={scrollerRef}
      role="tree"
      aria-label="Sources to search"
      aria-multiselectable="true"
      aria-activedescendant={activeRowDomId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={handleScroll}
    >
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        <div
          style={{
            transform: `translateY(${firstVisible * ROW_HEIGHT}px)`,
            willChange: 'transform',
          }}
        >
          {windowed.map((row, offset) => {
            const index = firstVisible + offset;
            const selected = row.isIndexer ? indexers : providers;
            const state = stateOf(row.members, selected);
            const health =
              row.kind === 'leaf' && !row.isIndexer ? healthFor?.(row.members[0]) : undefined;

            return (
              <SourceRowItem
                key={row.key}
                row={row}
                index={index}
                isActive={index === clampedActive}
                state={state}
                health={health}
                onToggleRow={onToggleRow}
                onToggleCollapse={onToggleCollapse}
                onIncludeSection={onIncludeSection}
                onExcludeSection={onExcludeSection}
                onSetActive={onSetActive}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface ChosenSourcesBarProps {
  chosen: ChosenSource[];
  onDeselect: (source: ChosenSource) => void;
  onClearAll?: () => void;
}

const ChosenSourcesBar: React.FC<ChosenSourcesBarProps> = ({ chosen, onDeselect, onClearAll }) => {
  const [expanded, setExpanded] = useState(false);

  if (chosen.length === 0) return null;

  const hasOverflow = chosen.length > CHIP_COLLAPSE_THRESHOLD;
  const visible = expanded || !hasOverflow ? chosen : chosen.slice(0, CHIP_COLLAPSE_THRESHOLD);

  return (
    <div className="scope-modal__chosen-wrap">
      <div className="scope-modal__chosen-header">
        <span className="scope-modal__chosen-title">
          Selected sources ({chosen.length})
        </span>
        <div className="scope-modal__chosen-actions">
          {hasOverflow && (
            <button
              type="button"
              className="scope-modal__chosen-toggle"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Show less' : `+${chosen.length - CHIP_COLLAPSE_THRESHOLD} more`}
            </button>
          )}
          {onClearAll && (
            <button
              type="button"
              className="scope-modal__chosen-clear"
              onClick={onClearAll}
              title="Clear all selected sources"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
      <div
        className={`scope-modal__chosen${expanded ? ' scope-modal__chosen--expanded' : ''}`}
        aria-label="Selected sources"
      >
        {visible.map((source) => (
          <button
            key={`${source.isIndexer ? 'i' : 'p'}:${source.id}`}
            className="scope-modal__chosen-chip"
            onClick={() => onDeselect(source)}
            title={`Stop searching ${source.label}`}
          >
            {source.isIndexer ? <Radio size={11} /> : <Package size={11} />}
            <span>{source.label}</span>
            <X size={11} aria-label={`Remove ${source.label}`} />
          </button>
        ))}
        {!expanded && hasOverflow && (
          <button
            type="button"
            className="scope-modal__chosen-more-chip"
            onClick={() => setExpanded(true)}
            title={`Show all ${chosen.length} selected sources`}
          >
            +{chosen.length - CHIP_COLLAPSE_THRESHOLD} more…
          </button>
        )}
      </div>
    </div>
  );
};

export interface SourceScopeDialogProps {
  rows: Row[];
  available: Facets;
  facets: FacetSelection;
  facetsActive: boolean;
  onToggleFacet: (group: keyof FacetSelection, value: string) => void;
  onClearFacets: () => void;
  onSelectAllFacetGroup?: (group: keyof FacetSelection) => void;
  onClearFacetGroup?: (group: keyof FacetSelection) => void;

  query: string;
  onQueryChange: (value: string) => void;

  providers: Set<string>;
  indexers: Set<string>;
  chosen: ChosenSource[];
  totalChosen: number;
  totalAvailable: number;

  isFiltered?: boolean;
  filteredCount?: number;
  allFilteredSelected?: boolean;
  onSelectAllFiltered?: () => void;
  onUnselectAllFiltered?: () => void;
  onClearAllChosen?: () => void;

  hasExtensions: boolean;
  hasIndexers: boolean;
  chosenTorrentCount?: number;
  onToggleAllTorrents?: () => void;

  progress: ProviderLoadProgress | null;
  loading: boolean;
  loaded: boolean;

  onToggleRow: (row: Row) => void;
  onToggleCollapse: (key: string) => void;
  onIncludeSection?: (row: Row) => void;
  onExcludeSection?: (row: Row) => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onDeselect: (source: ChosenSource) => void;
  onSelectAll: () => void;
  onReset: () => void;
  onClose: () => void;
  profileBar?: React.ReactNode;
  healthFor?: (provider: string) => ProviderHealth | undefined;
}

export const SourceScopeDialog: React.FC<SourceScopeDialogProps> = ({
  rows,
  available,
  facets,
  facetsActive,
  onToggleFacet,
  onClearFacets,
  onSelectAllFacetGroup,
  onClearFacetGroup,
  query,
  onQueryChange,
  providers,
  indexers,
  chosen,
  totalChosen,
  totalAvailable,
  isFiltered = false,
  filteredCount,
  allFilteredSelected = false,
  onSelectAllFiltered,
  onUnselectAllFiltered,
  onClearAllChosen,
  hasExtensions,
  hasIndexers,
  chosenTorrentCount = 0,
  onToggleAllTorrents,
  progress,
  loading,
  loaded,
  onToggleRow,
  onToggleCollapse,
  onIncludeSection,
  onExcludeSection,
  onExpandAll,
  onCollapseAll,
  onDeselect,
  onSelectAll,
  onReset,
  onClose,
  profileBar,
  healthFor,
}) => {
  const dialog = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const searchField = useRef<HTMLInputElement | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [inputValue, setInputValue] = useState(query);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    searchField.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, []);

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setInputValue(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      onQueryChange(next);
    }, 150);
  };

  const handleInputClear = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setInputValue('');
    onQueryChange('');
  };

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query]);

  const clampedActive = Math.min(activeIndex, Math.max(0, rows.length - 1));

  const revealRow = useCallback((index: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  }, []);

  const step = useCallback(
    (from: number, direction: 1 | -1): number => {
      let index = from;
      for (let guard = 0; guard < rows.length; guard++) {
        index += direction;
        if (index < 0 || index >= rows.length) return from;
        if (rows[index].kind !== 'note') return index;
      }
      return from;
    },
    [rows]
  );

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      revealRow(index);
    },
    [revealRow]
  );

  const onTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rows[clampedActive];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveTo(step(clampedActive, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveTo(step(clampedActive, -1));
        return;
      case 'Home':
        event.preventDefault();
        moveTo(rows.findIndex((candidate) => candidate.kind !== 'note'));
        return;
      case 'End': {
        event.preventDefault();
        for (let index = rows.length - 1; index >= 0; index--) {
          if (rows[index].kind !== 'note') return moveTo(index);
        }
        return;
      }
      case 'ArrowRight':
        if (row?.expanded === false) {
          event.preventDefault();
          onToggleCollapse(row.key);
        }
        return;
      case 'ArrowLeft':
        if (row?.expanded === true) {
          event.preventDefault();
          onToggleCollapse(row.key);
        }
        return;
      case ' ':
      case 'Enter':
        if (row && row.members.length > 0) {
          event.preventDefault();
          onToggleRow(row);
        }
        return;
      default:
    }
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, [href], select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const rowDomId = (row: Row) => `scope-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const activeRow = rows[clampedActive];

  const summary = useMemo(() => {
    if (totalChosen === 0) {
      return 'Searching every enabled provider, catalogue and torrent source.';
    }
    if (totalChosen === 1) return 'Searching one source. Catalogue metadata is not consulted.';
    return `Searching ${totalChosen} sources. Catalogue metadata is not consulted.`;
  }, [totalChosen]);

  const selectAllButtonText = useMemo(() => {
    if (isFiltered) {
      return allFilteredSelected
        ? 'Unselect filtered'
        : filteredCount !== undefined && filteredCount > 0
          ? `Select filtered (${filteredCount})`
          : 'Select all filtered';
    }
    if (totalChosen === totalAvailable && totalAvailable > 0) {
      return 'Unselect all';
    }
    return 'Select all';
  }, [isFiltered, allFilteredSelected, filteredCount, totalChosen, totalAvailable]);

  const handleSelectAllAction = () => {
    if (isFiltered) {
      if (allFilteredSelected) {
        onUnselectAllFiltered?.();
      } else {
        onSelectAllFiltered?.();
      }
      return;
    }
    if (totalChosen === totalAvailable && totalAvailable > 0) {
      onClearAllChosen?.();
      return;
    }
    onSelectAll();
  };

  return (
    <div className="scope-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="scope-modal__panel"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scope-modal-title"
        aria-describedby="scope-modal-summary"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <header className="scope-modal__head">
          <div>
            <h2 id="scope-modal-title">Search sources</h2>
            <p className="scope-modal__subtitle">
              {totalChosen === 0
                ? `All ${totalAvailable} sources`
                : `${totalChosen} of ${totalAvailable} selected`}
            </p>
          </div>
          <button
            className="scope-modal__close"
            onClick={onClose}
            aria-label="Close search sources"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </header>

        <div className="scope-modal__body">
          <aside className="scope-modal__rail" aria-label="Filters">
            <p className="scope-modal__rail-note">
              Filters change what this list shows. Ticking a source is what narrows the search.
            </p>

            {hasExtensions && hasIndexers && (
              <FacetGroup
                label="Kind"
                onSelectAll={
                  onSelectAllFacetGroup ? () => onSelectAllFacetGroup('kinds') : undefined
                }
                onClear={onClearFacetGroup ? () => onClearFacetGroup('kinds') : undefined}
              >
                <FacetChip
                  on={facets.kinds.has('extension')}
                  onClick={() => onToggleFacet('kinds', 'extension')}
                  title="Show only extension providers"
                >
                  <Package size={12} /> Extensions
                </FacetChip>
                <FacetChip
                  on={facets.kinds.has('indexer')}
                  onClick={() => onToggleFacet('kinds', 'indexer')}
                  title="Show only torrent sources"
                >
                  <Radio size={12} /> Torrents
                </FacetChip>
              </FacetGroup>
            )}

            {available.types.length > 0 && (
              <FacetGroup
                label="Content type"
                onSelectAll={
                  onSelectAllFacetGroup ? () => onSelectAllFacetGroup('types') : undefined
                }
                onClear={onClearFacetGroup ? () => onClearFacetGroup('types') : undefined}
              >
                {available.types.map((type) => (
                  <FacetChip
                    key={type}
                    on={facets.types.has(type)}
                    onClick={() => onToggleFacet('types', type)}
                  >
                    {prettyType(type)}
                  </FacetChip>
                ))}
              </FacetGroup>
            )}

            {available.languages.length > 1 && (
              <FacetGroup
                label="Language"
                onSelectAll={
                  onSelectAllFacetGroup ? () => onSelectAllFacetGroup('languages') : undefined
                }
                onClear={onClearFacetGroup ? () => onClearFacetGroup('languages') : undefined}
              >
                {available.languages.map((lang) => (
                  <FacetChip
                    key={lang}
                    on={facets.languages.has(lang)}
                    onClick={() => onToggleFacet('languages', lang)}
                  >
                    {lang.toUpperCase()}
                  </FacetChip>
                ))}
              </FacetGroup>
            )}

            {facetsActive && (
              <button className="scope-modal__clear" onClick={onClearFacets}>
                <RotateCcw size={12} /> Clear filters
              </button>
            )}
          </aside>

          <section className="scope-modal__main" aria-label="Sources">
            {profileBar}

            <div className="scope-modal__search">
              <Search size={15} />
              <input
                ref={searchField}
                value={inputValue}
                onChange={handleInputChange}
                placeholder="Find a repository, extension or provider…"
                aria-label="Filter the source list"
                type="search"
              />
              {inputValue && (
                <button onClick={handleInputClear} aria-label="Clear the source filter">
                  <X size={14} />
                </button>
              )}
            </div>

            {!profileBar && (
              <button
                className={`scope-modal__all${totalChosen === 0 ? ' scope-modal__all--current' : ''}`}
                onClick={onReset}
                aria-pressed={totalChosen === 0}
              >
                <Box state={totalChosen === 0 ? 'on' : 'off'} />
                <Globe size={15} />
                <span className="scope-modal__all-label">
                  All sources
                  <span className="scope-modal__all-hint">Follows whatever you have installed</span>
                </span>
                <span className="scope-modal__count">{totalAvailable}</span>
              </button>
            )}

            <ChosenSourcesBar
              chosen={chosen}
              onDeselect={onDeselect}
              onClearAll={onClearAllChosen}
            />

            {progress?.running && (
              <p className="scope-modal__progress">
                <Loader2 size={13} className="spin" />
                <span>
                  Loading extensions — {progress.loaded} of {progress.total}
                  {progress.providers > 0 ? `, ${progress.providers} providers so far` : ''}
                  {progress.current ? ` · ${progress.current}` : ''}
                </span>
              </p>
            )}
            {loading && !loaded && !progress?.running && (
              <p className="scope-modal__progress">
                <Loader2 size={13} className="spin" /> Loading extensions…
              </p>
            )}
            {loading && loaded && !progress?.running && (
              <p className="scope-modal__progress scope-modal__progress--quiet">
                <Loader2 size={12} className="spin" /> Refreshing…
              </p>
            )}

            {!loading && rows.length === 0 ? (
              <p className="scope-modal__empty">
                {query.trim()
                  ? `Nothing matches “${query.trim()}”.`
                  : facetsActive
                    ? 'No source matches these filters.'
                    : progress?.running
                      ? 'Loading the installed extensions…'
                      : 'No extension providers are installed. Add a repository in Extensions.'}
              </p>
            ) : (
              <>
                <div className="scope-modal__tree-bar">
                  <span>{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
                  {(onExpandAll || onCollapseAll || (hasIndexers && onToggleAllTorrents)) && (
                    <div className="scope-modal__tree-controls">
                      {hasIndexers && onToggleAllTorrents && (
                        <button
                          type="button"
                          className="scope-modal__tree-control-btn"
                          onClick={onToggleAllTorrents}
                          title={
                            chosenTorrentCount > 0
                              ? 'Unselect all torrent sources'
                              : 'Select all torrent sources'
                          }
                        >
                          {chosenTorrentCount > 0 ? 'Exclude torrents' : 'Include torrents'}
                        </button>
                      )}
                      {onExpandAll && (
                        <button
                          type="button"
                          className="scope-modal__tree-control-btn"
                          onClick={onExpandAll}
                          title="Expand all sections"
                        >
                          Expand all
                        </button>
                      )}
                      {onCollapseAll && (
                        <button
                          type="button"
                          className="scope-modal__tree-control-btn"
                          onClick={onCollapseAll}
                          title="Collapse all sections"
                        >
                          Collapse all
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <SourceVirtualTree
                  rows={rows}
                  providers={providers}
                  indexers={indexers}
                  healthFor={healthFor}
                  clampedActive={clampedActive}
                  scrollerRef={scroller}
                  onSetActive={setActiveIndex}
                  onToggleRow={onToggleRow}
                  onToggleCollapse={onToggleCollapse}
                  onIncludeSection={onIncludeSection}
                  onExcludeSection={onExcludeSection}
                  onKeyDown={onTreeKeyDown}
                  activeRowDomId={activeRow ? rowDomId(activeRow) : undefined}
                />
              </>
            )}
          </section>
        </div>

        <footer className="scope-modal__foot">
          <p id="scope-modal-summary" className="scope-modal__summary">
            {summary}
          </p>
          <div className="scope-modal__actions">
            <button
              className="btn btn-ghost"
              onClick={handleSelectAllAction}
              disabled={isFiltered ? (filteredCount ?? 0) === 0 : totalAvailable === 0}
              title={
                isFiltered
                  ? allFilteredSelected
                    ? 'Deselect all sources matching current filter'
                    : 'Select all sources matching current filter'
                  : 'Tick every source as it is right now, rather than following what is installed'
              }
            >
              {selectAllButtonText}
            </button>
            <button className="btn btn-ghost" onClick={onReset} disabled={totalChosen === 0}>
              Reset
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

const FacetGroup: React.FC<{
  label: string;
  onSelectAll?: () => void;
  onClear?: () => void;
  children: React.ReactNode;
}> = ({ label, onSelectAll, onClear, children }) => (
  <div className="scope-modal__facet" role="group" aria-label={label}>
    <div className="scope-modal__facet-head">
      <h3>{label}</h3>
      {(onSelectAll || onClear) && (
        <div className="scope-modal__facet-actions">
          {onSelectAll && (
            <button
              type="button"
              className="scope-modal__facet-action-btn"
              onClick={onSelectAll}
              title={`Select all ${label.toLowerCase()}`}
            >
              All
            </button>
          )}
          {onClear && (
            <button
              type="button"
              className="scope-modal__facet-action-btn"
              onClick={onClear}
              title={`Clear ${label.toLowerCase()}`}
            >
              None
            </button>
          )}
        </div>
      )}
    </div>
    <div className="scope-modal__facet-chips">{children}</div>
  </div>
);

const FacetChip: React.FC<{
  on: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}> = ({ on, onClick, title, children }) => (
  <button
    className={`scope-modal__chip${on ? ' scope-modal__chip--on' : ''}`}
    onClick={onClick}
    title={title}
    aria-pressed={on}
  >
    {children}
  </button>
);
