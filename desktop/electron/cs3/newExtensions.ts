import type { SitePlugin } from '../../src/types/plugin.ts';

/**
 * Which newly published extensions to install from repositories already in use.
 *
 * A maintainer adds a provider to a repository the viewer installed from, and
 * nothing happened: the update check only looked at installed plugins. Now a
 * plugin that appears after the repository was first seen is installed through
 * the same job queue as an update, under the same automatic-update setting.
 *
 * What counts:
 * - **New** means not in the repository's last known list and not installed.
 *   The first look at a repository only records it, so picking two extensions
 *   from a 40-extension repository never installs the other 38.
 * - Only repositories the viewer installed at least one extension from.
 * - Never one the maintainer marks down (status 0), never an adult-only one
 *   while adult content is off.
 * - An extension the viewer uninstalled was known before, so it never returns.
 *
 * Pure: the caller fetches, stores the known lists and enqueues.
 */

export interface RepositoryListing {
  url: string;
  plugins: SitePlugin[];
}

export interface NewExtensionPlan {
  install: Array<{ plugin: SitePlugin; repositoryUrl: string }>;
  /** Every repository's known plugin names after this look, to store. */
  known: Record<string, string[]>;
  /** Left out, with why, for the log. */
  skipped: Array<{ internalName: string; repositoryUrl: string; reason: string }>;
}

const STATUS_DOWN = 0;

function adultOnly(plugin: SitePlugin): boolean {
  const types = (plugin.tvTypes ?? []).map((t) => String(t).toUpperCase());
  return types.length > 0 && types.every((t) => t === 'NSFW' || t === 'OTHERS');
}

export function planNewExtensions(input: {
  listings: RepositoryListing[];
  installed: ReadonlySet<string>;
  /** Repositories at least one installed extension came from. */
  usedRepositories: ReadonlySet<string>;
  known: Readonly<Record<string, readonly string[]>>;
  adultAllowed: boolean;
}): NewExtensionPlan {
  const install: NewExtensionPlan['install'] = [];
  const skipped: NewExtensionPlan['skipped'] = [];
  const known: Record<string, string[]> = { ...input.known } as Record<string, string[]>;
  const queued = new Set<string>();

  for (const listing of input.listings) {
    const names = listing.plugins.map((p) => p.internalName).filter(Boolean);
    const before = input.known[listing.url];
    known[listing.url] = [...new Set([...(before ?? []), ...names])];
    if (!before || !input.usedRepositories.has(listing.url)) continue;

    const seen = new Set(before);
    for (const plugin of listing.plugins) {
      const name = plugin.internalName;
      if (!name || seen.has(name) || input.installed.has(name) || queued.has(name)) continue;
      const reason =
        Number(plugin.status) === STATUS_DOWN
          ? 'marked not working by its maintainer'
          : !input.adultAllowed && adultOnly(plugin)
            ? 'adult-only while adult content is off'
            : null;
      if (reason) {
        skipped.push({ internalName: name, repositoryUrl: listing.url, reason });
        continue;
      }
      queued.add(name);
      install.push({ plugin, repositoryUrl: listing.url });
    }
  }
  return { install, known, skipped };
}
