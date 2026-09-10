import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/**
 * "Search only these sources", as a room rather than a letterbox.
 *
 * The previous version of this was a 330px dropdown holding, in order: a
 * search field, a reset row, three unlabelled rows of chips meaning three
 * different things, a progress line, a 300px window onto a three-level tree of
 * several hundred 28px rows, two buttons and a sentence. Every one of those is
 * necessary. Stacked in a column the width of a button they were unreadable,
 * and the two most important distinctions in the whole control were invisible:
 *
 *  - **A filter is not a selection.** The chips narrow what the list *shows*;
 *    ticking a box narrows what the search *asks*. Rendered as adjacent rows of
 *    similar-looking pills, they read as one mechanism, and a user who filtered
 *    to "Hindi" reasonably believed they had scoped their search to Hindi
 *    providers. They had not. The two now live in different panes, under
 *    different headings, and the rail says so in as many words.
 *  - **Which facet a chip belongs to.** Twelve language chips beside six type
 *    chips beside two kind chips, separated by a hairline, is not a legible
 *    expression of "OR within a facet, AND across facets". Each facet is now a
 *    labelled group with its own count.
 *
 * Everything about *what the scope means* is unchanged and still decided by the
 * caller — this component renders rows and reports clicks. What is new here is
 * the shape of the room, and the keyboard: the tree is a real
 * `tree`/`treeitem` structure with roving focus through
 * `aria-activedescendant`, so several hundred sources are navigable without a
 * mouse and announced correctly, which a div full of buttons never was.
 */

const Box: React.FC<{ state: CheckState }> = ({ state }) => (
  <span className={`scope__box scope__box--${state}`} aria-hidden>
    {state === 'on' && <Check size={12} strokeWidth={3} />}
    {state === 'mixed' && <Minus size={12} strokeWidth={3} />}
  </span>
);

const ROW_HEIGHT = 34;
const OVERSCAN = 6;
/** Used until the scroller has been measured; replaced on the first layout. */
const ASSUMED_VIEWPORT = 460;

export interface SourceScopeDialogProps {
  rows: Row[];
  /** What exists to filter by, and what is filtered by right now. */
  available: Facets;
  facets: FacetSelection;
  facetsActive: boolean;
  onToggleFacet: (group: keyof FacetSelection, value: string) => void;
  onClearFacets: () => void;

  query: string;
  onQueryChange: (value: string) => void;

  providers: Set<string>;
  indexers: Set<string>;
  /** The current scope, resolved to display names, for the chip strip. */
  chosen: ChosenSource[];
  totalChosen: number;
  totalAvailable: number;
  /** Whether each kind exists at all; a filter for nothing is not offered. */
  hasExtensions: boolean;
  hasIndexers: boolean;

  progress: ProviderLoadProgress | null;
  loading: boolean;
  loaded: boolean;

  onToggleRow: (row: Row) => void;
  onToggleCollapse: (key: string) => void;
  onDeselect: (source: ChosenSource) => void;
  onSelectAll: () => void;
  onReset: () => void;
  onClose: () => void;
  /**
   * The profile bar, passed in already built.
   *
   * A node rather than the data and callbacks, because this component is
   * presentation over a source tree and the profile bar is presentation over a
   * different store entirely — threading six more props through here to reach
   * one row would make the dialog the owner of something it has nothing to say
   * about. `SearchScopePicker` owns all data and state; that is unchanged.
   */
  profileBar?: React.ReactNode;
}

