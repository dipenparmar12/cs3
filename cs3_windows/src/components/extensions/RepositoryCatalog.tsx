/**
 * What could be added: the verified catalogue, plus any URL the user has.
 *
 * `verified` is load-bearing rather than reassuring. The catalogue previously
 * assumed every repository lived under one organisation on a `builds` branch;
 * 23 of 26 entries were wrong and returned 404. So an unverified row is labelled
 * unverified rather than silently offered as if it worked.
 *
 * ## Three actions, because they cost differently
 *
 * This file used to carry a note explaining that there was deliberately no
 * "Add" button, since the main process had no standalone concept of adding a
 * repository — a URL joined the installed set only when an extension was
 * installed *from* it, so an Add button would have created a row that vanished
 * on the next read. That was true, and it described a gap rather than a
 * decision: of 29 catalogued repositories only the 4 bundled ones ever appeared
 * in a user's list, and reaching any other meant keeping its URL somewhere
 * outside the app.
 *
 * `addRepository` closes it, and the three actions stay separate because their
 * costs are not comparable:
 *
 * | Action | Cost | Reversible |
 * |---|---|---|
 * | **Browse** | one fetch | nothing to reverse |
 * | **Add** | one fetch, then the row persists | yes, Remove |
 * | **Install all** | tens of downloads and DEX translations | uninstalls them |
 *
 * Folding Add into Browse would commit someone who wanted a look; folding
 * Install into Add would commit them to a catalogue. Install-all is styled as
 * the heavier action and says how many extensions it is about to fetch.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { Badge, ExternalLink, ProgressBar } from './primitives';
import { matchesQuery, type FilterState } from './useExtensionFilters';
import type { ProviderTreeRepository } from '../../types/plugin';
import type { OfficialRepository } from './useExtensionCatalog';
import type { ExtensionJob, RepositoryJobsSummary } from './useExtensionJobs';
import { Button, SearchInput } from '../ui';

interface RepositoryCatalogProps {
  official: OfficialRepository[];
  installed: string[];
  adultAllowed: boolean;
  filters: FilterState;
  /** The key of a removal in progress; Add and Install all are queued jobs. */
  busy: string | null;
  /** The queue's job for a target (`repo:<url>`, `repo-add:<url>`), if any. */
  jobFor(target: string): ExtensionJob | null;
  /** Active and finished jobs belonging to a repository and its extensions. */
  jobsForRepository?(urls: { url?: string; rawRepoUrl?: string } | string): RepositoryJobsSummary;
  /**
   * The installed tree, so a search can reach *through* a repository.
   *
   * The query used to match a repository's own name, description, language and
   * shortcode and nothing else — so looking for a provider you know you have
   * ("VegaMovies") found nothing here, even though the repository carrying it
   * was on screen. The thing a user searches for is usually the leaf, and the
   * repository is what they need to act on.
   */
  tree: ProviderTreeRepository[];
  /** Which repository's extension list is open, if any. */
  expandedUrl: string | null;
  onBrowse(repository: { name: string; url: string }): void;
  /** Closes the inline extension list without navigating anywhere. */
  onCollapse(): void;
  /** Rendered inside the expanded card — the repository's extension list. */
  /** The open repository's extensions, narrowed by the drawer's own search. */
  renderExpanded(query: string): React.ReactNode;
  /** What the open repository publishes against what is installed, once read. */
  available?: { total: number; missing: number } | null;
  onRemove(url: string): void;
  /** Keeps the repository without downloading any of its extensions. */
  onAdd(url: string, name?: string): void;
  /** Downloads and installs its extensions. The expensive one. */
  onInstallAll(url: string, name?: string): void;
}

const working = (job: ExtensionJob | null) =>
  job !== null && (job.state === 'queued' || job.state === 'running');

/**
 * What a repository matched on, when it did not match on its own text.
 *
 * Shown on the card, because a result with no visible reason reads as a bug:
 * searching "vega" and getting a repository whose name, description and
 * language contain none of it looks like the filter is broken until you are
 * told the match is a provider three levels down.
 */
