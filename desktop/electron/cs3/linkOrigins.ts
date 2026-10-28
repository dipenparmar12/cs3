/**
 * Which provider answer a direct link came from, so an expired link can be
 * asked for again (Playback Source Resolution PRD, Part D).
 *
 * A signed link (googleusercontent, many CDNs) dies mid-film with a 401 or
 * 403. `SourceLease` and `MediaProxy` already refresh on that answer when the
 * lease has a resolver; the resolver needs the provider handle that produced
 * the link and enough of the link to find it again among the fresh ones. That
 * is what is kept here, keyed on the link's URL, for the links of this launch.
 *
 * The fresh link must be the **same** link: same extractor, same name, same
 * quality, same playlist part. Anything else is a different release (another
 * language, another cut), and swapping it in mid-film is the wrong-content
 * failure this app works hardest to avoid, so there is no fallback. Pure.
 */
export interface LinkOrigin {
  /** The `cs3ext://` handle `loadLinks` was called with. */
  handle: string;
  source: string;
  name: string;
  quality: number;
  /** 1-based part of a playlist link; 0 for an ordinary link. */
  part: number;
}

export interface RefreshableLink {
  source: string;
  name: string;
  url: string;
  quality: number;
  headers?: Record<string, string>;
  playlist?: Array<{ url: string }>;
}

/** Bounded, oldest first out: a long session meets a few thousand links at most. */
export const MAX_LINK_ORIGINS = 2000;

export class LinkOrigins {
  private readonly origins = new Map<string, LinkOrigin>();
  private readonly limit: number;

  constructor(limit = MAX_LINK_ORIGINS) {
    this.limit = limit;
  }

  remember(url: string, origin: LinkOrigin): void {
    if (!url || !origin.handle) return;
    this.origins.delete(url);
    this.origins.set(url, origin);
    while (this.origins.size > this.limit) {
      const oldest = this.origins.keys().next().value;
      if (oldest === undefined) break;
      this.origins.delete(oldest);
    }
  }

  get(url: string): LinkOrigin | undefined {
    return this.origins.get(url);
  }
}

/** The same link among a fresh answer, with its address; `null` when it is not there. */
export function pickRefreshedLink(
  origin: LinkOrigin,
  fresh: RefreshableLink[]
): { url: string; headers: Record<string, string> } | null {
  for (const link of fresh) {
    if (link.source !== origin.source || link.name !== origin.name || link.quality !== origin.quality) continue;
    const parts = link.playlist ?? [];
    const url = origin.part > 0 ? parts[origin.part - 1]?.url : link.url || (parts.length === 1 ? parts[0].url : '');
    if (url) return { url, headers: link.headers ?? {} };
  }
  return null;
}
