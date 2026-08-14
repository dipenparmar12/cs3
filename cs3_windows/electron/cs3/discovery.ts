import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { fetchJson } from '../torrent/http';
import { TvType, type SearchResponse } from '../../src/types/api';
import { buildCinemetaUrl } from '../cinemeta';

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

/** The Popular/New/Featured catalogues, which live on a different host to `meta`. */
const CATALOG_BASE = 'https://cinemeta-catalogs.strem.io';
const ANILIST = 'https://graphql.anilist.co';

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

interface CinemetaCatalogMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  type?: string;
  poster?: string;
  genre?: string[];
  genres?: string[];
  releaseInfo?: string;
  year?: string | number;
  imdbRating?: string;
  description?: string;
}

interface CatalogResponse {
  metas?: CinemetaCatalogMeta[];
}

function parseYear(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (!value) return undefined;
  const match = /(\d{4})/.exec(String(value));
  return match ? parseInt(match[1], 10) : undefined;
}

function toTvType(type: string | undefined, genres: string[] | undefined): TvType {
  const isAnime = (genres ?? []).some((genre) => /animation|anime/i.test(genre));
  if (type === 'series') return isAnime ? TvType.Anime : TvType.TvSeries;
  return isAnime ? TvType.AnimeMovie : TvType.Movie;
}

export class DiscoveryService {
  private cache = new Map<string, CachedSection>();
  private inFlight = new Map<string, Promise<SearchResponse[]>>();
  private file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(directory?: string) {
    const base = directory ?? (app ? app.getPath('userData') : process.cwd());
    this.file = path.join(base, FILE_NAME);
    this.restore();
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

  private catalogUrl(
    catalog: 'top' | 'year' | 'imdbRating',
    type: 'movie' | 'series',
    extra?: { genre?: string; skip?: number }
  ): string {
    const parts: string[] = [];
    if (extra?.genre) parts.push(`genre=${encodeURIComponent(extra.genre)}`);
    if (extra?.skip) parts.push(`skip=${extra.skip}`);
    const suffix = parts.length > 0 ? `/${parts.join('&')}` : '';
    return `${CATALOG_BASE}/${catalog}/catalog/${type}/${catalog}${suffix}.json`;
  }

  private async fetchCatalog(
    catalog: 'top' | 'year' | 'imdbRating',
    type: 'movie' | 'series',
    extra?: { genre?: string; skip?: number }
  ): Promise<SearchResponse[]> {
    const response = await fetchJson<CatalogResponse>(this.catalogUrl(catalog, type, extra), {
      timeoutMs: 15_000,
    });

    const out: SearchResponse[] = [];
    for (const meta of response.metas ?? []) {
      const imdbId = meta.imdb_id || meta.id;
      // Without an IMDb id the item cannot be addressed, and an unaddressable
      // poster on the home screen is a card that does nothing when clicked.
      if (!imdbId?.startsWith('tt') || !meta.name) continue;
      out.push({
        name: meta.name,
        url: buildCinemetaUrl(type, imdbId),
        apiName: 'Catalogue',
        type: toTvType(type, meta.genre ?? meta.genres),
        posterUrl: meta.poster,
        year: parseYear(meta.releaseInfo ?? meta.year),
      });
    }
    return out;
  }

  /**
   * Seasonal anime, from AniList.
   *
   * Separate from the catalogues rather than folded into the Animation genre:
   * "Animation" on IMDb is mostly Western film, and an anime section built from
   * it returns Pixar. The audiences barely overlap and neither is served by the
   * merge.
   */
  private async fetchTrendingAnime(): Promise<SearchResponse[]> {
    const query = `
      query {
        Page(perPage: 24) {
          media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
            idMal
            title { romaji english }
            coverImage { large }
            seasonYear
            format
          }
        }
      }`;

    const response = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`AniList returned ${response.status}`);

    const payload = (await response.json()) as {
      data?: {
        Page?: {
          media?: Array<{
            idMal?: number;
            title?: { romaji?: string; english?: string };
            coverImage?: { large?: string };
            seasonYear?: number;
            format?: string;
          }>;
        };
      };
    };

    const out: SearchResponse[] = [];
    for (const media of payload.data?.Page?.media ?? []) {
      const name = media.title?.english || media.title?.romaji;
      if (!name) continue;
      // Addressed by title rather than by id: AniList ids are not IMDb ids, and
      // the extension providers this app streams from search by name. Using the
      // title keeps the card clickable through the ordinary search path.
      out.push({
        name,
        url: `search://${encodeURIComponent(name)}`,
        apiName: 'AniList',
        type: media.format === 'MOVIE' ? TvType.AnimeMovie : TvType.Anime,
        posterUrl: media.coverImage?.large,
        year: media.seasonYear,
      });
    }
    return out;
  }

