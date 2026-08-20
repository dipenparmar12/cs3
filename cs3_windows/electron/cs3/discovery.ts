import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { SearchResponse } from '../../src/types/api';
import type { HomeProviderRegistry } from './homeProviderRegistry.ts';
import type { HomeCatalogKind } from './homeProviders.ts';
import { getLogger } from '../logging/logger.ts';

/**
 * What is worth watching right now, from services that need no API key.
 *
 * The home screen used to be a fixed list. That is defensible for a week and
 * indefensible after that: an app whose front page never changes is one people
 * stop opening, and the whole premise of this product is that the catalogue is
 * bigger and fresher than any hard-coded list could be.
 *
 * ## Why these services
 *
 * The constraint is absolute and it eliminated most of the field: **the user
 * must not have to obtain an API key.** TMDB, Trakt, OMDb, Fanart and TheTVDB
 * all require one, and a key embedded in a distributed client is both a
 * licence violation and a key that gets revoked the week someone notices.
 *
 * What is left, and what each is for:
 *
 * - **Stremio's Cinemeta catalogs** (`cinemeta-catalogs.strem.io`) — keyless,
 *   IMDb-keyed, and it publishes three catalogues that map exactly onto the
 *   sections a home screen needs: `top` (Popular), `year` (New) and
 *   `imdbRating` (Featured), each for movies and series, each filterable by
 *   any of nineteen genres and pageable with `skip`. Its popularity numbers
 *   come from Trakt and TMDB, so the ordering reflects the same signal the
 *   keyed services sell.
 * - **AniList's public GraphQL** — keyless, and the only one of these that
 *   ranks anime properly. The Cinemeta catalogues have an Animation genre;
 *   they do not have seasonal anime.
 *
 * Both are already trusted elsewhere in this app for search and metadata, so
 * this adds no new hosts to the threat surface.
 *
 * ## What this deliberately does not do
 *
 * It finds **nothing playable**. Discovery produces catalogue items addressed
 * by IMDb id; sources are resolved by the extension providers when the user
 * opens one. Keeping that boundary is what lets the home screen be fast and
 * always populated while the provider ecosystem stays the thing that actually
 * streams.
 */


/**
 * How long a section is served before it is refreshed.
 *
 * Six hours: long enough that opening the app repeatedly in an evening costs
 * nothing, short enough that "trending" means today. Staleness is never a
 * reason to show an empty screen — see `sections`.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

/** Cached content is kept well past its TTL, as the offline fallback. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const FILE_NAME = 'cs3-discovery-cache.json';

const log = getLogger().child('discovery');

export type DiscoverySectionId =
  | 'trending'
  | 'popular-movies'
  | 'popular-series'
  | 'new-movies'
  | 'new-series'
  | 'featured'
  | 'trending-anime'
  | `genre:${string}`;

export interface DiscoverySection {
  id: DiscoverySectionId;
  title: string;
  /** One line explaining where the section comes from. */
  subtitle?: string;
  items: SearchResponse[];
  /** When these items were fetched, so the UI can say "updated 2h ago". */
  fetchedAt: number;
  /** True when the items are being refreshed behind the scenes. */
  refreshing?: boolean;
}

interface CachedSection {
  items: SearchResponse[];
  fetchedAt: number;
}

export class DiscoveryService {
  private providers: HomeProviderRegistry;
  private cache = new Map<string, CachedSection>();
  private inFlight = new Map<string, Promise<SearchResponse[]>>();
  private file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(providers: HomeProviderRegistry, directory?: string) {
    this.providers = providers;
    const base = directory ?? (app ? app.getPath('userData') : process.cwd());
    this.file = path.join(base, FILE_NAME);
    this.restore();
  }

