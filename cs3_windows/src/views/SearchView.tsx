import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitleInteractions } from '../components/useTitleInteractions';
import { EmptyState } from '../components/EmptyState';
import type { SearchResponse } from '../types/api';
import { TYPE_TABS, matchesTab, tabsFor } from '../utils/contentTypes';
import { groupResults, type ResultGroup, type ResultGroupId } from '../utils/resultGroups';
import type { SearchSnapshot, SearchSourceOutcome } from '../../electron/searchSession';
import { AlertTriangle, Bookmark, BookmarkCheck, CheckCircle2, ChevronDown, ChevronRight, Filter, Loader2, MoreHorizontal, RotateCw, Search, SearchX, Server, Target, Trash2, Wrench, X } from 'lucide-react';
import { PosterCard } from '../components/PosterCard';
import { partitionDeadRows } from '../utils/deadRows';
import { resultSources } from '../utils/resultSources';
import { FacetMenu, type FacetOption } from '../components/FacetMenu';
import { CopyErrorButton } from '../components/CopyErrorButton';
import { FixProvidersModal } from '../components/FixProvidersModal';
import { useTitleEnrichment } from '../components/useTitleEnrichment';
import { useReveal } from '../utils/ExperienceModeContext';
import { plainMessage } from '../utils/experienceMode';
import { type SearchUiState } from './searchUiState';
import { Button, Menu } from '../components/ui';

interface SearchViewProps {
  query: string;
  /** The live search, or null before the first one has been started. */
  search: SearchSnapshot | null;
  onSelectMedia: (item: SearchResponse) => void;
  /** Quick-play from the card, bypassing the detail page. */
  onPlayDirectly?: (item: SearchResponse) => void;
  /** Abandons the running search, keeping what it has already found. */
  onCancel?: () => void;
  /** Surfaced when the search itself failed, so the user sees a cause not an empty grid. */
  error?: string | null;
  /**
   * Filters and disclosure state, held by the parent.
   *
   * Opening a title unmounts this view — the detail page replaces it inside the
   * same scroll container — so anything kept in local state is gone by the time
   * the viewer presses Back. Which filter they had picked and which groups they
   * had opened are decisions, and asking someone to make them again because
   * they looked at a poster is the kind of thing that makes an app tiring.
   */
  ui: SearchUiState;
  onUiChange: (next: SearchUiState) => void;
  /**
   * Re-run this query against every source, dropping the scope.
   *
   * Offered only when a scoped search found nothing, which is exactly when the
   * sentence above has just said the chosen providers had none of it. Without
   * this the empty screen names a cause and offers no way to act on it.
   */
  onSearchAllSources?: () => void;
  /**
   * Re-runs the current query unchanged.
   *
   * Used after sources are switched back on: the scope report travels inside a
   * search snapshot, so until the query runs again the warning still names
   * providers that now work — which reads as the fix having failed.
   */
  onRetry?: () => void;
  /**
   * Set when the results on screen are a saved copy rather than a live search.
   *
   * The screen then says so, with the date, and offers to search again —
   * saved results that looked live would be exactly the stale list that
   * search history deliberately never keeps.
   */
  savedView?: { id: string; savedAt: number } | null;
  /** Keeps these results to reopen from the Library or the search box. */
  onSaveResults?: () => Promise<boolean>;
  /** Clears active search results and returns view to clean state. */
  onClearResults?: () => void;
}

/** "3 Sep 2026, 14:05" — a date a person reads, not a relative age that drifts. */
function savedDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Save, then Saved — at any point, not only once the slowest source answers.
 *
 * With hundreds of providers a search can run for a minute while the rows the
 * viewer wanted arrived in the first five seconds; making them wait for the
 * last scraper before they could keep the list was waiting for nothing. A
 * save while results are still arriving keeps what is there, and the button
 * offers to update the saved copy once more have come in. Saving the same
 * query again updates the stored copy rather than adding a second one.
 */
