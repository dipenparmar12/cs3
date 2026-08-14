import type { DatastoreManager } from '../datastore';
import type { TvType } from '../../src/types/api';

/**
 * Saved detail pages, with enough origin to reopen the same one.
 *
 * The gap this fills: once a viewer leaves a details page there is no way back
 * to it. The only route is to remember which search produced it, run that
 * search again, wait for the same provider to answer, and find the same row —
 * and a provider that answered on Tuesday may not answer today, so the page can
 * be genuinely unreachable. "Add to library" does not solve it either: that
 * records a *title* for watch tracking, keyed on a normalised name so the same
 * film from five providers collapses into one entry. Deliberately so — but it
 * means the library cannot say which provider's page you were looking at.
 *
 * A bookmark is therefore the opposite shape: the exact address, the exact
 * provider, and the chain that produced it.
 *
 * ## What is stored, and what is not
 *
 * **Identity and origin are stored.** Media URL, provider, extension,
 * repository, metadata source, external ids, and the search that found it.
 * These are stable — a provider's own handle for a title does not change — and
 * they are what makes the page reopenable.
 *
 * **Resolved sources are not.** Playable links expire, sometimes within the
 * hour. Freezing them into a bookmark would produce a saved page that opens
 * and cannot play, which is a worse failure than one that has to re-resolve.
 * Metadata is cached as a *display* copy so the row can be drawn instantly, and
 * refreshed from the provider when the page is opened.
 *
 * Kept in the datastore rather than a private file, unlike diagnostics and
 * analytics: this is the user's own content, it is small, and it should travel
 * inside a backup with the rest of their library.
 */

const BOOKMARKS_KEY = 'saved_detail_pages';

/**
 * Cap on retained bookmarks.
 *
 * Generous, because these are explicit saves rather than automatic history and
 * nobody expects one to be evicted. High enough that the limit is effectively
 * theoretical while still bounding the datastore.
 */
const MAX_BOOKMARKS = 2_000;

/** Where a saved page came from, at every level that has a name. */
export interface BookmarkOrigin {
  /** The provider that served the detail page. */
  provider?: string;
  /** The archive that registered that provider. */
  extensionInternalName?: string;
  extensionName?: string;
  /** The repository that published that archive. */
  repositoryId?: string;
  repositoryName?: string;
  /** Cinemeta, TVmaze, AniList — set when the page came from a catalogue. */
  metadataSource?: string;
  /** The query that surfaced it, so the same search can be re-run. */
  searchQuery?: string;
  /** External identifiers, when any were resolved. */
  imdbId?: string;
  tmdbId?: string;
  anilistId?: string;
}

export interface Bookmark {
  /** Stable id: the media URL is the address and therefore the identity. */
  id: string;
  /** The address to reopen. `cs3ext://…`, a catalogue URL, or a magnet. */
  mediaUrl: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: TvType | string;
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  genres?: string[];
  rating?: number;
  duration?: string;
  origin: BookmarkOrigin;
  /** User's own note, for "watch with X" and similar. */
  note?: string;
  savedAt: number;
  /** Last time the page was reopened from here, for ordering by usefulness. */
  lastOpenedAt?: number;
  openCount: number;
}