export const SourceScopeDialog: React.FC<SourceScopeDialogProps> = ({
  rows,
  available,
  facets,
  facetsActive,
  onToggleFacet,
  onClearFacets,
  query,
  onQueryChange,
  providers,
  indexers,
  chosen,
  totalChosen,
  totalAvailable,
  hasExtensions,
  hasIndexers,
  progress,
  loading,
  loaded,
  onToggleRow,
  onToggleCollapse,
  onDeselect,
  onSelectAll,
  onReset,
  onClose,
  profileBar,
}) => {
  const dialog = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const searchField = useRef<HTMLInputElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(ASSUMED_VIEWPORT);
  /** The row arrow keys are on. Not a selection — that is the checkbox. */
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * Where the keyboard was before this opened.
   *
   * Captured on mount rather than passed in: whatever had focus is by
   * definition what should get it back, and a dialog that returns focus to
   * somewhere the user was not is worse than one that drops it entirely.
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    searchField.current?.focus();
    return () => returnFocusTo.current?.focus?.();
  }, []);

  /**
   * The window of rows to mount is a function of the real height.
   *
   * Measured rather than assumed, because the dialog is sized in viewport units
   * — a constant would either mount rows nobody can see on a laptop or leave a
   * blank band at the bottom of a large display.
   */
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport(element.clientHeight || ASSUMED_VIEWPORT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new result set is a new list; keeping the old cursor would land it on an
  // unrelated row, and keeping the old scroll position would open mid-list.
  useEffect(() => {
    setActiveIndex(0);
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [query]);

  const clampedActive = Math.min(activeIndex, Math.max(0, rows.length - 1));

  /** Keeps the row the keyboard is on inside the window that is mounted. */
  const revealRow = useCallback((index: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  }, []);

  /** Notes are labels, not stops: arrow keys pass over them. */
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

  /**
   * Tab stays inside, and Escape leaves.
   *
   * Both in capture phase on the dialog itself. The player binds Escape on
   * `window` and reads it as "leave playback", which is how a menu's Escape
   * came to end a film once before — a dialog that lets the key through is a
   * dialog that closes something else as well as itself.
   */
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

  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisible = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN
  );
  const windowed = rows.slice(firstVisible, lastVisible);

  const rowDomId = (row: Row) => `scope-row-${row.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const activeRow = rows[clampedActive];

  const summary = useMemo(() => {
    if (totalChosen === 0) {
      return 'Searching every enabled provider, catalogue and torrent source.';
    }
    if (totalChosen === 1) return 'Searching one source. Catalogue metadata is not consulted.';
    return `Searching ${totalChosen} sources. Catalogue metadata is not consulted.`;
  }, [totalChosen]);

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
          {/*
            Filters, in their own pane and under their own heading.

            The sentence at the top is load-bearing rather than decorative: the
            single most common misreading of the old control was that filtering
            to a language scoped the search to it. Saying which of the two
            mechanisms this pane is costs one line and removes the entire class
            of mistake.
          */}
          <aside className="scope-modal__rail" aria-label="Filters">
            <p className="scope-modal__rail-note">
              Filters change what this list shows. Ticking a source is what narrows the search.
            </p>

            {hasExtensions && hasIndexers && (
              <FacetGroup label="Kind">
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
              <FacetGroup label="Content type">
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
              <FacetGroup label="Language">
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
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Find a repository, extension or provider…"
                aria-label="Filter the source list"
                type="search"
              />
              {query && (
                <button onClick={() => onQueryChange('')} aria-label="Clear the source filter">
                  <X size={14} />
                </button>
              )}
            </div>

            {/*
              The default, stated as a choice rather than only as an absence.

              An empty selection and a fully-ticked one search the same sources
              today, but they age differently: this one follows whatever is
              installed, while ticking everything pins the set as it is now.

              Hidden when the profile bar is present, which offers the same
              choice one row above and — unlike this button — does not reach it
              by erasing the selection. Two controls that look alike and differ
              only in whether they destroy something is the worst version of
              this, so only one is on screen.
            */}
            {!profileBar && <button
              className={`scope-modal__all${totalChosen === 0 ? ' scope-modal__all--current' : ''}`}
              onClick={onReset}
              aria-pressed={totalChosen === 0}
            >
              <Box state={totalChosen === 0 ? 'on' : 'off'} />
              <Globe size={15} />
              <span className="scope-modal__all-label">
                All sources
                <span className="scope-modal__all-hint">
                  Follows whatever you have installed
                </span>
              </span>
              <span className="scope-modal__count">{totalAvailable}</span>
            </button>}

            {/*
              What is actually scoped, spelled out.

              A count in a header answers "how many" and never "which", and
              scrolling a tree of several hundred rows to find the four ticked
              boxes is not a reasonable way to answer it. Every chip removes its
              own source, which is also the only way to undo one selection
              without hunting for the row it came from.
            */}
            {chosen.length > 0 && (
              <div className="scope-modal__chosen" aria-label="Selected sources">
                {chosen.map((source) => (
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
              </div>
            )}

            {/*
              Progress with a number in it. "Loading extensions…" for four
              minutes is indistinguishable from a hang, and that is how long
              this takes on a freshly bootstrapped install.
            */}
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
              <div
                className="scope-modal__tree"
                ref={scroller}
                role="tree"
                aria-label="Sources to search"
                aria-multiselectable="true"
                aria-activedescendant={activeRow ? rowDomId(activeRow) : undefined}
                tabIndex={0}
                onKeyDown={onTreeKeyDown}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
                  <div style={{ transform: `translateY(${firstVisible * ROW_HEIGHT}px)` }}>
                    {windowed.map((row, offset) => {
                      const index = firstVisible + offset;
                      if (row.kind === 'note') {
                        return (
                          <p
                            key={row.key}
                            className="scope-modal__note"
                            style={{ height: ROW_HEIGHT }}
                          >
                            {row.label}
                          </p>
                        );
                      }

                      const selected = row.isIndexer ? indexers : providers;
                      const state = stateOf(row.members, selected);

                      return (
                        <div
                          key={row.key}
                          id={rowDomId(row)}
                          role="treeitem"
                          aria-level={row.depth + 1}
                          aria-expanded={row.expanded}
                          aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
                          aria-disabled={row.members.length === 0 || undefined}
                          className={[
                            'scope-modal__row',
                            `scope-modal__row--${row.kind}`,
                            `scope-modal__row--d${row.depth}`,
                            index === clampedActive ? 'scope-modal__row--active' : '',
                            state !== 'off' ? 'scope-modal__row--on' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          style={{ height: ROW_HEIGHT }}
                          title={row.title}
                          onMouseDown={() => setActiveIndex(index)}
                        >
                          {row.expanded !== undefined ? (
                            <button
                              className="scope-modal__twisty"
                              onClick={() => onToggleCollapse(row.key)}
                              aria-label={`${row.expanded ? 'Collapse' : 'Expand'} ${row.label}`}
                              tabIndex={-1}
                            >
                              {row.expanded ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
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
                            {row.lang && (
                              <span className="scope-modal__lang">{row.lang.toUpperCase()}</span>
                            )}
                            {row.members.length > 1 && (
                              <span className="scope-modal__count">{row.members.length}</span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
              onClick={onSelectAll}
              disabled={totalAvailable === 0}
              title="Tick every source as it is right now, rather than following what is installed"
            >
              Select all
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

const FacetGroup: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="scope-modal__facet" role="group" aria-label={label}>
    <h3>{label}</h3>
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
