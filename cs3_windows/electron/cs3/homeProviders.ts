import { fetchJson } from '../torrent/http.ts';
import { TvType, type SearchResponse } from '../../src/types/api.ts';
import { buildCinemetaUrl } from '../cinemeta.ts';

/**
 * Where the home screen's catalogue comes from, as something replaceable.
 *
 * The home screen was wired directly to Stremio's Cinemeta catalogs. That is a
 * good default and a bad *only* option: a single upstream is a single point of
 * failure for the first screen of the app, its taste is not everyone's, and
 * when it is slow or down there is nothing to fall back to except an empty
 * page.
 *
 * ## The constraint that shapes the roster
 *
 * **A user must not have to obtain an API key to use the app.** That is what
 * eliminated TMDB, Trakt, OMDb, Fanart and TheTVDB from the built-in set, and
 * it has not changed: a key embedded in a distributed client is a licence
 * violation and a key that gets revoked the week someone notices.
 *
 * What that leaves is not "one provider". It leaves every *keyless* catalogue,
 * and the Stremio catalog protocol is the useful discovery here — it is one
 * documented GET shape (`/catalog/{type}/{id}.json`) served by Cinemeta and by
 * a whole ecosystem of community addons. Supporting the protocol rather than
 * the host means a user with a working addon URL gets it working here without
 * anyone writing an adapter, which is the same bet the indexer layer already
 * makes with Torznab and Stremio stream addons.
 *
 * TMDB is offered too, and honestly: it is listed, it is described as needing a
 * key, and it is selectable only once the *user* supplies one. That is the only
 * version of TMDB support that is not a licence problem, and pretending
 * otherwise would ship a feature that breaks when the key is revoked.
 *
 * ## Capabilities, not a fixed section list
 *
 * Providers do not offer the same things. Cinemeta has popular, new and
 * top-rated for both films and series across nineteen genres; AniList ranks
 * seasonal anime and nothing else; a community addon might publish one
 * catalogue. So a provider *declares* what it has and the home screen builds
 * the sections that are actually available, rather than rendering six headings
 * and hoping.
 */

export type HomeCatalogKind =
  | 'popular-movies'
  | 'popular-series'
  | 'new-movies'
  | 'new-series'
  | 'top-rated'
  | 'anime';

export interface HomeProviderCapabilities {
  /** Which catalogues this provider can answer at all. */
  catalogs: HomeCatalogKind[];
  /** Genres it can filter by. Empty means "no genre filtering". */
  genres: string[];
  /** Whether `skip` paging works, which decides if a row can load more. */
  paging: boolean;
}

export type HomeProviderStatus = 'healthy' | 'degraded' | 'unavailable' | 'unchecked';

export interface HomeProviderHealth {
  id: string;
  name: string;
  status: HomeProviderStatus;
  /** Round-trip for one real catalogue request, not a HEAD or a ping. */
  latencyMs?: number;
  checkedAt: number;
  /** How many usable items the probe returned. */
  items?: number;
  /** How many of those had artwork — a catalogue of blank cards is not usable. */
  withArtwork?: number;
  /** Why it is not healthy, in words a person can act on. */
  reason?: string;
  /** True when the provider needs a key the user has not supplied. */
  needsKey?: boolean;
}

export interface HomeCatalogRequest {
  kind: HomeCatalogKind;
  genre?: string;
  skip?: number;
  limit?: number;
}

export interface HomeProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Set when the provider cannot work until the user supplies credentials. */
  readonly requiresKey?: boolean;
  capabilities(): HomeProviderCapabilities;
  fetch(request: HomeCatalogRequest): Promise<SearchResponse[]>;
}

/**
 * The health bar, and why each number is here.
 *
 * A provider is not "up" because it answered. The failure this guards against
 * is the one that actually happens to catalogue APIs: a 200 with an empty
 * `metas` array, or a page of entries with no artwork and no ids — which renders
 * as a home screen of blank cards that do nothing when clicked, and reads as
 * *our* bug rather than theirs.
 */
const HEALTH_MIN_ITEMS = 5;
const HEALTH_MIN_ARTWORK_RATIO = 0.5;
/** Above this a provider still works but the home screen feels broken. */
const DEGRADED_LATENCY_MS = 2_500;
const HEALTH_TIMEOUT_MS = 8_000;

