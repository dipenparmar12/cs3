import { TvType, type SearchResponse } from '../../src/types/api';

/**
 * What is *on* Netflix, when no installed extension can say.
 *
 * The OTT pages could only ever be as good as the provider behind them. Ask
 * `getMainPage` of a NetMirror provider and you get a real Netflix catalogue;
 * with nothing installed — or with an extension that registers a provider but
 * publishes no home page — the page is a search box and an apology, which is
 * not what someone opening "Netflix" wanted.
 *
 * ## Two different claims, and they must not be confused
 *
 * A provider catalogue says **"here is what this app can play"**. This says
 * **"here is what is on that service"** — nothing more. A row from here has no
 * source attached and may turn out to be unavailable through every installed
 * extension. That is a worse answer than a provider catalogue and a much better
 * one than an empty page, but it has to be *labelled*, because a grid of
 * posters that silently cannot play is the failure this codebase keeps having
 * to fix. `OttCatalogSection.origin` is what the view renders that label from.
 *
 * Opening a row runs the app's ordinary search across installed providers, the
 * way any catalogue item from the home screen already does. So the platform is
 * used for what it is genuinely good at — knowing what is worth watching — and
 * the extensions are used for what they are good at, which is finding it.
 *
 * ## Where the data comes from, and what that costs
 *
 * The "Streaming Catalogs" Stremio addon (`pw.ers.netflix-catalog`), which is
 * keyless and IMDb-keyed. Keyless is the binding constraint the home screen
 * already established: a key embedded in a distributed client is both a licence
 * violation and a key that gets revoked, which ruled out TMDB, Trakt and the
 * rest.
 *
 * It is a **community addon on someone else's hosting**, which is a real cost
 * and is why every failure here is soft: an unreachable catalogue leaves the
 * page exactly as it was before this existed, never an error. Verified on
 * 2026-09-01 — Netflix 97 titles, Prime Video 100, Disney+ 95, HBO Max 100,
 * Apple TV+ 99, with 0–4% pairwise overlap, so these are genuinely per-service
 * lists rather than one popularity list relabelled five times. (`9 to 5` on
 * both Prime and Disney+ is not a bug; Disney owns the Fox catalogue.)
 *
 * **Hotstar, Sony LIV, ZEE5 and JioCinema are not served by it.** They are left
 * without a fallback rather than given a generic popularity list under their
 * name — a page of titles that are not on ZEE5, labelled ZEE5, is worse than a
 * page that says it has nothing.
 */

const ADDON_BASE =
  'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club';

/**
 * Our platform ids to the addon's service codes.
 *
 * Deliberately partial. A platform absent from this map has no metadata
 * fallback and says so; inventing one by pointing it at a neighbouring service
 * would put the wrong catalogue under a brand name, which is exactly the
 * silent-and-plausible failure `ottPlatforms.ts` refuses for provider matching.
 */
const PLATFORM_CATALOGS: Record<string, string> = {
  netflix: 'nfx',
  primevideo: 'amp',
  disney: 'dnp',
};

/** Rows go stale slowly — these are editorial lists, not showtimes. */
const TTL_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 12_000;

export interface OttCatalogSection {
  id: string;
  title: string;
  items: SearchResponse[];
  /**
   * Where these rows came from, so the view can say.
   *
   * `metadata` rows are a claim about the *service*, not about this app: they
   * have no source attached and are resolved by searching providers when one is
   * opened.
   */
  origin: 'metadata';
}

interface CachedCatalog {
  at: number;
  sections: OttCatalogSection[];
}

interface StremioMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string;
  year?: string | number;
  imdbRating?: string | number;
  genres?: string[];
  type?: string;
}

export class OttCatalogService {
  private cache = new Map<string, CachedCatalog>();
  /** In-flight fetches, so opening a page twice does not fetch it twice. */
  private inFlight = new Map<string, Promise<OttCatalogSection[]>>();

  /** Whether this platform has a metadata catalogue at all. */
  public static supports(platformId: string): boolean {
    return platformId in PLATFORM_CATALOGS;
  }

