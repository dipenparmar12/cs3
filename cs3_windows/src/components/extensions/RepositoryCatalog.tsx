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
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Badge, ExternalLink, ProgressBar } from './primitives';
import { matchesQuery, type FilterState } from './useExtensionFilters';
import type { ProviderTreeRepository } from '../../types/plugin';
import type { OfficialRepository } from './useExtensionCatalog';
import type { ExtensionJob, RepositoryJobsSummary } from './useExtensionJobs';
import { Button } from '../ui';
import { AddRepositoryDialog } from './AddRepositoryDialog';

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
  renderExpanded(): React.ReactNode;
  onRemove(url: string): void;
  /** Keeps the repository without downloading any of its extensions. */
  onAdd(url: string, name?: string): void;
  /** Downloads and installs its extensions. The expensive one. */
  onInstallAll(url: string, name?: string): void;
}

const working = (job: ExtensionJob | null) =>
  job !== null && (job.state === 'queued' || job.state === 'running');

/** A job's state in the words a button can carry. */
const JobLabel: React.FC<{ job: ExtensionJob | null; idle: string; active: string }> = ({
  job,
  idle,
  active,
}) => {
  if (job?.state === 'queued') {
    return (
      <>
        <Clock size={13} /> Waiting
      </>
    );
  }
  if (job?.state === 'running') {
    return (
      <>
        <Loader2 size={13} className="spin" /> {active}
      </>
    );
  }
  return <>{idle}</>;
};

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

/** `github.com/owner/repo/…/plugins.json` for an address nobody catalogued. */
function shortAddress(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^raw\.githubusercontent\.com\//, '').replace(/\/$/, '');
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
  onRemove,
  onAdd,
  onInstallAll,
}) => {
  const [adding, setAdding] = useState(false);

  /**
   * Repositories the viewer added by address that no catalogue entry knows.
   * They are theirs, not the app's: listed first, labelled as added by them,
   * and never touched by a catalogue or bootstrap update.
   */
  const custom = useMemo(
    () =>
      installed.filter(
        (url) =>
          !official.some((repository) => isInstalled(repository, [url])) &&
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

  return (
    <div className="ext-panel">
      {adding && (
        <AddRepositoryDialog
          onBrowse={(url) => onBrowse({ name: shortAddress(url), url })}
          onAdd={(url) => onAdd(url)}
          onClose={() => setAdding(false)}
        />
      )}

      <div className="ext-tree-toolbar">
        <span className="ext-tree-toolbar__count">
          Showing <strong>{visible.length}</strong> of {official.length} repositories
        </span>
        <div className="ext-tree-toolbar__actions">
          {expandedUrl ? (
            <Button size="compact" variant="ambient" icon={ChevronUp} onClick={onCollapse}>
              Collapse
            </Button>
          ) : null}
          <Button size="compact" icon={Plus} onClick={() => setAdding(true)}>
            Add repository
          </Button>
        </div>
      </div>

      {custom.length > 0 && (
        <section className="ext-custom-repos" aria-label="Repositories you added">
          <h3 className="ext-section-title">Added by you</h3>
          <ul className="ext-cards">
            {custom.map((url) => {
              const open = expandedUrl === url;
              return (
                <React.Fragment key={url}>
                  <li className={`ext-card ext-card--compact${open ? ' ext-card--open' : ''}`}>
                    <div className="ext-row__title">
                      <span className="ext-custom-repos__name" title={url}>
                        {shortAddress(url)}
                      </span>
                      <Badge tone="neutral" title="You added this repository by its address">
                        added by you
                      </Badge>
                    </div>
                    <div className="ext-card__actions">
                      <Button
                        size="compact"
                        variant="ambient"
                        icon={open ? ChevronUp : ChevronDown}
                        aria-expanded={open}
                        onClick={() => (open ? onCollapse() : onBrowse({ name: shortAddress(url), url }))}
                      >
                        {open ? 'Hide extensions' : 'Browse extensions'}
                      </Button>
                      <Button
                        size="compact"
                        variant="ambient"
                        iconOnly
                        icon={Trash2}
                        aria-label="Remove this repository"
                        title="Remove from your list (installed extensions stay until you uninstall them)"
                        onClick={() => onRemove(url)}
                      />
                    </div>
                  </li>
                  {open ? <li className="ext-card__panel" aria-label={`Extensions in ${shortAddress(url)}`}>{renderExpanded()}</li> : null}
                </React.Fragment>
              );
            })}
          </ul>
          <h3 className="ext-section-title">Catalogue</h3>
        </section>
      )}

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
            <li className={`ext-card${open ? ' ext-card--open' : ''}`}>
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
                {/*
                  Browse opens the list *here*, under this card, instead of
                  throwing the user onto a third tab. Reading what a repository
                  offers and comparing it against the others is one task, and
                  navigating away to answer it loses the row you were comparing
                  from — along with the scroll position and every filter chip.
                */}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  aria-expanded={open}
                  onClick={() =>
                    open
                      ? onCollapse()
                      : onBrowse({ name: repository.name, url: repository.rawRepoUrl })
                  }
                >
                  {open ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  {open ? 'Hide extensions' : 'Browse extensions'}
                </button>
                {here ? null : addJob?.state === 'done' ? (
                  <span className="ext-item__installed">
                    <Check size={13} /> Added
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={working(addJob)}
                    title="Keep this repository in your list without installing anything"
                    onClick={() => onAdd(repository.rawRepoUrl, repository.name)}
                  >
                    <JobLabel job={addJob} idle="Add" active="Adding" />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={working(installJob)}
                  title="Install every extension this repository publishes, in the background"
                  onClick={() => onInstallAll(repository.rawRepoUrl, repository.name)}
                >
                  <JobLabel job={installJob} idle="Install all" active="Reading list" />
                </button>
                {here ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm btn--danger-text"
                    disabled={busy === `remove:${repository.rawRepoUrl}`}
                    onClick={() => onRemove(repository.rawRepoUrl)}
                  >
                    Remove
                  </button>
                ) : null}
                {failedJob?.message ? (
                  <span className="ext-item__error">{failedJob.message}</span>
                ) : null}
              </div>
            </li>
            {/*
              Full-width, and immediately after the card it belongs to.
              `grid-column: 1 / -1` makes the panel break the three-up rhythm
              and take the whole row, which is the only layout where a long
              extension list under one card of three does not look like it
              belongs to its neighbours.
            */}
            {open ? (
              <li className="ext-card__panel" aria-label={`Extensions in ${repository.name}`}>
                {renderExpanded()}
              </li>
            ) : null}
            </React.Fragment>
          );
        })}
      </ul>

      {visible.length === 0 ? (
        <p className="ext-empty">No repositories match those filters.</p>
      ) : null}
    </div>
  );
};