export class BookmarkStore {
  private datastore: DatastoreManager;
  private bookmarks: Bookmark[] = [];

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
    this.restore();
  }

  private restore(): void {
    const stored = this.datastore.getObject<Bookmark[]>(BOOKMARKS_KEY, []);
    this.bookmarks = Array.isArray(stored)
      ? stored.filter((entry) => entry && typeof entry.mediaUrl === 'string' && entry.mediaUrl)
      : [];
  }

  private persist(): void {
    this.datastore.setObject(BOOKMARKS_KEY, this.bookmarks.slice(0, MAX_BOOKMARKS));
  }

  public list(): Bookmark[] {
    // Newest save first, which is what someone looking for "the thing I just
    // saved" expects. Ordering by last opened would bury it under old
    // favourites the moment they were reopened.
    return [...this.bookmarks].sort((a, b) => b.savedAt - a.savedAt);
  }

  public get(mediaUrl: string): Bookmark | null {
    return this.bookmarks.find((entry) => entry.mediaUrl === mediaUrl) ?? null;
  }

  public isSaved(mediaUrl: string): boolean {
    return this.bookmarks.some((entry) => entry.mediaUrl === mediaUrl);
  }

  /**
   * Saves or updates a page.
   *
   * Updating rather than duplicating on a repeat save, and merging rather than
   * replacing: a second visit may arrive with a poster the first did not have,
   * or with an IMDb id resolved since. Losing a field because the later visit
   * knew less than the earlier one would make the bookmark degrade with use.
   */
  public save(input: Omit<Bookmark, 'id' | 'savedAt' | 'openCount'>): Bookmark {
    const existing = this.bookmarks.find((entry) => entry.mediaUrl === input.mediaUrl);
    if (existing) {
      Object.assign(existing, {
        ...input,
        origin: { ...existing.origin, ...prune(input.origin) },
        title: input.title || existing.title,
        posterUrl: input.posterUrl ?? existing.posterUrl,
        plot: input.plot ?? existing.plot,
        genres: input.genres ?? existing.genres,
      });
      this.persist();
      return existing;
    }

    const bookmark: Bookmark = {
      ...input,
      id: input.mediaUrl,
      savedAt: Date.now(),
      openCount: 0,
    };
    this.bookmarks.unshift(bookmark);
    if (this.bookmarks.length > MAX_BOOKMARKS) this.bookmarks.length = MAX_BOOKMARKS;
    this.persist();
    return bookmark;
  }

  public remove(mediaUrl: string): boolean {
    const before = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((entry) => entry.mediaUrl !== mediaUrl);
    if (this.bookmarks.length === before) return false;
    this.persist();
    return true;
  }

  public toggle(input: Omit<Bookmark, 'id' | 'savedAt' | 'openCount'>): {
    saved: boolean;
    bookmark: Bookmark | null;
  } {
    if (this.isSaved(input.mediaUrl)) {
      this.remove(input.mediaUrl);
      return { saved: false, bookmark: null };
    }
    return { saved: true, bookmark: this.save(input) };
  }

  /** Records a reopen, which is what makes "most used" orderings possible later. */
  public markOpened(mediaUrl: string): void {
    const entry = this.bookmarks.find((bookmark) => bookmark.mediaUrl === mediaUrl);
    if (!entry) return;
    entry.lastOpenedAt = Date.now();
    entry.openCount += 1;
    this.persist();
  }

  public setNote(mediaUrl: string, note: string | undefined): Bookmark | null {
    const entry = this.bookmarks.find((bookmark) => bookmark.mediaUrl === mediaUrl);
    if (!entry) return null;
    entry.note = note?.trim() || undefined;
    this.persist();
    return entry;
  }

  /**
   * Every provider that any saved page came from.
   *
   * The "next time filter to only this content" the product brief asks for
   * needs a list to filter *by*, and this is it — derived from what the user
   * has actually saved rather than from the whole installed catalogue.
   */
  public originFacets(): {
    providers: string[];
    repositories: Array<{ id: string; name: string }>;
    types: string[];
  } {
    const providers = new Set<string>();
    const repositories = new Map<string, string>();
    const types = new Set<string>();
    for (const entry of this.bookmarks) {
      if (entry.origin.provider) providers.add(entry.origin.provider);
      if (entry.origin.repositoryId) {
        repositories.set(entry.origin.repositoryId, entry.origin.repositoryName ?? entry.origin.repositoryId);
      }
      if (entry.type) types.add(String(entry.type));
    }
    return {
      providers: [...providers].sort(),
      repositories: [...repositories.entries()].map(([id, name]) => ({ id, name })),
      types: [...types].sort(),
    };
  }
}

/** Drops undefined keys so a merge cannot overwrite a known value with nothing. */
function prune<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value) as Array<[keyof T, T[keyof T]]>) {
    if (entry !== undefined && entry !== null && entry !== '') out[key] = entry;
  }
  return out;
}
