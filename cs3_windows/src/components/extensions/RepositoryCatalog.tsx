/**
 * What could be added: the verified catalogue, plus any URL the user has.
 *
 * `verified` is load-bearing rather than reassuring. The catalogue previously
 * assumed every repository lived under one organisation on a `builds` branch;
 * 23 of 26 entries were wrong and returned 404. So an unverified row is labelled
 * unverified rather than silently offered as if it worked.
 *
 * There is no "Add" button, and that is not an omission. The main process has no
 * standalone concept of adding a repository — a URL joins the installed set when
 * an extension is installed *from* it — so an Add button would create a row that
 * vanishes on the next read.
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