/** Health is re-probed no more often than this; the answer barely moves. */
export const HEALTH_TTL_MS = 10 * 60 * 1000;

// --- Stremio catalog protocol ----------------------------------------------

interface CatalogMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  poster?: string;
  releaseInfo?: string;
  year?: string | number;
  genre?: string[];
  genres?: string[];
  type?: string;
}

const STREMIO_GENRES = [
  'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary',
  'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance',
  'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western',
];

function parseYear(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value;
  const match = String(value ?? '').match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

function toTvType(type: 'movie' | 'series', genres?: string[]): TvType {
  if (genres?.some((genre) => /anime/i.test(genre))) return TvType.Anime;
  return type === 'series' ? TvType.TvSeries : TvType.Movie;
}

/**
 * Any Stremio catalog addon, including Cinemeta.
 *
 * One class rather than a Cinemeta-specific one because the protocol is the
 * thing worth implementing: `/{catalog}/catalog/{type}/{id}[/{extra}].json`
 * is served identically by Cinemeta and by every community catalogue addon, so
 * supporting it once means a user with an addon URL is supported without anyone
 * writing anything.
 */
export class StremioCatalogProvider implements HomeProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly description: string;
  private readonly base: string;

  constructor(options: { id: string; name: string; description: string; baseUrl: string }) {
    this.id = options.id;
    this.name = options.name;
    this.description = options.description;
    this.base = options.baseUrl.replace(/\/+$/, '');
  }

  public capabilities(): HomeProviderCapabilities {
    return {
      catalogs: ['popular-movies', 'popular-series', 'new-movies', 'new-series', 'top-rated'],
      genres: STREMIO_GENRES,
      paging: true,
    };
  }

  /** Cinemeta's three catalogue ids, which the whole protocol family mirrors. */
  private route(kind: HomeCatalogKind): { catalog: string; type: 'movie' | 'series' } | null {
    switch (kind) {
      case 'popular-movies':
        return { catalog: 'top', type: 'movie' };
      case 'popular-series':
        return { catalog: 'top', type: 'series' };
      case 'new-movies':
        return { catalog: 'year', type: 'movie' };
      case 'new-series':
        return { catalog: 'year', type: 'series' };
      case 'top-rated':
        return { catalog: 'imdbRating', type: 'movie' };
      default:
        return null;
    }
  }

  public async fetch(request: HomeCatalogRequest): Promise<SearchResponse[]> {
    const route = this.route(request.kind);
    if (!route) return [];

    const extra: string[] = [];
    if (request.genre) extra.push(`genre=${encodeURIComponent(request.genre)}`);
    if (request.skip) extra.push(`skip=${request.skip}`);
    const suffix = extra.length > 0 ? `/${extra.join('&')}` : '';
    const url = `${this.base}/${route.catalog}/catalog/${route.type}/${route.catalog}${suffix}.json`;

    const response = await fetchJson<{ metas?: CatalogMeta[] }>(url, { timeoutMs: 15_000 });

    const out: SearchResponse[] = [];
    for (const meta of response.metas ?? []) {
      const imdbId = meta.imdb_id || meta.id;
      /**
       * Without an IMDb id the item cannot be addressed, and an unaddressable
       * poster is a card that does nothing when clicked — which reads as a bug
       * in this app rather than a gap in someone's catalogue.
       */
      if (!imdbId?.startsWith('tt') || !meta.name) continue;
      out.push({
        name: meta.name,
        /**
         * The app's own metadata address, not a scheme invented here. Every
         * card the home screen renders is opened by `parseCinemetaUrl`, so a
         * different shape would produce posters that look fine and do nothing
         * when clicked.
         */
        url: buildCinemetaUrl(route.type, imdbId),
        apiName: 'Catalogue',
        type: toTvType(route.type, meta.genre ?? meta.genres),
        posterUrl: meta.poster,
        year: parseYear(meta.releaseInfo ?? meta.year),
      });
    }
    return request.limit ? out.slice(0, request.limit) : out;
  }
}

// --- AniList ----------------------------------------------------------------