const SaveResultsButton: React.FC<{
  searchId: string;
  count: number;
  onSave: () => Promise<boolean>;
}> = ({ searchId, count, onSave }) => {
  const [state, setState] = useState<{ id: string; phase: 'saving' | 'saved'; count: number } | null>(null);
  const mine = state?.id === searchId ? state : null;
  const stale = mine?.phase === 'saved' && count > mine.count;
  const saved = mine?.phase === 'saved' && !stale;
  return (
    <Button
      size="compact"
      variant="ambient"
      icon={saved ? BookmarkCheck : Bookmark}
      loading={mine?.phase === 'saving'}
      className={saved ? 'search-toolbar__saved' : undefined}
      title={
        stale
          ? `${count - (mine?.count ?? 0)} more since you saved — update the saved copy`
          : 'Keep these results to come back to — they appear in the Library and under the search box'
      }
      onClick={async () => {
        setState({ id: searchId, phase: 'saving', count });
        const ok = await onSave();
        setState(ok ? { id: searchId, phase: 'saved', count } : null);
      }}
    >
      {saved ? 'Saved' : stale ? 'Update saved' : 'Save'}
    </Button>
  );
};


/** Clearing the screen is rare and should not sit beside Save at full size. */
const MoreActions: React.FC<{ onClearResults: () => void }> = ({ onClearResults }) => (
  <Menu
    label="More search actions"
    trigger={(props) => (
      <Button {...props} size="compact" variant="ambient" iconOnly icon={MoreHorizontal} aria-label="More" title="More" />
    )}
    items={[
      {
        label: 'Clear results',
        description: 'Empty this screen. Search history and saved searches are kept.',
        icon: Trash2,
        onSelect: onClearResults,
      },
    ]}
  />
);

/** A row's sources for the Source filter, never empty so every row can be filtered to. */
function sourcesOf(item: SearchResponse): string[] {
  const names = resultSources(item);
  return names.length > 0 ? names : ['Unknown source'];
}

/** "MegaRepo > Extension A" style scope line, kept to one line. */
function describeScope(snapshot: SearchSnapshot | null): string {
  if (!snapshot || !snapshot.scope.active) return 'All sources';
  const names = [...snapshot.scope.providers, ...snapshot.scope.indexers];
  if (names.length === 0) return 'No available sources selected';
  if (names.length <= 3) return names.join(' · ');
  return `${names.slice(0, 3).join(' · ')} +${names.length - 3} more`;
}

