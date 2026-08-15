import officialReposData from './official_repositories.json';

export interface OfficialRepository {
  id: string;
  name: string;
  internalName: string;
  description: string;
  url: string;
  rawRepoUrl: string;
  category:
    | 'Official'
    | 'Regional'
    | 'Anime'
    | 'Movies & Shows'
    | 'Community'
    | 'Compatibility'
    | 'Adult';
  language: string;
  iconUrl?: string;
  isInstalled?: boolean;
  /**
   * Installed automatically on first launch.
   *
   * Reserved for the repositories driven end-to-end by
   * `tools/e2e/provider-e2e.mjs` — loaded, searched, and in at least one case
   * streamed. Adding a repository here is a claim that a new user will get
   * working results from it without touching a setting, so it needs the test
   * run behind it, not an assumption.
   */
  bundled?: boolean;
  /**
   * Adult content. Never bundled, never bootstrapped, and not shown at all
   * until the user turns adult content on — see `BootstrapService`.
   */
  adult?: boolean;
  /**
   * Whether `rawRepoUrl` was confirmed to return a document, as of the date in
   * `docs/PRD/35`. The catalogue previously assumed every repository lived under
   * the `recloudstream` organisation on a `builds` branch; 23 of 26 entries were
   * wrong and returned 404, and the branch varies per repository.
   */
  verified: boolean;
  /**
   * Which document `rawRepoUrl` points at. Most repositories publish a
   * `repo.json` wrapper, but some publish the plugin array directly, and the two
   * parse differently.
   */
  documentKind: 'repository' | 'pluginList' | 'unknown';
}

export const OFFICIAL_REPOSITORIES: OfficialRepository[] = officialReposData as OfficialRepository[];
