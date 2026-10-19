import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Compass,
  Disc,
  FileVideo,
  Film,
  Globe,
  Layers,
  Loader2,
  Minus,
  Music,
  Package,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Tv,
  Video,
  X,
} from 'lucide-react';
import type { ProviderLoadProgress } from '../../../electron/pluginManager';
import { FlagIcon } from '../FlagIcon';
import { getLanguageFlag, getLanguageName } from '../../utils/languageFlag';
import { isWorthShowing, type ProviderHealth } from './providerHealth';
import {
  prettyType,
  stateOf,
  type CheckState,
  type ChosenSource,
  type Facets,
  type FacetSelection,
  type Row,
  type SelectionImpact,
} from './sourceScopeModel';

export type { CheckState, ChosenSource, Facets, FacetSelection, Row };

export interface PendingImpactConfirmation {
  actionName: string;
  actionDescription: string;
  impact: SelectionImpact;
}

function getContentTypeIcon(type: string): React.ReactNode {
  const norm = type.toLowerCase();
  if (norm.includes('animemovie') || (norm.includes('anime') && norm.includes('movie')))
    return <FileVideo size={12} />;
  if (norm.includes('ova')) return <Disc size={12} />;
  if (norm.includes('anime')) return <Sparkles size={12} />;
  if (norm.includes('movie') || norm.includes('film')) return <Film size={12} />;
  if (norm.includes('tv') || norm.includes('series')) return <Tv size={12} />;
  if (norm.includes('drama') || norm.includes('asian')) return <Clapperboard size={12} />;
  if (norm.includes('cartoon') || norm.includes('animation')) return <Smile size={12} />;
  if (norm.includes('documentary')) return <Compass size={12} />;
  if (norm.includes('live')) return <Video size={12} />;
  if (norm.includes('music')) return <Music size={12} />;
  if (norm.includes('torrent')) return <Radio size={12} />;
  if (norm.includes('book') || norm.includes('manga') || norm.includes('comic') || norm.includes('novel'))
    return <BookOpen size={12} />;
  if (norm.includes('nsfw') || norm.includes('adult')) return <ShieldAlert size={12} />;
  return <Layers size={12} />;
}

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

  const extCount = chosen.filter((c) => !c.isIndexer).length;
  const torrentCount = chosen.filter((c) => c.isIndexer).length;

  const hasOverflow = chosen.length > CHIP_COLLAPSE_THRESHOLD;
  const visible = expanded || !hasOverflow ? chosen : chosen.slice(0, CHIP_COLLAPSE_THRESHOLD);

  return (
    <div className="scope-modal__chosen-wrap">
      <div className="scope-modal__chosen-header">
        <span className="scope-modal__chosen-title">
          Selected sources ({chosen.length})
          <span className="scope-modal__chosen-breakdown">
            {' · '}
            {extCount > 0 && `${extCount} ext${extCount === 1 ? '' : 's'}`}
            {extCount > 0 && torrentCount > 0 && ' · '}
            {torrentCount > 0 && `${torrentCount} torrent${torrentCount === 1 ? '' : 's'}`}
          </span>
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
  onInvert?: () => void;
  canInvert?: boolean;

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

  pendingImpact?: PendingImpactConfirmation | null;
  onConfirmImpact?: () => void;
  onCancelImpact?: () => void;
  feedbackToast?: string | null;
  onDismissFeedback?: () => void;
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
  onInvert,
  canInvert,
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
  pendingImpact,
  onConfirmImpact,
  onCancelImpact,
  feedbackToast,
  onDismissFeedback,
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

  const [viewMode, setViewMode] = useState<'guided' | 'explorer'>('guided');
  const [explorerTab, setExplorerTab] = useState<'all' | 'selected' | 'excluded' | 'attention'>('all');

  // Filter rows based on explorerTab when in explorer mode
  const displayedRows = useMemo(() => {
    if (viewMode === 'guided') return rows;
    if (explorerTab === 'all') return rows;

    return rows.filter((row) => {
      if (row.kind === 'note') return false;
      const target = row.isIndexer ? indexers : providers;
      const state = stateOf(row.members, target);

      if (explorerTab === 'selected') {
        return state === 'on' || state === 'mixed';
      }
      if (explorerTab === 'excluded') {
        return state === 'off';
      }
      if (explorerTab === 'attention') {
        if (row.kind === 'leaf' && !row.isIndexer) {
          const health = healthFor?.(row.members[0]);
          return health?.level === 'poor' || health?.level === 'average';
        }
        return false;
      }
      return true;
    });
  }, [rows, viewMode, explorerTab, indexers, providers, healthFor]);

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
          <div className="scope-modal__head-left">
            {viewMode === 'explorer' && (
              <button
                type="button"
                className="scope-modal__back-btn"
                onClick={() => setViewMode('guided')}
                title="Back to guided source setup"
                aria-label="Back to guided setup"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <h2 id="scope-modal-title">
                {viewMode === 'guided' ? 'Search sources' : 'Customize sources'}
              </h2>
              <p className="scope-modal__subtitle">
                {totalChosen === 0
                  ? `All ${totalAvailable} sources enabled`
                  : `${totalChosen} of ${totalAvailable} sources selected`}
              </p>
            </div>
          </div>

          <div className="scope-modal__head-actions">
            {viewMode === 'guided' ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm scope-modal__nav-btn"
                onClick={() => setViewMode('explorer')}
                title="Open detailed provider explorer and repository tree"
              >
                <SlidersHorizontal size={13} />
                <span>Customize sources</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm scope-modal__nav-btn"
                onClick={() => setViewMode('guided')}
                title="Return to profile and quick setup"
              >
                <span>Quick setup</span>
              </button>
            )}
            <button
              className="scope-modal__close"
              onClick={onClose}
              aria-label="Close search sources"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {viewMode === 'guided' ? (
          /* ========================================================================= */
          /* Level 1: Guided Quick Setup View (Intent-Driven, Zero Overwhelm)          */
          /* ========================================================================= */
          <div className="scope-guided">
            {profileBar}

            <div className="scope-guided__body">
              {/* Region and Language Section */}
              <div className="scope-guided__section">
                <div className="scope-guided__section-header">
                  <Globe size={15} className="scope-guided__icon" />
                  <div>
                    <h4 className="scope-guided__section-title">Languages & Regions</h4>
                    <p className="scope-guided__section-desc">
                      Filter sources by preferred languages. Unselected languages remain untouched unless you customize them.
                    </p>
                  </div>
                </div>

                <div className="scope-guided__chips-grid">
                  {available.languages.map((lang) => {
                    const code = lang.toUpperCase();
                    const flag = getLanguageFlag(lang);
                    const fullName = getLanguageName(lang);
                    const active = facets.languages.has(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        className={`scope-guided__chip${active ? ' scope-guided__chip--active' : ''}`}
                        onClick={() => onToggleFacet('languages', lang)}
                        title={fullName ? `${fullName} (${code})` : code}
                      >
                        <FlagIcon flag={flag} size={15} fallback={code.slice(0, 2)} />
                        <span className="scope-guided__chip-label">{fullName || code}</span>
                        <span className="scope-guided__chip-code">{code}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Content Type Section */}
              {available.types.length > 0 && (
                <div className="scope-guided__section">
                  <div className="scope-guided__section-header">
                    <Layers size={15} className="scope-guided__icon" />
                    <div>
                      <h4 className="scope-guided__section-title">Content Types</h4>
                      <p className="scope-guided__section-desc">
                        Narrow by content categories. Selecting types will only search sources that offer them.
                      </p>
                    </div>
                  </div>

                  <div className="scope-guided__chips-grid">
                    {available.types.map((type) => {
                      const active = facets.types.has(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          className={`scope-guided__chip${active ? ' scope-guided__chip--active' : ''}`}
                          onClick={() => onToggleFacet('types', type)}
                          title={prettyType(type)}
                        >
                          {getContentTypeIcon(type)}
                          <span className="scope-guided__chip-label">{prettyType(type)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Sources Included Summary & Explorer Card */}
              <div className="scope-guided__summary-card">
                <div className="scope-guided__summary-info">
                  <div className="scope-guided__summary-title">
                    <Check size={16} className="scope-guided__check-icon" />
                    <span>
                      {totalChosen === 0
                        ? `All ${totalAvailable} sources ready for search`
                        : `${totalChosen} selected across ${totalAvailable} available`}
                    </span>
                  </div>
                  <p className="scope-guided__summary-sub">
                    Recommended sources are prioritized using live provider health & performance data.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm scope-guided__customize-btn"
                  onClick={() => setViewMode('explorer')}
                >
                  <SlidersHorizontal size={13} />
                  <span>Customize & explore sources</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* Level 2 & 3: Advanced Source Explorer View                                 */
          /* ========================================================================= */
          <div className="scope-modal__body">
            <aside className="scope-modal__rail" aria-label="Filters">
              <p className="scope-modal__rail-note">
                Filters control which sources are visible in the list below.
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
                      title={prettyType(type)}
                    >
                      {getContentTypeIcon(type)}
                      <span>{prettyType(type)}</span>
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
                  {available.languages.map((lang) => {
                    const code = lang.toUpperCase();
                    const flag = getLanguageFlag(lang);
                    const fullName = getLanguageName(lang);
                    const title = fullName ? `${fullName} (${code})` : code;
                    return (
                      <FacetChip
                        key={lang}
                        on={facets.languages.has(lang)}
                        onClick={() => onToggleFacet('languages', lang)}
                        title={title}
                      >
                        <FlagIcon flag={flag} size={13} fallback={code.slice(0, 2)} />
                        <span className="scope-modal__chip-code">{code}</span>
                      </FacetChip>
                    );
                  })}
                </FacetGroup>
              )}

              {facetsActive && (
                <button className="scope-modal__clear" onClick={onClearFacets}>
                  <RotateCcw size={12} /> Clear filters
                </button>
              )}
            </aside>

            <section className="scope-modal__main" aria-label="Sources">
              {/* Explorer Tabs: All Sources, Selected, Excluded, Needs Attention */}
              <div className="scope-explorer-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={`scope-explorer-tab${explorerTab === 'all' ? ' scope-explorer-tab--active' : ''}`}
                  onClick={() => setExplorerTab('all')}
                  aria-selected={explorerTab === 'all'}
                >
                  All sources ({totalAvailable})
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`scope-explorer-tab${explorerTab === 'selected' ? ' scope-explorer-tab--active' : ''}`}
                  onClick={() => setExplorerTab('selected')}
                  aria-selected={explorerTab === 'selected'}
                >
                  Selected ({totalChosen})
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`scope-explorer-tab${explorerTab === 'excluded' ? ' scope-explorer-tab--active' : ''}`}
                  onClick={() => setExplorerTab('excluded')}
                  aria-selected={explorerTab === 'excluded'}
                >
                  Excluded ({Math.max(0, totalAvailable - totalChosen)})
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`scope-explorer-tab${explorerTab === 'attention' ? ' scope-explorer-tab--active' : ''}`}
                  onClick={() => setExplorerTab('attention')}
                  aria-selected={explorerTab === 'attention'}
                  title="Sources reporting poor or unreliable performance"
                >
                  Needs attention
                </button>
              </div>

              <div className="scope-modal__search">
                <Search size={15} />
                <input
                  ref={searchField}
                  value={inputValue}
                  onChange={handleInputChange}
                  placeholder="Search providers, extensions, repositories… (Ctrl+F)"
                  aria-label="Filter the source list"
                  type="search"
                />
                {inputValue && (
                  <button onClick={handleInputClear} aria-label="Clear the source filter">
                    <X size={14} />
                  </button>
                )}
              </div>

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

              {!loading && displayedRows.length === 0 ? (
                <p className="scope-modal__empty">
                  {query.trim()
                    ? `Nothing matches “${query.trim()}”.`
                    : explorerTab === 'selected'
                      ? 'No sources are currently selected.'
                      : explorerTab === 'attention'
                        ? 'No sources currently report health issues or need attention.'
                        : facetsActive
                          ? 'No source matches these filters.'
                          : progress?.running
                            ? 'Loading the installed extensions…'
                            : 'No extension providers are installed. Add a repository in Extensions.'}
                </p>
              ) : (
                <>
                  <div className="scope-modal__tree-bar">
                    <span>{displayedRows.length} {displayedRows.length === 1 ? 'item' : 'items'}</span>
                    <div className="scope-modal__tree-controls">
                      <button
                        type="button"
                        className="scope-modal__tree-control-btn"
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
                      {hasIndexers && onToggleAllTorrents && (
                        <button
                          type="button"
                          className="scope-modal__tree-control-btn"
                          onClick={onToggleAllTorrents}
                          title={
                            (chosenTorrentCount ?? 0) > 0
                              ? 'Unselect all torrent sources'
                              : 'Select all torrent sources'
                          }
                        >
                          {(chosenTorrentCount ?? 0) > 0 ? 'Exclude torrents' : 'Include torrents'}
                        </button>
                      )}
                      {(onExpandAll || onCollapseAll) && (
                        <button
                          type="button"
                          className="scope-modal__tree-control-btn"
                          onClick={() => {
                            const allExpanded = displayedRows
                              .filter((r) => r.kind === 'repo' || r.kind === 'ext')
                              .every((r) => r.expanded);
                            if (allExpanded) {
                              onCollapseAll?.();
                            } else {
                              onExpandAll?.();
                            }
                          }}
                          title={
                            displayedRows
                              .filter((r) => r.kind === 'repo' || r.kind === 'ext')
                              .every((r) => r.expanded)
                              ? 'Collapse all sections'
                              : 'Expand all sections'
                          }
                        >
                          {displayedRows
                            .filter((r) => r.kind === 'repo' || r.kind === 'ext')
                            .every((r) => r.expanded)
                            ? 'Collapse all'
                            : 'Expand all'}
                        </button>
                      )}
                    </div>
                  </div>

                  <SourceVirtualTree
                    rows={displayedRows}
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
        )}

        <footer className="scope-modal__foot">
          <p id="scope-modal-summary" className="scope-modal__summary">
            {summary}
          </p>
          <div className="scope-modal__actions">
            {onInvert && (
              <button
                className="btn btn-ghost"
                onClick={onInvert}
                disabled={!canInvert}
                title={
                  canInvert
                    ? isFiltered
                      ? 'Flip the selection of the sources matching the filter'
                      : 'Flip the selection of every source'
                    : 'Inverting would leave nothing selected, which searches everything'
                }
              >
                Invert
              </button>
            )}
            <button className="btn btn-ghost" onClick={onReset} disabled={totalChosen === 0}>
              Reset
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>

        {feedbackToast && (
          <div className="scope-modal__feedback-toast" role="status" aria-live="polite">
            <Check size={14} className="scope-modal__feedback-icon" />
            <span>{feedbackToast}</span>
            {onDismissFeedback && (
              <button
                type="button"
                className="scope-modal__feedback-close"
                onClick={onDismissFeedback}
                aria-label="Dismiss notice"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {pendingImpact && (
          <div className="scope-confirm-backdrop" role="presentation">
            <div
              className="scope-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="scope-confirm-title"
              aria-describedby="scope-confirm-desc"
            >
              <div className="scope-confirm-dialog__head">
                <AlertTriangle size={18} className="scope-confirm-dialog__warn-icon" />
                <h3 id="scope-confirm-title">{pendingImpact.actionName}?</h3>
              </div>
              <div className="scope-confirm-dialog__body">
                <p id="scope-confirm-desc" className="scope-confirm-dialog__desc">
                  {pendingImpact.actionDescription}
                </p>

                <div className="scope-confirm-grid">
                  <div className="scope-confirm-card scope-confirm-card--removed">
                    <span className="scope-confirm-card__count">
                      -{pendingImpact.impact.totalRemoved}
                    </span>
                    <span className="scope-confirm-card__label">Removed</span>
                    {pendingImpact.impact.totalRemoved > 0 && (
                      <span className="scope-confirm-card__sub">
                        {pendingImpact.impact.removedProviders.length} ext ·{' '}
                        {pendingImpact.impact.removedIndexers.length} torrent
                      </span>
                    )}
                  </div>

                  <div className="scope-confirm-card scope-confirm-card--added">
                    <span className="scope-confirm-card__count">
                      +{pendingImpact.impact.totalAdded}
                    </span>
                    <span className="scope-confirm-card__label">Added</span>
                    {pendingImpact.impact.totalAdded > 0 && (
                      <span className="scope-confirm-card__sub">
                        {pendingImpact.impact.addedProviders.length} ext ·{' '}
                        {pendingImpact.impact.addedIndexers.length} torrent
                      </span>
                    )}
                  </div>

                  <div className="scope-confirm-card scope-confirm-card--unchanged">
                    <span className="scope-confirm-card__count">
                      {pendingImpact.impact.totalUnchanged}
                    </span>
                    <span className="scope-confirm-card__label">Unchanged</span>
                  </div>
                </div>
              </div>
              <div className="scope-confirm-dialog__foot">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onCancelImpact}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onConfirmImpact}
                >
                  Confirm changes
                </button>
              </div>
            </div>
          </div>
        )}
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
