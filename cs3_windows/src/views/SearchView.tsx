import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import type { SearchResponse } from '../types/api';
import { TYPE_TABS, matchesTab, tabsFor } from '../utils/contentTypes';
import { groupResults, type ResultGroup, type ResultGroupId } from '../utils/resultGroups';
import type { SearchSnapshot, SearchSourceOutcome } from '../../electron/searchSession';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Globe, Loader2, Search, SearchX, Target, X } from 'lucide-react';
import { PosterCard } from '../components/PosterCard';
import { FacetMenu, type FacetOption } from '../components/FacetMenu';
import { CopyErrorButton } from '../components/CopyErrorButton';
import { useTitleEnrichment } from '../components/useTitleEnrichment';

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
}

export interface SearchUiState {
  sourceFilter: string;
  typeTab: string;
  openGroups: Record<string, boolean>;
}

export const EMPTY_SEARCH_UI: SearchUiState = {
  sourceFilter: 'all',
  typeTab: 'all',
  openGroups: {},
};

/**
 * Which sources a row came from, counting each row once per source.
 *
 * A merged row can carry alternates — the same work found by three providers —
 * and all three should be able to filter to it, because all three are a real
 * route to that title.
 */
function sourcesOf(item: SearchResponse): string[] {
  const names = new Set<string>();
  if (item.apiName) names.add(item.apiName);
  for (const alternate of item.alternates ?? []) {
    if (alternate?.apiName) names.add(alternate.apiName);
  }
  return names.size > 0 ? [...names] : ['Unknown source'];
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
        {snapshot.lastSource && !snapshot.done && (
          <span className="search-progress__last">· {snapshot.lastSource} answered</span>
        )}
        {failed.length > 0 && (
          <span
            className="search-progress__failed"
            title={failed
              .map((outcome) => `${outcome.name}: ${outcome.error ?? 'failed'}`)
              .join('\n')}
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
}) => {
  const { sourceFilter, typeTab, openGroups } = ui;
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
      <header className="search-head">
        <div className="search-head__titles">
          <h2>{query ? `Search Results for "${query}"` : 'Search Media'}</h2>
          {/*
            Stated outright, always. The failure this prevents is the quiet one:
            believing you are searching one provider while the app searches
            everything, or the reverse — and only one of those is visible from
            the results themselves.
          */}
          <p className="search-head__scope">
            {scoped ? <Target size={12} /> : <Globe size={12} />}
            <span className="search-head__scope-label">Scope:</span>
            <span className={scoped ? 'search-head__scope-value--narrow' : undefined}>
              {scopeLabel}
            </span>
            <span className="search-head__dot">·</span>
            <span>
              {results.length} title{results.length === 1 ? '' : 's'} from{' '}
              {sourceOptions.length} source{sourceOptions.length === 1 ? '' : 's'}
            </span>
          </p>
        </div>

        {sourceOptions.length > 1 && (
          <FacetMenu
            label="Source"
            title="Show only titles from one source"
            value={sourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            allLabel={`All sources (${results.length})`}
          />
        )}
      </header>

      {/* Content-type tabs, directly under the header as on Android. */}
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

      {search && search.total > 0 && (search.settled < search.total || search.cancelled) && (
        <SourceProgress snapshot={search} onCancel={onCancel} />
      )}

      {error && (
        <div className="search-alert" role="alert">
          Search failed: {error}
        </div>
      )}

      {search?.scope.missingProviders.length || search?.scope.missingIndexers.length ? (
        <div className="search-alert search-alert--warn" role="status">
          <AlertTriangle size={14} />
          <span>
            {[...search.scope.missingProviders, ...search.scope.missingIndexers].join(', ')}{' '}
            {search.scope.missingProviders.length + search.scope.missingIndexers.length === 1
              ? 'is'
              : 'are'}{' '}
            selected in the search scope but is no longer installed or enabled.
          </span>
        </div>
      ) : null}

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

      {search?.done && !search.cancelled && filtered.length > 0 && <SourceSummary snapshot={search} />}
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
  return (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: '1.25rem',
    }}
  >
    {items.map((item, index) => {
      if (!item?.url) return null;
      return (
        <PosterCard
          key={`${item.url}-${index}`}
          item={item}
          onSelectMedia={onSelectMedia}
          onPlayDirectly={onPlayDirectly}
          outcome={outcomes[item.url]}
        />
      );
    })}
    </div>
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
const SourceSummary: React.FC<{ snapshot: SearchSnapshot }> = ({ snapshot }) => {
  const [open, setOpen] = useState(false);
  const ordered = [...snapshot.outcomes].sort((a, b) => b.count - a.count);
  const failed = ordered.filter((outcome) => outcome.state === 'failed').length;

  return (
    <details className="search-sources" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {snapshot.outcomes.length} source{snapshot.outcomes.length === 1 ? '' : 's'} asked
        {failed > 0 ? ` · ${failed} failed` : ''}
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
        : outcome.state === 'pending'
          ? 'not asked'
          : `${outcome.count} result${outcome.count === 1 ? '' : 's'}`}
    </span>
    {outcome.latencyMs !== undefined && (
      <span className="search-sources__latency">{Math.round(outcome.latencyMs / 100) / 10}s</span>
    )}
  </li>
);