interface DeepMatch {
  extensions: string[];
  providers: string[];
}

/** The installed extensions and providers under one catalogue repository. */
function deepMatchFor(
  repository: OfficialRepository,
  tree: ProviderTreeRepository[],
  query: string
): DeepMatch | null {
  if (!query) return null;
  const node = tree.find(
    (row) =>
      row.url === repository.url ||
      row.url === repository.rawRepoUrl ||
      row.name?.toLowerCase() === repository.name.toLowerCase()
  );
  if (!node) return null;

  const extensions: string[] = [];
  const providers: string[] = [];
  for (const extension of node.extensions) {
    if (matchesQuery(query, extension.name, extension.internalName)) {
      extensions.push(extension.name);
    }
    for (const provider of extension.providers) {
      if (matchesQuery(query, provider.name)) providers.push(provider.name);
    }
  }
  if (extensions.length === 0 && providers.length === 0) return null;
  return { extensions, providers };
}

function normalizeRepoUrl(url: string): string {
  return (url || '').replace(/\/refs\/heads\//, '/').replace(/\/$/, '').toLowerCase();
}

/**
 * `owner/repo` for a repository address — the same reduction the main process
 * uses (`repositoryLabel`), plus jsDelivr's `gh/owner/repo@branch` form. It is
 * both the readable name and the identity: an address the catalogue already
 * lists under another spelling must not appear a second time as the viewer's.
 */
function repositoryKey(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname.includes('jsdelivr') && segments[0] === 'gh' && segments.length >= 3) {
      return `${segments[1]}/${segments[2].split('@')[0]}`;
    }
    if (/github|gitlab|disroot|codeberg/.test(parsed.hostname) && segments.length >= 2) {
      return `${segments[0]}/${segments[1]}`;
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

/** A repository is installed if any of the URLs it is known by is. */
function isInstalled(repository: OfficialRepository, installed: string[]): boolean {
  const normRepoUrl = normalizeRepoUrl(repository.url);
  const normRawUrl = normalizeRepoUrl(repository.rawRepoUrl);
  return installed.some((url) => {
    const norm = normalizeRepoUrl(url);
    return norm === normRepoUrl || norm === normRawUrl;
  });
}

export const RepositoryCatalog: React.FC<RepositoryCatalogProps> = ({
  official,
  installed,
  adultAllowed,
  filters,
  busy,
  jobFor,
  jobsForRepository,
  tree,
  expandedUrl,
  onBrowse,
  onCollapse,
  renderExpanded,
  available,
  onRemove,
  onAdd,
  onInstallAll,
}) => {
  const [catalogueOpen, setCatalogueOpen] = useState(true);
  const [drawerQuery, setDrawerQuery] = useState('');
  const [drawerSearch, setDrawerSearch] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // A new repository starts the drawer fresh: no stale search, facts folded.
  useEffect(() => {
    setDrawerQuery('');
    setDrawerSearch(false);
    setAboutOpen(false);
  }, [expandedUrl]);

  // Escape, or a press outside the drawer that is not on another card, closes
  // it. A press on another card switches the drawer instead, so repositories
  // can be inspected one after another without closing anything.
  useEffect(() => {
    if (!expandedUrl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCollapse();
    };
    const onPress = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest || target.closest('.ext-drawer, .ext-card--selectable, .ext-custom-list__row, [role="dialog"], [role="menu"]')) return;
      onCollapse();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPress);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPress);
    };
  }, [expandedUrl, onCollapse]);

  /** The installed tree's node for a repository, matched the way the main process matches. */
  const nodeFor = (url: string, rawUrl?: string) =>
    tree.find(
      (row) =>
        row.url === url ||
        row.url === rawUrl ||
        repositoryKey(row.url).toLowerCase() === repositoryKey(rawUrl ?? url).toLowerCase()
    );
  const [customOpen, setCustomOpen] = useState(true);

  /**
   * Repositories the viewer added by address that no catalogue entry knows.
   * They are theirs, not the app's: listed first, labelled as added by them,
   * and never touched by a catalogue or bootstrap update.
   */
  const custom = useMemo(
    () =>
      installed.filter(
        (url) =>
          !official.some(
            (repository) =>
              isInstalled(repository, [url]) ||
              repositoryKey(repository.url).toLowerCase() === repositoryKey(url).toLowerCase() ||
              repositoryKey(repository.rawRepoUrl).toLowerCase() === repositoryKey(url).toLowerCase()
          ) &&
          matchesQuery(filters.query, url) &&
          filters.status !== 'available'
      ),
    [installed, official, filters.query, filters.status]
  );

  const visible = useMemo(
    () =>
      official.filter((repository) => {
        /**
         * Adult repositories are not merely filtered out of results — they are
         * not offered at all until the setting is on. `BootstrapService`
         * declines to download them for the same reason.
         */
        if (repository.adult && !adultAllowed) return false;
        if (filters.categories.size > 0 && !filters.categories.has(repository.category)) {
          return false;
        }
        if (filters.languages.size > 0 && !filters.languages.has(repository.language.toLowerCase())) {
          return false;
        }
        const here = isInstalled(repository, installed);
        if (filters.status === 'installed' && !here) return false;
        if (filters.status === 'available' && here) return false;
        // Own text first, then the extensions and providers underneath it.
        // A repository whose *contents* match is exactly as relevant as one
        // whose description does, and far more often what was being looked for.
        if (
          matchesQuery(
            filters.query,
            repository.name,
            repository.description,
            repository.language,
            repository.shortcode,
            repository.id
          )
        ) {
          return true;
        }
        return deepMatchFor(repository, tree, filters.query) !== null;
      }),
    [official, filters, adultAllowed, installed, tree]
  );

  /** The repository whose details are open, catalogued or added by the viewer. */
  const opened = expandedUrl
    ? official.find((repository) => repository.rawRepoUrl === expandedUrl) ??
      (custom.includes(expandedUrl) ? { name: repositoryKey(expandedUrl), description: expandedUrl } : null)
    : null;

  /*
   * Master-detail, the way an extension marketplace works: opening a
   * repository shows its extensions in a panel beside the list instead of
   * inside it. The list reflows once when the panel opens and then holds
   * still — switching from one repository to the next moves nothing — where
   * an inline expansion pushed every card below it down by the height of a
   * forty-row list, so comparing three columns meant hunting for your place
   * after every click. The panel is sticky, so it stays in view however far
   * down the list the viewer has scrolled.
   */
  return (
    <div className="ext-browse">
    <div className="ext-panel ext-browse__list">
      <button
        type="button"
        className="ext-section-toggle"
        aria-expanded={catalogueOpen}
        onClick={() => setCatalogueOpen((open) => !open)}
      >
        {catalogueOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        Catalogue <span>{visible.length === official.length ? official.length : `${visible.length} of ${official.length}`}</span>
      </button>

      {catalogueOpen && (
      <ul className="ext-cards">
        {visible.map((repository) => {
          const here = isInstalled(repository, installed);
          const addJob = jobFor(`repo-add:${repository.rawRepoUrl}`);
          const installJob = jobFor(`repo:${repository.rawRepoUrl}`);
          const failedJob = [installJob, addJob].find((job) => job?.state === 'failed') ?? null;
          const open = expandedUrl === repository.rawRepoUrl;
          const deep = deepMatchFor(repository, tree, filters.query);

          const repoJobs = jobsForRepository ? jobsForRepository(repository) : null;
          const isRepoWorking = working(installJob) || working(addJob);
          const activeJobCount = (repoJobs?.activeCount ?? 0) + (isRepoWorking ? 1 : 0);
          const currentRunningJob =
            repoJobs?.running[0] ??
            (installJob?.state === 'running'
              ? installJob
              : addJob?.state === 'running'
                ? addJob
                : null);

          return (
            <React.Fragment key={repository.id}>
            <li
              className={`ext-card ext-card--selectable${open ? ' ext-card--open' : ''}`}
              onClick={(event) => {
                // The card is the target; its own buttons and links keep theirs.
                if ((event.target as HTMLElement).closest('button, a, input')) return;
                if (!open) onBrowse({ name: repository.name, url: repository.rawRepoUrl });
              }}
            >
              <div className="ext-row__title">
                {repository.name}
                {activeJobCount > 0 ? (
                  <Badge tone="accent" title={`${activeJobCount} installation tasks active`}>
                    <Loader2 size={11} className="spin" />
                    {currentRunningJob ? `Installing (${activeJobCount})` : `Queued (${activeJobCount})`}
                  </Badge>
                ) : null}
                {repository.shortcode ? (
                  <span className="ext-chip" title="Shortcode">
                    {repository.shortcode}
                  </span>
                ) : null}
                {repository.category ? (
                  <Badge tone="neutral">{repository.category}</Badge>
                ) : null}
                {repository.language ? (
                  <span className="ext-chip">{repository.language}</span>
                ) : null}
                {repository.verified ? (
                  <Badge tone="success" title="Confirmed to return a plugin list">
                    verified
                  </Badge>
                ) : (
                  <Badge tone="warning" title="Not confirmed to return a plugin list">
                    unverified
                  </Badge>
                )}
                {here ? <Badge tone="accent">installed</Badge> : null}
              </div>
              <p className="ext-card__description">{repository.description}</p>
              {activeJobCount > 0 ? (
                <div className="ext-card__job-status">
                  <div className="ext-card__job-info">
                    <Loader2 size={13} className="spin" />
                    <span>
                      {currentRunningJob
                        ? `Installing ${currentRunningJob.label}${currentRunningJob.percent ? ` (${Math.round(currentRunningJob.percent)}%)` : ''}${repoJobs && repoJobs.queued.length > 0 ? ` · ${repoJobs.queued.length} queued` : ''}`
                        : `${repoJobs?.queued.length ?? 1} task(s) waiting in queue`}
                    </span>
                  </div>
                  {currentRunningJob?.percent !== undefined ? (
                    <ProgressBar
                      step={currentRunningJob.step ?? 'Installing…'}
                      percent={currentRunningJob.percent}
                    />
                  ) : null}
                </div>
              ) : repoJobs && repoJobs.failed.length > 0 ? (
                <div className="ext-card__job-error">
                  <AlertTriangle size={12} />
                  <span>
                    {repoJobs.failed.length} extension install{repoJobs.failed.length === 1 ? '' : 's'} failed
                  </span>
                </div>
              ) : null}
              {/*
                Why this row is in the results when its own text does not say so.
                Without it, searching a provider name and getting a repository
                that never mentions it reads as a broken filter.
              */}
              {deep ? (
                <p className="ext-card__matched">
                  <Search size={11} aria-hidden /> matches{' '}
                  {[
                    deep.providers.length
                      ? `${deep.providers.length} provider${deep.providers.length === 1 ? '' : 's'}: ${deep.providers.slice(0, 3).join(', ')}`
                      : '',
                    deep.extensions.length
                      ? `${deep.extensions.length} extension${deep.extensions.length === 1 ? '' : 's'}: ${deep.extensions.slice(0, 3).join(', ')}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              <div className="ext-row__subtitle">
                <span>{repository.category}</span>
                <span>{repository.language}</span>
                {repository.bundled ? <Badge>first run</Badge> : null}
                <ExternalLink url={repository.url}>project page</ExternalLink>
                {repository.communityUrl ? (
                  <ExternalLink url={repository.communityUrl}>community</ExternalLink>
                ) : null}
              </div>
              <div className="ext-card__actions">
                {here ? (
                  <span className="ext-card__state">
                    <Check size={12} />
                    {(() => {
                      const count = nodeFor(repository.url, repository.rawRepoUrl)?.extensions.length ?? 0;
                      return count > 0 ? `${count} installed` : 'In your list';
                    })()}
                  </span>
                ) : addJob?.state === 'done' ? (
                  <span className="ext-card__state">
                    <Check size={12} /> Added
                  </span>
                ) : (
                  <Button
                    size="compact"
                    variant="ambient"
                    icon={Plus}
                    loading={working(addJob)}
                    title="Keep this repository in your list without installing anything"
                    onClick={() => onAdd(repository.rawRepoUrl, repository.name)}
                  >
                    Add
                  </Button>
                )}
                {failedJob?.message ? <span className="ext-item__error">{failedJob.message}</span> : null}
                <Button
                  size="compact"
                  variant="ambient"
                  iconOnly
                  icon={ChevronRight}
                  className="ext-card__open"
                  aria-label={`Details for ${repository.name}`}
                  aria-expanded={open}
                  aria-controls="ext-browse-details"
                  onClick={() =>
                    open ? onCollapse() : onBrowse({ name: repository.name, url: repository.rawRepoUrl })
                  }
                />
              </div>
            </li>

            </React.Fragment>
          );
        })}
      </ul>
      )}

      {catalogueOpen && visible.length === 0 ? (
        <p className="ext-empty">No repositories match those filters.</p>
      ) : null}

      {custom.length > 0 && (
        <section className="ext-custom-repos" aria-label="Repositories you added">
          <button
            type="button"
            className="ext-section-toggle"
            aria-expanded={customOpen}
            onClick={() => setCustomOpen((open) => !open)}
          >
            {customOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Added by you <span>{custom.length}</span>
          </button>
          {customOpen && (
            <ul className="ext-custom-list">
              {custom.map((url) => {
                const open = expandedUrl === url;
                return (
                  <React.Fragment key={url}>
                    <li className="ext-custom-list__row">
                      <span className="ext-custom-list__name" title={url}>
                        {repositoryKey(url)}
                      </span>
                      <Button
                        size="compact"
                        variant="ambient"
                        icon={ChevronRight}
                        aria-expanded={open}
                        aria-controls="ext-browse-details"
                        onClick={() => (open ? onCollapse() : onBrowse({ name: repositoryKey(url), url }))}
                      >
                        {open ? 'Showing' : 'Details'}
                      </Button>
                      <Button
                        size="compact"
                        variant="ambient"
                        iconOnly
                        icon={Trash2}
                        aria-label={`Remove ${repositoryKey(url)}`}
                        title="Remove from your list (installed extensions stay until you uninstall them)"
                        onClick={() => onRemove(url)}
                      />
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
    {opened ? (() => {
      const catalogued = official.find((repository) => repository.rawRepoUrl === expandedUrl);
      const inList = catalogued ? isInstalled(catalogued, installed) : true;
      const node = nodeFor(catalogued?.url ?? expandedUrl ?? '', expandedUrl ?? undefined);
      const installedCount = node?.extensions.length ?? 0;
      const addJob = jobFor(`repo-add:${expandedUrl}`);
      const installJob = jobFor(`repo:${expandedUrl}`);
      const facts: Array<[string, React.ReactNode]> = catalogued
        ? [
            ['About', catalogued.description],
            ['Category', catalogued.category],
            ['Language', catalogued.language],
            ...(catalogued.shortcode ? [['Shortcode', catalogued.shortcode] as [string, React.ReactNode]] : []),
            ['Checked', catalogued.verified ? 'Returns a plugin list' : 'Not confirmed to return a plugin list'],
            ['Project', <ExternalLink key="p" url={catalogued.url} />],
            ['Index', <code key="i">{catalogued.rawRepoUrl}</code>],
          ]
        : [['Index', <code key="i">{expandedUrl}</code>], ['Origin', 'Added by you by its address']];
      return (
        /*
         * A drawer over the list, never beside or inside it: the catalogue
         * underneath does not move, resize or re-render, so closing it puts
         * the viewer back exactly where they were. Not modal — another card
         * can be opened straight from behind it.
         */
        <aside id="ext-browse-details" className="ext-drawer" role="dialog" aria-modal="false" aria-label={`${opened.name} details`}>
          <header className="ext-drawer__head">
            <div className="ext-drawer__title">
              <strong>{opened.name}</strong>
              <span className="ext-drawer__badges">
                {catalogued?.verified ? <Badge tone="success">verified</Badge> : null}
                {catalogued?.adult ? <Badge tone="warning">18+</Badge> : null}
                {!catalogued ? <Badge tone="neutral">added by you</Badge> : null}
              </span>
            </div>
            {(available?.total ?? 0) > 6 ? (
              <Button
                size="compact"
                variant="ambient"
                iconOnly
                icon={Search}
                aria-label="Search this repository"
                aria-pressed={drawerSearch}
                onClick={() => {
                  setDrawerSearch((on) => !on);
                  setDrawerQuery('');
                }}
              />
            ) : null}
            <Button size="compact" variant="ambient" iconOnly icon={X} aria-label="Close details" onClick={onCollapse} />
          </header>

          {/* State first, with the one action that state calls for. */}
          <div className="ext-drawer__status">
            {!inList && addJob?.state !== 'done' ? (
              <>
                <span>Not in your list</span>
                <Button size="compact" variant="prominent" icon={Plus} loading={working(addJob)} onClick={() => onAdd(expandedUrl ?? '', opened.name)}>
                  Add
                </Button>
                <Button size="compact" loading={working(installJob)} onClick={() => onInstallAll(expandedUrl ?? '', opened.name)}>
                  Install all
                </Button>
              </>
            ) : available && available.missing > 0 ? (
              <>
                <span>
                  {installedCount > 0 ? `${available.total - available.missing} of ${available.total} installed` : `${available.total} extensions, none installed`}
                </span>
                <Button size="compact" variant="prominent" loading={working(installJob)} onClick={() => onInstallAll(expandedUrl ?? '', opened.name)}>
                  {installedCount > 0 ? `Install ${available.missing} more` : 'Install all'}
                </Button>
              </>
            ) : available ? (
              <span className="ext-drawer__ok">
                <Check size={13} /> All {available.total} extensions installed
              </span>
            ) : (
              <span>{installedCount > 0 ? `${installedCount} installed` : 'In your list'}</span>
            )}
          </div>

          {drawerSearch ? (
            <div className="ext-drawer__search">
              <SearchInput
                variant="compact"
                autoFocus
                label="Search this repository"
                placeholder="Extensions and providers"
                value={drawerQuery}
                onChange={setDrawerQuery}
              />
            </div>
          ) : null}

          <div className="ext-drawer__body">
            {renderExpanded(drawerQuery)}

            <section className="ext-drawer__about">
              <button type="button" className="ext-section-toggle" aria-expanded={aboutOpen} onClick={() => setAboutOpen((o) => !o)}>
                {aboutOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                About this repository
              </button>
              {aboutOpen ? (
                <dl className="ext-drawer__facts">
                  {facts.map(([label, value]) => (
                    <React.Fragment key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : null}
            </section>
          </div>

          {inList ? (
            <footer className="ext-drawer__foot">
              <Button
                size="compact"
                variant="ambient"
                icon={Trash2}
                disabled={busy === `remove:${expandedUrl}`}
                title={installedCount > 0 ? 'Remove the repository and uninstall what it installed' : 'Remove from your list'}
                onClick={() => onRemove(expandedUrl ?? '')}
              >
                Remove repository
              </Button>
            </footer>
          ) : null}
        </aside>
      );
    })() : null}
    </div>
  );
};