/**
 * Seasonal anime, and only that.
 *
 * Declared as a one-catalogue provider rather than pretending to a full
 * roster, which is exactly what the capability model is for: selecting it as
 * the home provider yields an anime home screen, not five empty headings.
 *
 * It stays separate from the Animation genre for the reason it always has:
 * "Animation" on IMDb is mostly Western film, and an anime row built from it
 * returns Pixar.
 */
export class AniListProvider implements HomeProvider {
  public readonly id = 'anilist';
  public readonly name = 'AniList';
  public readonly description = 'Seasonal and trending anime. Keyless, and the only one of these that ranks anime properly.';

  public capabilities(): HomeProviderCapabilities {
    return { catalogs: ['anime'], genres: [], paging: true };
  }

  public async fetch(request: HomeCatalogRequest): Promise<SearchResponse[]> {
    if (request.kind !== 'anime') return [];
    const perPage = Math.min(50, request.limit ?? 24);
    const page = Math.floor((request.skip ?? 0) / perPage) + 1;

    const query = `
      query($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
            title { romaji english }
            coverImage { large }
            seasonYear
            format
          }
        }
      }`;

    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { page, perPage } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`AniList answered HTTP ${response.status}`);

    const body = (await response.json()) as {
      data?: { Page?: { media?: Array<Record<string, unknown>> } };
    };

    const out: SearchResponse[] = [];
    for (const media of body.data?.Page?.media ?? []) {
      const title = media.title as { romaji?: string; english?: string } | undefined;
      const name = title?.english || title?.romaji;
      if (!name) continue;
      out.push({
        name,
        /**
         * Addressed by title, not by id. AniList ids are not IMDb ids and the
         * extension providers this app streams from search by name — so the
         * title is what keeps the card clickable through the ordinary search
         * path. An `anilist://` id would render a poster that does nothing.
         */
        url: `search://${encodeURIComponent(name)}`,
        apiName: 'AniList',
        type: media.format === 'MOVIE' ? TvType.AnimeMovie : TvType.Anime,
        posterUrl: (media.coverImage as { large?: string } | undefined)?.large,
        year: typeof media.seasonYear === 'number' ? media.seasonYear : undefined,
      });
    }
    return out;
  }
}

const ANILIST_URL = 'https://graphql.anilist.co';

// --- TMDB, only with the user's own key -------------------------------------

/**
 * TMDB, which needs a key the user supplies.
 *
 * Included because it is the best catalogue of the lot and people ask for it by
 * name; gated because there is no lawful way to ship one. A key embedded in a
 * distributed client violates TMDB's terms and gets revoked, at which point the
 * home screen breaks for everyone at once with no way for any individual user
 * to fix it. A key the user pastes in belongs to them and cannot do that.
 *
 * Until one is supplied this reports `unavailable` with `needsKey`, so it
 * appears in the list — you can see it exists and what it needs — and cannot be
 * selected.
 */
export class TmdbProvider implements HomeProvider {
  public readonly id = 'tmdb';
  public readonly name = 'TMDB';
  public readonly description =
    'The Movie Database. Needs a free API key from themoviedb.org, which you supply — one cannot be shipped with the app.';
  public readonly requiresKey = true;

  private readonly key: () => string;

  constructor(key: () => string) {
    this.key = key;
  }

  public capabilities(): HomeProviderCapabilities {
    return {
      catalogs: ['popular-movies', 'popular-series', 'new-movies', 'new-series', 'top-rated'],
      genres: [
        'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
        'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi',
        'Thriller', 'War', 'Western',
      ],
      paging: true,
    };
  }

