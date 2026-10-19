import { useEffect, useState } from 'react';
import type { SitePlugin } from '../../types/plugin';

/**
 * The plugin lists the main process already holds for catalogue repositories,
 * read without fetching anything (`extension:peekRepository`).
 *
 * Asked for only while a Browse search or filter is active — that is when a
 * search has to reach *into* repositories — and kept for the session, so typing
 * does not re-ask. A list is looked up under both addresses a repository is
 * known by: the background refresh stores it under the catalogue `url`,
 * opening a repository under its `rawRepoUrl`.
 */

const listings = new Map<string, SitePlugin[] | null>();
const inFlight = new Map<string, Promise<void>>();

async function readListing(key: string, addresses: string[]): Promise<void> {
  for (const address of addresses) {
    try {
      const response = await window.cloudstream?.peekRepository?.(address);
      const plugins = response?.ok ? response.repository?.plugins : undefined;
      if (Array.isArray(plugins)) {
        listings.set(key, plugins);
        return;
      }
    } catch {
      // Unreadable is the same as never read: the plan says so.
    }
  }
  listings.set(key, null);
}

export function useCatalogListings(
  repositories: Array<{ rawRepoUrl: string; url: string }>,
  enabled: boolean
): ReadonlyMap<string, SitePlugin[] | null> {
  const [, setVersion] = useState(0);
  const wanted = repositories.map((repository) => repository.rawRepoUrl).join('\n');

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const reads = repositories
      .filter((repository) => !listings.has(repository.rawRepoUrl))
      .map((repository) => {
        const key = repository.rawRepoUrl;
        let read = inFlight.get(key);
        if (!read) {
          read = readListing(key, [repository.rawRepoUrl, repository.url]).finally(() => inFlight.delete(key));
          inFlight.set(key, read);
        }
        return read;
      });
    if (reads.length === 0) return;
    void Promise.all(reads).then(() => {
      if (live) setVersion((version) => version + 1);
    });
    return () => {
      live = false;
    };
    // `wanted` stands for the list's contents; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, enabled]);

  return listings;
}

/** A repository was opened and read: the next search should see what it lists now. */
export function rememberListing(rawRepoUrl: string, plugins: SitePlugin[]): void {
  listings.set(rawRepoUrl, plugins);
}
