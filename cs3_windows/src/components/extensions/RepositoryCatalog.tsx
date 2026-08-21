/**
 * What could be added: the verified catalogue, plus any URL the user has.
 *
 * `verified` is load-bearing rather than reassuring. The catalogue previously
 * assumed every repository lived under one organisation on a `builds` branch;
 * 23 of 26 entries were wrong and returned 404. So an unverified row is shown
 * as unverified rather than silently offered as if it worked.
 *
 * There is no "Add" button, and that is not an omission. The main process has
 * no standalone concept of adding a repository — a URL joins the installed set
 * when an extension is installed *from* it — so an Add button would create a
 * row that vanishes on the next read.
 */
import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck, ExternalLink, Loader2, Users } from 'lucide-react';
import type { OfficialRepository } from './useExtensionCatalog';

interface RepositoryCatalogProps {
  official: OfficialRepository[];
  installed: string[];
  adultAllowed: boolean;
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
  busy,
  onBrowse,
  onRemove,
}) => {
  const [query, setQuery] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [category, setCategory] = useState<string>('All');

  /**
   * Categories are counted from the data, not listed.
   *
   * A hardcoded list can offer a filter with nothing behind it and can silently
   * omit one that exists — the same failure the old single-`<select>` content
   * filter had, which knew about three `TvType`s out of eighteen.
   */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repository of official) {
      if (repository.adult && !adultAllowed) continue;
      counts.set(repository.category, (counts.get(repository.category) ?? 0) + 1);
    }
    return ['All', ...[...counts.keys()].sort()];
  }, [official, adultAllowed]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return official.filter((repository) => {
      // Adult repositories are not merely filtered from results — they are not
      // offered at all until the setting is on. See `BootstrapService`.
      if (repository.adult && !adultAllowed) return false;
      if (category !== 'All' && repository.category !== category) return false;
      if (!needle) return true;
      return (
        repository.name.toLowerCase().includes(needle) ||
        repository.description.toLowerCase().includes(needle) ||
        repository.language.toLowerCase().includes(needle) ||
        (repository.shortcode && repository.shortcode.toLowerCase().includes(needle)) ||
        repository.id.toLowerCase().includes(needle)
      );
    });
  }, [official, query, category, adultAllowed]);

  return (
    <div className="ext-panel">
      <div className="ext-filterbar">
        <div className="ext-search">
          <Search size={14} />
          <input
            type="search"
            value={query}
            placeholder="Search repositories by name or shortcode"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="ext-facets" role="group" aria-label="Category">
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              className={`ext-facet${category === name ? ' ext-facet--on' : ''}`}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <form
        className="ext-custom-url"
        onSubmit={(event) => {
          event.preventDefault();
          const url = customUrl.trim();
          if (url) onBrowse({ name: url, url });
        }}
      >
        <input
          type="text"
          value={customUrl}
          placeholder="https://example.com/repo.json — or shortcode (e.g. gizlikeyif, cxxx)"
          onChange={(event) => setCustomUrl(event.target.value)}
        />
        <button type="submit" className="ext-button" disabled={!customUrl.trim()}>
          Browse
        </button>
      </form>
      <p className="ext-hint">
        A project page or repository shortcode works too. There is no convention for where a plugin list
        lives, so the branch and filename are probed — <code>master/repo.json</code>,{' '}
        <code>builds/repo.json</code> and <code>builds/plugins.json</code> are all in use.
      </p>

      <ul className="ext-cards">
        {visible.map((repository) => {
          const here = isInstalled(repository, installed);
          return (
            <li key={repository.id} className="ext-card">
              <div className="ext-card__head">
                <span className="ext-card__name">{repository.name}</span>
                {repository.shortcode ? (
                  <span className="ext-chip" title="Shortcode">
                    {repository.shortcode}
                  </span>
                ) : null}
                {repository.verified ? (
                  <span className="ext-chip ext-chip--verified" title="Confirmed to return a plugin list">
                    <ShieldCheck size={11} /> verified
                  </span>
                ) : (
                  <span className="ext-chip ext-chip--unverified" title="Not confirmed to return a plugin list">
                    unverified
                  </span>
                )}
                {here ? <span className="ext-chip ext-chip--installed">installed</span> : null}
              </div>
              <p className="ext-card__description">{repository.description}</p>
              <div className="ext-card__meta">
                <span className="ext-chip">{repository.category}</span>
                <span className="ext-chip">{repository.language}</span>
                {repository.bundled ? (
                  <span className="ext-chip ext-chip--bundled">first run</span>
                ) : null}
              </div>
              <div className="ext-card__actions">
                <button
                  type="button"
                  className="ext-button"
                  disabled={busy !== null}
                  onClick={() => onBrowse({ name: repository.name, url: repository.rawRepoUrl })}
                >
                  {busy === `browse:${repository.rawRepoUrl}` ? (
                    <Loader2 size={13} className="ext-spin" />
                  ) : null}
                  Browse extensions
                </button>
                {here ? (
                  <button
                    type="button"
                    className="ext-button ext-button--danger"
                    disabled={busy !== null}
                    onClick={() => onRemove(repository.rawRepoUrl)}
                  >
                    Remove
                  </button>
                ) : null}
                {repository.communityUrl ? (
                  <a
                    className="ext-link"
                    href={repository.communityUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open Discord community"
                  >
                    <Users size={13} />
                  </a>
                ) : null}
                <a
                  className="ext-link"
                  href={repository.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the project page"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 ? (
        <p className="ext-empty">No repositories match that filter.</p>
      ) : null}
    </div>
  );
};
