import type { SitePlugin } from '../../types/plugin';
import { matchesQuery } from './bulkSelection.ts';

/**
 * What "Install all" on a Browse search installs, and what it leaves out.
 *
 * A search used to narrow the repository cards and stop there: installing what
 * it found meant opening each card and pressing Install in each. This plans the
 * whole result as individual extension installs — one queued job each, so they
 * download side by side, report one by one, and retry on their own — from the
 * plugin lists the main process already keeps for every catalogue repository
 * (refreshed daily, read without a fetch).
 *
 * - A repository the search **names** (name, shortcode, language), or one the
 *   filters alone selected, offers every extension it lists.
 * - Otherwise only the extensions whose own name or description matched.
 * - A repository nobody has read yet cannot be planned by extension; when it
 *   matched itself it is queued as a repository install, which reads it first.
 *
 * Never blindly everything: an extension already installed, already queued,
 * marked down by its own maintainer, adult-only while adult content is off, or
 * listed by a second repository is left out — and counted, so the bar can say
 * what it skipped. Pure, so those rules are tested (`catalogInstall.test.mts`).
 */

export interface CatalogRepository {
  /** The address installs come from (`rawRepoUrl`). */
  url: string;
  name: string;
  /** The search or filters selected the repository itself, not just something in it. */
  matchedItself: boolean;
  /** Its stored plugin list, or null when it has never been read. */
  plugins: SitePlugin[] | null;
}

export interface CatalogInstallItem {
  plugin: SitePlugin;
  repositoryUrl: string;
  repositoryName: string;
}

export interface CatalogInstallPlan {
  items: CatalogInstallItem[];
  /** Repositories queued whole because their extensions are not known yet. */
  unread: Array<{ url: string; name: string }>;
  excluded: { installed: number; queued: number; down: number; adult: number; duplicate: number };
  /** How many repositories contribute something. */
  repositories: number;
}

const ADULT_TYPES = new Set(['NSFW']);
const NON_CONTENT_TYPES = new Set(['NSFW', 'OTHERS', 'CUSTOMMEDIA']);

/** Upstream's NSFW type and nothing general beside it — the same line the provider gate draws. */
export function isAdultOnlyPlugin(plugin: SitePlugin): boolean {
  const types = (plugin.tvTypes ?? []).map((type) => String(type).toUpperCase());
  return types.some((type) => ADULT_TYPES.has(type)) && types.every((type) => NON_CONTENT_TYPES.has(type));
}

export function pluginMatches(plugin: SitePlugin, query: string): boolean {
  return matchesQuery(query.trim().toLowerCase(), plugin.name, plugin.internalName, plugin.description);
}

export function planCatalogInstall(input: {
  repositories: CatalogRepository[];
  query: string;
  installed: ReadonlySet<string>;
  /** `ext:<internalName>` targets with a queued or running job. */
  active: ReadonlySet<string>;
  adultAllowed: boolean;
}): CatalogInstallPlan {
  const plan: CatalogInstallPlan = {
    items: [],
    unread: [],
    excluded: { installed: 0, queued: 0, down: 0, adult: 0, duplicate: 0 },
    repositories: 0,
  };
  const seen = new Set<string>();

  for (const repository of input.repositories) {
    if (repository.plugins === null) {
      if (repository.matchedItself) {
        plan.unread.push({ url: repository.url, name: repository.name });
        plan.repositories++;
      }
      continue;
    }
    const candidates = repository.matchedItself
      ? repository.plugins
      : repository.plugins.filter((plugin) => pluginMatches(plugin, input.query));
    let contributed = false;
    for (const plugin of candidates) {
      const name = plugin.internalName;
      if (seen.has(name)) {
        plan.excluded.duplicate++;
        continue;
      }
      seen.add(name);
      if (input.installed.has(name)) plan.excluded.installed++;
      else if (input.active.has(`ext:${name}`)) plan.excluded.queued++;
      else if (plugin.status === 0) plan.excluded.down++;
      else if (!input.adultAllowed && isAdultOnlyPlugin(plugin)) plan.excluded.adult++;
      else {
        plan.items.push({ plugin, repositoryUrl: repository.url, repositoryName: repository.name });
        contributed = true;
      }
    }
    if (contributed) plan.repositories++;
  }
  return plan;
}

/** "3 installed · 1 marked down" — what the plan left out, for the bar. */
export function describeExclusions(excluded: CatalogInstallPlan['excluded']): string {
  const parts: string[] = [];
  if (excluded.installed) parts.push(`${excluded.installed} installed`);
  if (excluded.queued) parts.push(`${excluded.queued} already queued`);
  if (excluded.down) parts.push(`${excluded.down} marked down`);
  if (excluded.adult) parts.push(`${excluded.adult} adult`);
  if (excluded.duplicate) parts.push(`${excluded.duplicate} listed twice`);
  return parts.join(' · ');
}