const SourceProgress: React.FC<{ snapshot: SearchSnapshot; onCancel?: () => void }> = ({
  snapshot,
  onCancel,
}) => {
  /**
   * The bar, the count and the failure tally are for everyone — they are what
   * says the app is working rather than stuck, and a search that quietly asked
   * fewer sources than it claims is the worst failure this app has.
   *
   * What is held back is the attribution: which source answered last, and the
   * exception text behind each failure. Both name third-party code by its own
   * internal vocabulary, and neither is something a viewer waiting on a list of
   * films can act on.
   */
  const technical = useReveal('technical');
  const percent = snapshot.total === 0 ? 0 : Math.round((snapshot.settled / snapshot.total) * 100);
  const failed = snapshot.outcomes.filter((outcome) => outcome.state === 'failed');

  return (
    <div className="search-progress">
      <div className="search-progress__bar" role="progressbar" aria-valuenow={percent}>
        <div className="search-progress__fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="search-progress__line">
        {!snapshot.done && <Loader2 size={12} className="spin" />}
        <span>
          {snapshot.settled} of {snapshot.total} source{snapshot.total === 1 ? '' : 's'}
        </span>
        {technical && snapshot.lastSource && !snapshot.done && (
          <span className="search-progress__last">· {snapshot.lastSource} answered</span>
        )}
        {failed.length > 0 && (
          <span
            className="search-progress__failed"
            title={
              technical
                ? failed.map((outcome) => `${outcome.name}: ${outcome.error ?? 'failed'}`).join('\n')
                : `${failed.length} of the places searched could not be reached. The rest still answered.`
            }
          >
            <AlertTriangle size={11} /> {failed.length} failed
          </span>
        )}
        {snapshot.cancelled && <span className="search-progress__last">· cancelled</span>}

        {!snapshot.done && onCancel && (
          <button className="search-progress__cancel" onClick={onCancel}>
            <X size={11} /> Stop
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * A search that did not run, said once and kept in full.
 *
 * The banner used to read `Search failed: ` followed by whatever threw, which
 * on the common causes is a sentence about our own machinery — a DNS failure,
 * an aborted fan-out, a sidecar that had not started. `plainMessage` turns that
 * into something a viewer can act on and keeps the original in `detail`, so
 * nothing is lost: developer mode opens with it showing, and standard mode has
 * it one click away for a bug report.
 */
const SearchFailure: React.FC<{ message: string }> = ({ message }) => {
  const technical = useReveal('technical');
  const plain = plainMessage(message);
  const hasDetail = plain.detail !== '' && plain.detail !== plain.summary;
  const [showDetail, setShowDetail] = useState(false);
  const detailOpen = technical || showDetail;

  return (
    <div className="search-alert" role="alert">
      <AlertTriangle size={14} />
      <span>{plain.summary}</span>
      {hasDetail && !detailOpen && (
        <button
          type="button"
          className="search-alert__action"
          onClick={() => setShowDetail(true)}
        >
          Show details
        </button>
      )}
      {hasDetail && detailOpen && (
        <code className="search-alert__detail">{plain.detail}</code>
      )}
    </div>
  );
};

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  search,
  onSelectMedia,
  onPlayDirectly,
  onCancel,
  error,
  ui,
  onUiChange,
  onSearchAllSources,
  onRetry,
  savedView,
  onSaveResults,
  onClearResults,
}) => {
  const { sourceFilter, typeTab, openGroups } = ui;
  /** The provider names the fix modal is open for, or null when it is closed. */
  const [fixing, setFixing] = useState<string[] | null>(null);
  const missingCount =
    (search?.scope.missingProviders.length ?? 0) + (search?.scope.missingIndexers.length ?? 0);
  const setSourceFilter = (value: string) => onUiChange({ ...ui, sourceFilter: value });
  const setTypeTab = (value: string) => onUiChange({ ...ui, typeTab: value });

  const onToggleGroup = useCallback(
    (id: ResultGroupId) => {
      const fallback = id !== 'other';
      onUiChange({
        ...ui,
        openGroups: { ...ui.openGroups, [id]: !(ui.openGroups[id] ?? fallback) },
      });
    },
    [ui, onUiChange]
  );

  /**
   * Results, with release names replaced by the titles they are about.
   *
   * Applied as a display transform over whatever the latest snapshot holds, so
   * rows appear immediately under the provider's own name and are rewritten a
   * moment later. Grouping, filtering and the type tabs all run on the enriched
   * names, which is the point: `Avengers.Endgame.2019.1080p.BluRay` and
   * `Avengers End Game 720p Hindi` cannot be grouped as one title until they
   * are both called *Avengers: Endgame*.
   */
  const results = useTitleEnrichment(search?.results ?? []);

  /**
   * Tabs that would actually leave something, with counts.
   *
   * Only shown when the results span more than one — a search that returned
   * nothing but films does not need a row of tabs to say so, and offering tabs
   * that lead to an empty grid is worse than offering none.
   */
  const typeTabs = useMemo(() => tabsFor(results), [results]);

  // A tab that stops matching as results stream in must not strand the grid.
  const activeTab = typeTabs.some((tab) => tab.id === typeTab) ? typeTab : 'all';

  /**
   * Source options, with the count each would leave.
   *
   * Rebuilt as results stream in, so the list grows with the search rather than
   * appearing only once it finishes.
   */
  const sourceOptions = useMemo<FacetOption[]>(() => {
    const counts = new Map<string, number>();
    for (const item of results) {
      for (const name of sourcesOf(item)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [results]);

  const filtered = useMemo(
    () =>
      results.filter((item) => {
        if (sourceFilter !== 'all' && !sourcesOf(item).includes(sourceFilter)) return false;
        return matchesTab(item, activeTab);
      }),
    [results, sourceFilter, activeTab]
  );

  /**
   * What the viewer asked for, what is nearby, and what the sources volunteered.
   *
   * Grouped after filtering so the counts on each heading describe what is
   * actually on screen rather than what would be there without the tabs.
   */
  const groups = useMemo(() => groupResults(filtered, query), [filtered, query]);

  const running = Boolean(search && !search.done);
  const scopeLabel = describeScope(search);
  const scoped = Boolean(search?.scope.active);

  /*
   * The per-source breakdown lives under the results, closed. "from 12
   * sources" in the header opens it and brings it into view, so the one place
   * that says which providers answered is reachable from where people look.
   */
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesRef = useRef<HTMLDetailsElement | null>(null);
  const showSourceSummary = Boolean(search?.done && !search.cancelled && !savedView && filtered.length > 0);
  const revealSources = () => {
    setSourcesOpen(true);
    requestAnimationFrame(() =>
      sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    );
  };

  // Nothing has arrived yet and nothing has been asked: the only state where a
  // full-page spinner is right, because there is genuinely nothing to show.
  if (running && results.length === 0 && (search?.settled ?? 0) === 0) {
    return (
      <div className="search-boot">
        <div className="search-boot__ring">
          <Loader2 size={28} className="spin" />
        </div>
        <h3>{query ? `Searching for "${query}"…` : 'Searching…'}</h3>
        <p>
          Asking {search?.total ?? 0} source{search?.total === 1 ? '' : 's'} · results appear as
          each one answers
        </p>
        {onCancel && (
          <button className="btn btn-secondary" onClick={onCancel}>
            <X size={14} /> Stop
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/*
        One quiet toolbar instead of a heading, a scope paragraph and three
        buttons. The query is already in the search box, so "Search Results for
        …" said nothing; what is left is what a viewer acts on — the type tabs,
        the source filter, Save — and, small and muted, what was searched and
        how many answered. The scope line stays (searching fewer sources than
        you think is this app's worst failure) but no longer shouts.
      */}
      <h2 className="sr-only">{query ? `Results for ${query}` : 'Search'}</h2>
      <div className="search-toolbar">
        <div className="search-toolbar__start">
          {typeTabs.length > 1 && (
            <div className="type-tabs" role="tablist" aria-label="Filter by content type">
              <button
                role="tab"
                aria-selected={activeTab === 'all'}
                className={`type-tabs__tab${activeTab === 'all' ? ' type-tabs__tab--on' : ''}`}
                onClick={() => setTypeTab('all')}
              >
                All <span>{results.length}</span>
              </button>
              {typeTabs.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`type-tabs__tab${activeTab === tab.id ? ' type-tabs__tab--on' : ''}`}
                  onClick={() => setTypeTab(tab.id)}
                >
                  {tab.label} <span>{tab.count}</span>
                </button>
              ))}
            </div>
          )}
          <p className="search-toolbar__meta">
            {scoped && (
              <span className="search-toolbar__scope" title={`Searching only: ${scopeLabel}`}>
                <Target size={11} aria-hidden /> {scopeLabel}
              </span>
            )}
            <span>
              {results.length} title{results.length === 1 ? '' : 's'}
              {sourceOptions.length > 0 && (
                <>
                  {' · '}
                  {showSourceSummary ? (
                    <button
                      type="button"
                      className="search-head__sources-link"
                      onClick={revealSources}
                      title="See what each source returned"
                    >
                      {sourceOptions.length} source{sourceOptions.length === 1 ? '' : 's'}
                    </button>
                  ) : (
                    `${sourceOptions.length} source${sourceOptions.length === 1 ? '' : 's'}`
                  )}
                </>
              )}
            </span>
          </p>
        </div>

        <div className="search-toolbar__actions">
          {sourceOptions.length > 1 && (
            <FacetMenu
              label="Source"
              icon={<Filter size={12} aria-hidden />}
              title="Show only titles from one source"
              value={sourceFilter}
              options={sourceOptions}
              onChange={setSourceFilter}
              allLabel={`All sources (${results.length})`}
            />
          )}
          {search && !savedView && results.length > 0 && onSaveResults ? (
            <SaveResultsButton searchId={search.id} count={results.length} onSave={onSaveResults} />
          ) : null}
          {results.length > 0 && onClearResults && (
            <MoreActions onClearResults={onClearResults} />
          )}
        </div>
      </div>

      {savedView ? (
        <div className="search-alert search-alert--saved" role="status">
          <BookmarkCheck size={14} />
          <span>
            Saved results from {savedDate(savedView.savedAt)}. Titles may have changed since.
          </span>
          {onRetry ? (
            <button type="button" className="search-alert__action" onClick={onRetry}>
              <RotateCw size={13} /> Search again
            </button>
          ) : null}
        </div>
      ) : null}

      {search && search.total > 0 && (search.settled < search.total || search.cancelled) && (
        <SourceProgress snapshot={search} onCancel={onCancel} />
      )}

      {error && <SearchFailure message={error} />}

      {search?.scope.missingProviders.length || search?.scope.missingIndexers.length ? (
        <div className="search-alert search-alert--warn" role="status">
          <AlertTriangle size={14} />
          <span>
            {/*
              * The names are summarised rather than listed. This warning was
              * reported carrying *seventy* of them, which is a paragraph of
              * provider names where a sentence and a button belong — and the
              * full list is one click away in the modal, grouped by what each
              * one actually needs.
              */}
            {missingCount === 1
              ? `${[...search.scope.missingProviders, ...search.scope.missingIndexers][0]} is`
              : `${missingCount} selected sources are`}{' '}
            no longer installed or enabled.
          </span>
          {search.scope.missingProviders.length > 0 && (
            <button
              type="button"
              className="search-alert__action"
              onClick={() => setFixing(search.scope.missingProviders)}
            >
              <Wrench size={13} /> Fix
            </button>
          )}
        </div>
      ) : null}

      {fixing && (
        <FixProvidersModal
          providers={fixing}
          onClose={() => setFixing(null)}
          onFixed={() => {
            /*
             * Re-run rather than merely closing. The scope report is part of a
             * search snapshot, so until the query runs again the warning still
             * names providers that now work — which reads as the fix having
             * failed.
             */
            setFixing(null);
            onRetry?.();
          }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="search-empty">
          {sourceFilter !== 'all' || activeTab !== 'all' ? (
            <>
              <p>
                Nothing matched
                {activeTab !== 'all'
                  ? ` in ${TYPE_TABS.find((t) => t.id === activeTab)?.label ?? activeTab}`
                  : ''}
                {sourceFilter !== 'all' ? ` from ${sourceFilter}` : ''}.
              </p>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSourceFilter('all');
                  setTypeTab('all');
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            /*
              The reason, plus the one action that can change it.
              `canWiden` means this title came from a scoped set of providers —
              the sentence above has just said those had nothing, so offering to
              ask the rest is the only useful next move, and it existed already
              with no way to reach it from here.
            */
            <EmptyState
              icon={SearchX}
              title={running ? 'Still looking…' : 'Nothing found'}
              description={
                search?.emptyReason ??
                (running
                  ? 'The first sources are still answering. Results appear as each one replies.'
                  : 'No provider had this title. Try a shorter query, or search every source.')
              }
              action={
                !running && onSearchAllSources
                  ? { label: 'Search all sources', onClick: onSearchAllSources }
                  : undefined
              }
            />
          )}
        </div>
      ) : (
        <ResultGrid
          groups={groups}
          openGroups={openGroups}
          onToggleGroup={onToggleGroup}
          onSelectMedia={onSelectMedia}
          onPlayDirectly={onPlayDirectly}
        />
      )}

      {search && showSourceSummary && (
        <SourceSummary
          snapshot={search}
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          anchorRef={sourcesRef}
        />
      )}
    </div>
  );
};

/**
 * The three groups, each with its own disclosure.
 *
 * `openGroups` is lifted to the parent rather than held here so that leaving for
 * a title and coming back does not silently re-collapse what the viewer opened.
 */
const ResultGrid: React.FC<{
  groups: ResultGroup[];
  openGroups: Record<string, boolean>;
  onToggleGroup: (id: ResultGroupId) => void;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
}> = ({ groups, openGroups, onToggleGroup, onSelectMedia, onPlayDirectly }) => {
  // One group and nothing to separate it from: a heading over the only thing on
  // screen is a label for the obvious.
  if (groups.length === 1) {
    return <Grid items={groups[0].items} onSelectMedia={onSelectMedia} onPlayDirectly={onPlayDirectly} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {groups.map((group) => {
        const open = openGroups[group.id] ?? group.defaultOpen;
        return (
          <section key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="search-section">
              <button
                className="search-group__toggle"
                onClick={() => onToggleGroup(group.id)}
                aria-expanded={open}
                aria-controls={`group-${group.id}`}
              >
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {group.id === 'chosen' ? (
                  <CheckCircle2 size={16} style={{ color: 'var(--accent-light)' }} />
                ) : (
                  <Search size={15} style={{ color: 'var(--text-subtle)' }} />
                )}
                <h3 className={group.id === 'other' ? 'search-section__muted' : undefined}>
                  {group.label}
                </h3>
                <span className="search-group__count">{group.items.length}</span>
              </button>

              {group.id === 'chosen' && (
                <span className="chip search-section__chip">Chosen from suggestions</span>
              )}
              {group.id === 'other' && open && (
                <span className="search-group__note">
                  These sources returned this without matching what you typed.
                </span>
              )}
            </div>

            {open && (
              <div id={`group-${group.id}`}>
                <Grid
                  items={group.items}
                  onSelectMedia={onSelectMedia}
                  onPlayDirectly={onPlayDirectly}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

const Grid: React.FC<{
  items: SearchResponse[];
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
}> = ({ items, onSelectMedia, onPlayDirectly }) => {
  const outcomes = useTitleOutcomes();
  /**
   * Card states for every row on screen.
   *
   * `outcomes` above is still read, because `partitionDeadRows` needs the raw
   * verdict to decide what to *hide* — a different question from what to badge,
   * and one that has to be answered before this list exists.
   */
  const { interactionFor } = useTitleInteractions(items);
  /**
   * Per mount, not persisted.
   *
   * "Show me the dead ones too" is a decision about this search, not a
   * preference — and a stored one would leave someone permanently looking at
   * rows they asked to see once, with nothing on screen saying why the page got
   * longer.
   */
  const [showDead, setShowDead] = useState(false);
  const { visible, hidden } = partitionDeadRows(items, outcomes, {
    hideDeadRows: !showDead,
  });
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {visible.map((item, index) => (
          <PosterCard
            key={`${item.url}-${index}`}
            item={item}
            onSelectMedia={onSelectMedia}
            onPlayDirectly={onPlayDirectly}
            interaction={interactionFor(item)}
          />
        ))}
      </div>

      {/*
        Says what is being held back, and offers it.

        A results page quietly shorter than the search found is
        indistinguishable from a search that found less — which is the same
        complaint this filter exists to answer, arriving from the other
        direction. So the count is stated and the rows are one click away.
      */}
      {hidden.length > 0 && (
        <button type="button" className="search-dead-rows" onClick={() => setShowDead(true)}>
          {hidden.length} result{hidden.length === 1 ? '' : 's'} hidden — {' '}
          {hidden.length === 1 ? 'it had' : 'they had'} no playable source last time. Show{' '}
          {hidden.length === 1 ? 'it' : 'them'} anyway
        </button>
      )}
    </>
  );
};

/**
 * Last-time outcomes for every title, fetched once per mount.
 *
 * Per-card lookups would be one IPC round trip per poster on screen; the whole
 * map is small and the grid needs most of it anyway.
 */
function useTitleOutcomes(): Record<string, { kind: 'played' | 'no-sources' | 'app-error'; reason?: string }> {
  const [outcomes, setOutcomes] = useState<
    Record<string, { kind: 'played' | 'no-sources' | 'app-error'; reason?: string }>
  >({});
  useEffect(() => {
    window.cloudstream?.getTitleOutcomes?.().then((value) => setOutcomes(value ?? {}));
  }, []);
  return outcomes;
}

/**
 * What each source actually contributed, once the search is over.
 *
 * Collapsed by default: it is the answer to "why is my provider not in here",
 * which is worth being able to reach and not worth spending a screen on.
 */
const SourceSummary: React.FC<{
  snapshot: SearchSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLDetailsElement | null>;
}> = ({ snapshot, open, onOpenChange, anchorRef }) => {
  const ordered = [...snapshot.outcomes].sort((a, b) => b.count - a.count);
  const failed = ordered.filter((outcome) => outcome.state === 'failed').length;
  const answered = ordered.filter((outcome) => outcome.count > 0).length;
  /**
   * Counted, but never as failures.
   *
   * A catalogue-only provider answering "does not implement that operation" is
   * working exactly as designed. It used to be tallied beside a timed-out
   * scraper, so a search that found what it was looking for reported "4 failed"
   * and read as broken.
   */
  const unsupported = ordered.filter((outcome) => outcome.state === 'unsupported').length;

  return (
    <details
      ref={anchorRef}
      className="search-sources"
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      {/* A labelled band rather than a line of grey text: this is where the
          viewer finds out which providers had the title, and as a bare
          `<summary>` under the grid it was read as a footer and skipped. */}
      <summary className="search-sources__summary">
        <Server size={13} className="search-sources__icon" aria-hidden />
        <span className="search-sources__label">Sources</span>
        <span className="search-sources__stat">
          {snapshot.outcomes.length} asked
        </span>
        <span className="search-sources__stat search-sources__stat--ok">
          {answered} with results
        </span>
        {failed > 0 && (
          <span className="search-sources__stat search-sources__stat--failed">{failed} failed</span>
        )}
        {unsupported > 0 && <span className="search-sources__stat">{unsupported} browse only</span>}
        <span className="search-sources__toggle">
          {open ? 'Hide' : 'Show'} details
          <ChevronDown size={13} className={open ? 'search-sources__chevron--open' : undefined} />
        </span>
      </summary>
      {failed > 0 && (
        <div className="search-sources__copy">
          <CopyErrorButton
            compact
            label="Copy these failures"
            context={{
              query: snapshot.query,
              message: ordered
                .filter((outcome) => outcome.state === 'failed')
                .map((outcome) => `${outcome.name}: ${outcome.error ?? 'failed'}`)
                .join(' · '),
            }}
          />
        </div>
      )}
      <ul>
        {ordered.map((outcome) => (
          <SourceRow key={`${outcome.kind}:${outcome.id}`} outcome={outcome} />
        ))}
      </ul>
    </details>
  );
};

const SourceRow: React.FC<{ outcome: SearchSourceOutcome }> = ({ outcome }) => (
  <li className={`search-sources__row search-sources__row--${outcome.state}`}>
    <span className="search-sources__name">{outcome.name}</span>
    <span className="search-sources__kind">{outcome.kind}</span>
    <span className="search-sources__detail">
      {outcome.state === 'failed'
        ? (outcome.error ?? 'failed')
        : outcome.state === 'unsupported'
          ? // Its own sentence, not the provider's exception text. "This
            // provider does not implement that operation" is a stack-trace
            // phrase for a browse-only catalogue, which is an ordinary thing
            // to be.
            'Browse only — this source has no search'
          : outcome.state === 'pending'
            ? 'not asked'
            : `${outcome.count} result${outcome.count === 1 ? '' : 's'}`}
    </span>
    {outcome.latencyMs !== undefined && (
      <span className="search-sources__latency">{Math.round(outcome.latencyMs / 100) / 10}s</span>
    )}
  </li>
);