  public async fetch(request: HomeCatalogRequest): Promise<SearchResponse[]> {
    const key = this.key();
    if (!key) throw new Error('No TMDB API key has been set.');

    const isSeries = request.kind === 'popular-series' || request.kind === 'new-series';
    const media = isSeries ? 'tv' : 'movie';
    const path =
      request.kind === 'top-rated'
        ? 'top_rated'
        : request.kind === 'new-movies'
          ? 'now_playing'
          : request.kind === 'new-series'
            ? 'on_the_air'
            : 'popular';

    const page = Math.floor((request.skip ?? 0) / 20) + 1;
    const url = `https://api.themoviedb.org/3/${media}/${path}?api_key=${encodeURIComponent(key)}&page=${page}`;

    const body = await fetchJson<{
      results?: Array<{
        id?: number;
        title?: string;
        name?: string;
        poster_path?: string;
        release_date?: string;
        first_air_date?: string;
      }>;
    }>(url, { timeoutMs: 15_000 });

    const out: SearchResponse[] = [];
    for (const item of body.results ?? []) {
      const name = item.title || item.name;
      if (!name || !item.id) continue;
      out.push({
        name,
        /**
         * Addressed by title, for the same reason AniList is: a TMDB id is not
         * an IMDb id, nothing downstream resolves one, and a `tmdb://` URL
         * would produce a poster that does nothing when clicked. The search
         * path handles it, and the title enricher reconciles it to a real item.
         */
        url: `search://${encodeURIComponent(name)}`,
        apiName: 'TMDB',
        type: isSeries ? TvType.TvSeries : TvType.Movie,
        posterUrl: item.poster_path
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : undefined,
        year: parseYear(item.release_date ?? item.first_air_date),
      });
    }
    return out;
  }
}

// --- health -----------------------------------------------------------------

/**
 * Whether a provider is actually usable, measured with a real request.
 *
 * Not a ping and not a HEAD. The failures worth catching here — an empty
 * `metas`, entries with no ids, a page of items with no artwork — all return
 * 200 from a healthy-looking server, so the only test that means anything is
 * asking for the catalogue the home screen would ask for and looking at what
 * comes back.
 */
export async function checkProvider(provider: HomeProvider): Promise<HomeProviderHealth> {
  const base = { id: provider.id, name: provider.name, checkedAt: Date.now() };

  const kind = provider.capabilities().catalogs[0];
  if (!kind) {
    return { ...base, status: 'unavailable', reason: 'It publishes no catalogues.' };
  }

  const startedAt = Date.now();
  try {
    const items = await Promise.race([
      provider.fetch({ kind, limit: 20 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out')), HEALTH_TIMEOUT_MS)
      ),
    ]);
    const latencyMs = Date.now() - startedAt;
    const withArtwork = items.filter((item) => item.posterUrl).length;

    if (items.length < HEALTH_MIN_ITEMS) {
      return {
        ...base,
        status: 'unavailable',
        latencyMs,
        items: items.length,
        withArtwork,
        reason: `It answered but returned only ${items.length} usable items.`,
      };
    }

    /**
     * Artwork is a completeness test, not a cosmetic one. A catalogue of
     * unposted cards is unusable as a *browsing* surface, which is the only
     * thing the home screen is for.
     */
    if (withArtwork / items.length < HEALTH_MIN_ARTWORK_RATIO) {
      return {
        ...base,
        status: 'degraded',
        latencyMs,
        items: items.length,
        withArtwork,
        reason: `Only ${withArtwork} of ${items.length} items have artwork.`,
      };
    }

    if (latencyMs > DEGRADED_LATENCY_MS) {
      return {
        ...base,
        status: 'degraded',
        latencyMs,
        items: items.length,
        withArtwork,
        reason: `It works, but took ${(latencyMs / 1000).toFixed(1)}s to answer.`,
      };
    }

    return { ...base, status: 'healthy', latencyMs, items: items.length, withArtwork };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const needsKey = Boolean(provider.requiresKey) && /api key/i.test(raw);
    /**
     * `fetch failed` is what Node says for DNS failures, refused connections and
     * TLS errors alike, and it is useless in a settings panel — someone reading
     * it cannot tell a typo in an addon URL from a service being down. The
     * common causes get named; anything else is passed through, because an
     * unfamiliar message is still better than a wrong one.
     */
    const reason = needsKey
      ? 'It needs an API key, which has not been set.'
      : /timed out/i.test(raw)
        ? `It did not answer within ${HEALTH_TIMEOUT_MS / 1000}s.`
        : /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(raw)
          ? 'It could not be reached — check the address, or your connection.'
          : raw;

    return { ...base, status: 'unavailable', latencyMs: Date.now() - startedAt, needsKey, reason };
  }
}

/** A provider may be chosen only if it is actually answering. */
export function isSelectable(health: HomeProviderHealth | undefined): boolean {
  return health?.status === 'healthy' || health?.status === 'degraded';
}