  /**
   * Serves a section, refreshing behind the answer rather than in front of it.
   *
   * Stale-while-revalidate, and the "while" is the important half. A home
   * screen that waits for six network calls before it draws anything is a home
   * screen with a spinner on it every morning; one that draws yesterday's
   * trending list instantly and quietly replaces it a second later is
   * indistinguishable from instant.
   */
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
  public async sections(options: { genres?: string[]; includeAnime?: boolean } = {}): Promise<
    DiscoverySection[]
  > {
    const requested: Array<{
      id: DiscoverySectionId;
      title: string;
      subtitle?: string;
      key: string;
      load: () => Promise<SearchResponse[]>;
    }> = [
      {
        id: 'trending',
        title: 'Trending now',
        subtitle: 'Most watched across the catalogue this week',
        key: 'top:movie',
        load: () => this.fetchCatalog('top', 'movie'),
      },
      {
        id: 'popular-series',
        title: 'Popular series',
        key: 'top:series',
        load: () => this.fetchCatalog('top', 'series'),
      },
      {
        id: 'new-movies',
        title: 'New releases',
        subtitle: 'Recently released films',
        key: 'year:movie',
        load: () => this.fetchCatalog('year', 'movie'),
      },
      {
        id: 'new-series',
        title: 'New episodes and seasons',
        key: 'year:series',
        load: () => this.fetchCatalog('year', 'series'),
      },
      {
        id: 'featured',
        title: 'Highest rated',
        subtitle: 'By IMDb rating',
        key: 'imdbRating:movie',
        load: () => this.fetchCatalog('imdbRating', 'movie'),
      },
    ];

    if (options.includeAnime !== false) {
      requested.push({
        id: 'trending-anime',
        title: 'Trending anime',
        subtitle: 'This season, from AniList',
        key: 'anilist:trending',
        load: () => this.fetchTrendingAnime(),
      });
    }

    for (const genre of (options.genres ?? []).slice(0, 3)) {
      requested.push({
        id: `genre:${genre}`,
        title: `Popular in ${genre}`,
        subtitle: 'Because of what you have been watching',
        key: `top:movie:${genre}`,
        load: () => this.fetchCatalog('top', 'movie', { genre }),
      });
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

    // A section with nothing in it is noise, not information: the user cannot
    // act on "Trending anime is empty" and the heading takes up a screenful.
    return resolved.filter((section) => section.items.length > 0);
  }

  /** More of one section, for paging a row. */
  public async more(
    section: DiscoverySectionId,
    skip: number
  ): Promise<SearchResponse[]> {
    if (section === 'trending' || section === 'popular-movies') {
      return this.fetchCatalog('top', 'movie', { skip });
    }
    if (section === 'popular-series') return this.fetchCatalog('top', 'series', { skip });
    if (section === 'new-movies') return this.fetchCatalog('year', 'movie', { skip });
    if (section === 'new-series') return this.fetchCatalog('year', 'series', { skip });
    if (section === 'featured') return this.fetchCatalog('imdbRating', 'movie', { skip });
    if (section.startsWith('genre:')) {
      return this.fetchCatalog('top', 'movie', { genre: section.slice('genre:'.length), skip });
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