  /**
   * Drops the rows built by whichever provider was active.
   *
   * Called when the selection changes. The cache is keyed by provider, so the
   * old entries are not *wrong* — they are simply someone else's catalogue, and
   * leaving them would have the home screen keep showing the previous
   * provider's rows until each one aged out six hours later.
   */
  public invalidateForProviderChange(): void {
    this.cache.clear();
    this.scheduleWrite();
  }

  private restore(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, CachedSection>;
      const cutoff = Date.now() - MAX_AGE_MS;
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value?.items) && typeof value.fetchedAt === 'number' && value.fetchedAt > cutoff) {
          this.cache.set(key, value);
        }
      }
    } catch {
      // No cache yet. The first launch fetches everything, which is the only
      // launch where the home screen has to wait for the network at all.
    }
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.cache)), 'utf8');
      } catch {
        // A cache that cannot be written costs a fetch on next launch.
      }
    }, 1_500);
    this.writeTimer.unref?.();
  }

  public flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.cache)), 'utf8');
    } catch {
      // Nothing worth reporting at shutdown.
    }
  }

  // --- fetching ------------------------------------------------------------

  private async section(key: string, load: () => Promise<SearchResponse[]>): Promise<CachedSection> {
    const cached = this.cache.get(key);
    const fresh = cached && Date.now() - cached.fetchedAt < TTL_MS;
    if (fresh) return cached;

    // One fetch per key, however many callers ask.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = load()
        .then((items) => {
          if (items.length > 0) {
            this.cache.set(key, { items, fetchedAt: Date.now() });
            this.scheduleWrite();
          }
          return items;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }

    // Something cached, however old, beats an empty screen — including when the
    // machine is offline, which is when a fixed home screen looked best and a
    // dynamic one must not look broken.
    if (cached) {
      void pending.catch(() => {});
      return cached;
    }

    try {
      return { items: await pending, fetchedAt: Date.now() };
    } catch {
      return { items: [], fetchedAt: 0 };
    }
  }

  // --- the home screen -----------------------------------------------------

  /**
   * Every section, in the order they should appear.
   *
   * `genres` personalises the tail: they come from what the user has actually
   * watched, so the sections below the fold are theirs rather than everyone's.
   * Nothing about that leaves the machine — the genre is used to pick a public
   * catalogue URL, and the catalogue is not told who asked.
   */
  /**
   * The rows, built from what the active provider actually publishes.
   *
   * This used to be a fixed list of six with Cinemeta's URLs baked into each
   * one. Deriving it from `capabilities()` is what makes the provider
   * replaceable in a way that means something: selecting AniList produces an
   * anime home screen rather than five empty headings and one row, and a
   * community catalogue addon that publishes only popular films produces
   * exactly that one row.
   */
  public async sections(options: { genres?: string[]; includeAnime?: boolean } = {}): Promise<
    DiscoverySection[]
  > {
    const { provider, fellBack } = this.providers.active();
    const capabilities = provider.capabilities();
    const available = new Set(capabilities.catalogs);

    /**
     * Keyed by provider as well as catalogue.
     *
     * Without the provider in the key, switching from Cinemeta to TMDB would
     * serve TMDB's row out of Cinemeta's cache entry — the same class of bug as
     * the stale-runtime trap, and just as hard to see, because both answers are
     * plausible catalogues of films.
     */
    const key = (suffix: string) => `${provider.id}:${suffix}`;

    const requested: Array<{
      id: DiscoverySectionId;
      title: string;
      subtitle?: string;
      key: string;
      load: () => Promise<SearchResponse[]>;
    }> = [];

    const add = (
      kind: HomeCatalogKind,
      id: DiscoverySectionId,
      title: string,
      subtitle?: string
    ) => {
      if (!available.has(kind)) return;
      requested.push({
        id,
        title,
        subtitle,
        key: key(kind),
        load: () => provider.fetch({ kind }),
      });
    };

    add('popular-movies', 'trending', 'Trending now', 'Most watched across the catalogue this week');
    add('popular-series', 'popular-series', 'Popular series');
    add('new-movies', 'new-movies', 'New releases', 'Recently released films');
    add('new-series', 'new-series', 'New episodes and seasons');
    add('top-rated', 'featured', 'Highest rated', 'By rating');

    /**
     * Anime comes from AniList even when it is not the selected provider.
     *
     * The alternative — showing anime only when AniList is chosen — would mean
     * choosing a film catalogue silently removes the anime row, which is not
     * what selecting a *film* catalogue means. AniList is additive here for the
     * same reason it is separate from the Animation genre: nothing else in the
     * roster ranks anime at all.
     */
    if (options.includeAnime !== false) {
      const anime = available.has('anime') ? provider : this.providers.get('anilist');
      if (anime) {
        requested.push({
          id: 'trending-anime',
          title: 'Trending anime',
          subtitle: 'This season, from AniList',
          key: `${anime.id}:anime`,
          load: () => anime.fetch({ kind: 'anime' }),
        });
      }
    }

    // Personalised rows, only where the provider can filter by genre at all.
    if (capabilities.genres.length > 0 && available.has('popular-movies')) {
      const known = new Set(capabilities.genres.map((genre) => genre.toLowerCase()));
      for (const genre of (options.genres ?? []).slice(0, 3)) {
        if (!known.has(genre.toLowerCase())) continue;
        requested.push({
          id: `genre:${genre}`,
          title: `Popular in ${genre}`,
          subtitle: 'Because of what you have been watching',
          key: key(`popular-movies:${genre}`),
          load: () => provider.fetch({ kind: 'popular-movies', genre }),
        });
      }
    }

    const resolved = await Promise.all(
      requested.map(async (entry) => {
        const section = await this.section(entry.key, entry.load);
        return {
          id: entry.id,
          title: entry.title,
          subtitle: entry.subtitle,
          items: section.items,
          fetchedAt: section.fetchedAt,
          refreshing: this.inFlight.has(entry.key),
        } satisfies DiscoverySection;
      })
    );

    if (fellBack) {
      log.warn('home_provider_fell_back', { provider: this.providers.selectedId });
    }

    // A section with nothing in it is noise, not information: the user cannot
    // act on "Trending anime is empty" and the heading takes up a screenful.
    return resolved.filter((section) => section.items.length > 0);
  }

  /** More of one section, for paging a row. */
  public async more(section: DiscoverySectionId, skip: number): Promise<SearchResponse[]> {
    const { provider } = this.providers.active();
    if (!provider.capabilities().paging) return [];

    if (section === 'trending' || section === 'popular-movies') {
      return provider.fetch({ kind: 'popular-movies', skip });
    }
    if (section === 'popular-series') return provider.fetch({ kind: 'popular-series', skip });
    if (section === 'new-movies') return provider.fetch({ kind: 'new-movies', skip });
    if (section === 'new-series') return provider.fetch({ kind: 'new-series', skip });
    if (section === 'featured') return provider.fetch({ kind: 'top-rated', skip });
    if (section === 'trending-anime') {
      const anime = this.providers.get('anilist');
      return anime ? anime.fetch({ kind: 'anime', skip }) : [];
    }
    if (section.startsWith('genre:')) {
      return provider.fetch({
        kind: 'popular-movies',
        genre: section.slice('genre:'.length),
        skip,
      });
    }
    return [];
  }

  /** Drops everything cached, so the next call refetches. Used by "refresh". */
  public invalidate(): void {
    this.cache.clear();
    this.scheduleWrite();
  }

  /** The genres the catalogues can actually filter by. */
  public static readonly GENRES = [
    'Action',
    'Adventure',
    'Animation',
    'Biography',
    'Comedy',
    'Crime',
    'Documentary',
    'Drama',
    'Family',
    'Fantasy',
    'History',
    'Horror',
    'Mystery',
    'Romance',
    'Sci-Fi',
    'Sport',
    'Thriller',
    'War',
    'Western',
  ];
}