  /**
   * The platform's catalogue, from cache when it is fresh.
   *
   * Never throws and never rejects. A page that had a catalogue a moment ago
   * keeps it when a refresh fails — stale rows are strictly better than an
   * empty grid, and this source is somebody else's hosting.
   */
  public async getCatalog(platformId: string): Promise<OttCatalogSection[]> {
    const code = PLATFORM_CATALOGS[platformId];
    if (!code) return [];

    const cached = this.cache.get(platformId);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.sections;

    const running = this.inFlight.get(platformId);
    if (running) return running;

    const task = this.fetchCatalog(platformId, code)
      .then((sections) => {
        if (sections.length > 0) {
          this.cache.set(platformId, { at: Date.now(), sections });
          return sections;
        }
        // Nothing came back: keep whatever was on screen rather than blanking it.
        return cached?.sections ?? [];
      })
      .catch(() => cached?.sections ?? [])
      .finally(() => {
        this.inFlight.delete(platformId);
      });

    this.inFlight.set(platformId, task);
    return task;
  }

  private async fetchCatalog(platformId: string, code: string): Promise<OttCatalogSection[]> {
    /*
     * Films and series are separate catalogues upstream and stay separate here.
     * Interleaving them would produce one row where a viewer looking for a
     * series has to scan past forty films, and the addon gives no ordering that
     * would survive a merge.
     */
    const [movies, series] = await Promise.all([
      this.fetchOne(`${ADDON_BASE}/catalog/movie/${code}.json`, 'movie'),
      this.fetchOne(`${ADDON_BASE}/catalog/series/${code}.json`, 'series'),
    ]);

    const sections: OttCatalogSection[] = [];
    if (movies.length > 0) {
      sections.push({
        id: `${platformId}:movies`,
        title: 'Popular films',
        items: movies,
        origin: 'metadata',
      });
    }
    if (series.length > 0) {
      sections.push({
        id: `${platformId}:series`,
        title: 'Popular series',
        items: series,
        origin: 'metadata',
      });
    }
    return sections;
  }

  private async fetchOne(url: string, type: 'movie' | 'series'): Promise<SearchResponse[]> {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return [];
    const body = (await response.json()) as { metas?: StremioMeta[] };
    return (body.metas ?? [])
      .map((meta) => this.toResult(meta, type))
      .filter((row): row is SearchResponse => row !== null);
  }

  /**
   * One catalogue row as an ordinary search result.
   *
   * Addressed `cs3meta://` — the same scheme the home screen's catalogue rows
   * use — which is what makes opening one run the app's normal discovery across
   * installed providers. A bespoke address would need its own route through
   * `ContentService` for no new behaviour.
   *
   * A row with no IMDb id is dropped rather than carried with a synthetic one.
   * The id is the entire basis on which providers and indexers match a title;
   * without it the row looks identical to the others and reliably finds nothing.
   */
  private toResult(meta: StremioMeta, type: 'movie' | 'series'): SearchResponse | null {
    const imdbId = meta.imdb_id ?? (meta.id?.startsWith('tt') ? meta.id : undefined);
    if (!imdbId || !meta.name) return null;

    const year =
      typeof meta.year === 'number'
        ? meta.year
        : Number.parseInt(String(meta.releaseInfo ?? meta.year ?? '').slice(0, 4), 10) || undefined;

    return {
      name: meta.name,
      url: `cs3meta://${imdbId}`,
      /*
       * Attributed to Cinemeta rather than to the addon, and that is not a
       * shortcut. `apiName` is read as "which catalogue is this a row from" by
       * the merge, the source filter and the provenance panel, and these rows
       * are Cinemeta-shaped, IMDb-keyed and merge with Cinemeta's own on the
       * same key. A second catalogue name here would split one title into two
       * rows that describe the same thing.
       */
      apiName: 'Cinemeta',
      type: type === 'series' ? TvType.TvSeries : TvType.Movie,
      posterUrl: meta.poster,
      year,
      imdbId,
    };
  }
}
