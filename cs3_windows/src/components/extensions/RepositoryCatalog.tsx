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
import { Loader2 } from 'lucide-react';
import { Badge, ExternalLink } from './primitives';
import { matchesQuery, type FilterState } from './useExtensionFilters';
import type { OfficialRepository } from './useExtensionCatalog';

interface RepositoryCatalogProps {
  official: OfficialRepository[];
  installed: string[];
  adultAllowed: boolean;
  filters: FilterState;
  busy: string | null;
  onBrowse(repository: { name: string; url: string }): void;
  onRemove(url: string): void;
  /** Keeps the repository without downloading any of its extensions. */
  onAdd(url: string): void;
  /** Downloads and installs its extensions. The expensive one. */
  onInstallAll(url: string): void;
}

/** A repository is installed if any of the URLs it is known by is. */
function isInstalled(repository: OfficialRepository, installed: string[]): boolean {
  return installed.some((url) => url === repository.url || url === repository.rawRepoUrl);
}

export const RepositoryCatalog: React.FC<RepositoryCatalogProps> = ({
  official,
  installed,
  adultAllowed,
  filters,
  busy,
  onBrowse,
  onRemove,
  onAdd,
  onInstallAll,
}) => {
  const [customUrl, setCustomUrl] = useState('');

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
        return matchesQuery(
          filters.query,
          repository.name,
          repository.description,
          repository.language,
          repository.shortcode,
          repository.id
        );
      }),
    [official, filters, adultAllowed, installed]
  );

  return (
    <div className="ext-panel">
      <form
        className="ext-custom-url"
        onSubmit={(event) => {
          event.preventDefault();
          const url = customUrl.trim();
          if (url) onBrowse({ name: url, url });
        }}
      >
        <input
          type="url"
          value={customUrl}
          placeholder="https://example.com/repo.json — or a project page"
          onChange={(event) => setCustomUrl(event.target.value)}
        />
        <button type="submit" className="ext-btn" disabled={!customUrl.trim()}>
          Browse
        </button>
        <button
          type="button"
          className="ext-btn"
          disabled={!customUrl.trim() || busy !== null}
          title="Keep this repository in your list without installing anything"
          onClick={() => onAdd(customUrl.trim())}
        >
          {busy === `add:${customUrl.trim()}` ? <Loader2 size={13} className="spin" /> : null}
          Add
        </button>
      </form>
      <p className="ext-hint">
        A project page or repository shortcode works too. There is no convention for where a plugin list lives, so
        the branch and filename are probed — <code>master/repo.json</code>,{' '}
        <code>builds/repo.json</code> and <code>builds/plugins.json</code> are all in use.
      </p>

      <ul className="ext-cards">
        {visible.map((repository) => {
          const here = isInstalled(repository, installed);
          return (
            <li key={repository.id} className="ext-card">
              <div className="ext-row__title">
                {repository.name}
                {repository.shortcode ? (
                  <span className="ext-chip" title="Shortcode">
                    {repository.shortcode}
                  </span>
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
                <button
                  type="button"
                  className="ext-btn ext-btn--primary"
                  disabled={busy !== null}
                  onClick={() => onBrowse({ name: repository.name, url: repository.rawRepoUrl })}
                >
                  {busy === `browse:${repository.rawRepoUrl}` ? (
                    <Loader2 size={13} className="spin" />
                  ) : null}
                  Browse extensions
                </button>
                {here ? null : (
                  <button
                    type="button"
                    className="ext-btn"
                    disabled={busy !== null}
                    title="Keep this repository in your list without installing anything"
                    onClick={() => onAdd(repository.rawRepoUrl)}
                  >
                    {busy === `add:${repository.rawRepoUrl}` ? (
                      <Loader2 size={13} className="spin" />
                    ) : null}
                    Add
                  </button>
                )}
                <button
                  type="button"
                  className="ext-btn"
                  disabled={busy !== null}
                  title="Download and install every extension this repository publishes"
                  onClick={() => onInstallAll(repository.rawRepoUrl)}
                >
                  {busy === `installRepo:${repository.rawRepoUrl}` ? (
                    <Loader2 size={13} className="spin" />
                  ) : null}
                  Install all
                </button>
                {here ? (
                  <button
                    type="button"
                    className="ext-btn ext-btn--danger"
                    disabled={busy !== null}
                    onClick={() => onRemove(repository.rawRepoUrl)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 ? (
        <p className="ext-empty">No repositories match those filters.</p>
      ) : null}
    </div>
  );
};
