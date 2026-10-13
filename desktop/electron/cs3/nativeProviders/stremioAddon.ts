/**
 * Any Stremio addon, as a provider — the lane that keeps paying after we ship.
 *
 * What is supported here is the **protocol**, not a host, so an addon published
 * next year works with no adapter. That is the same bet the indexer layer
 * already makes with Torznab and with `StremioAddonIndexer`, and it is the
 * reason this is worth more than any single source in the roster.
 *
 * ## What was already here, and what was missing
 *
 * Measured against `api.strem.io/addonscollection.json` on 2026-09-07 — 95
 * addons, by resource: **subtitles 42 · catalog 40 · meta 23 · stream 19**.
 *
 * | Resource | Before | Now |
 * |---|---|---|
 * | `catalog` | home screen only (`StremioCatalogProvider`) | searchable and browseable |
 * | `stream`  | indexer registry, torrents + direct URLs | also here, bound to the row's own addon |
 * | `meta`    | not implemented | detail pages |
 * | `subtitles` | one host hardcoded in `subtitleService` | any addon the user adds |
 *
 * Note the shape of that table: the single most-served resource in the whole
 * ecosystem was the one thing we consumed from exactly one hardcoded host.
 *
 * ## Three rules that came out of probing real addons
 *
 * **`idPrefixes` is a hard constraint, not a hint.** Asking Anime Kitsu for
 * `tt0063350` answers **HTTP 500**, not an empty list — measured. An addon that
 * only speaks `kitsu:`/`mal:`/`anilist:` treats an IMDb id as malformed. So
 * every request checks the prefix first, and an addon that cannot address an id
 * is skipped silently rather than counted as a failure: it is not broken, it was
 * asked the wrong question.
 *
 * **A declared `extra` list under-reports what works.** TMDB's catalogue
 * declares only `genre` and `skip`, and `search=dune` against it returns 23
 * correct results anyway. So search is *attempted* wherever a catalogue of the
 * right type exists, and a refusal is taken as "this catalogue does not search"
 * rather than trusted from the manifest. The opposite policy — believing the
 * manifest — would have silently disabled search on one of the two best
 * catalogue addons in the ecosystem.
 *
 * **The manifest is fetched once, when the addon is added.** `capabilities()`
 * is synchronous and the roster has to render instantly, so validation happens
 * at add time and the manifest is stored. That also means a URL that is not an
 * addon is rejected in front of the user, rather than becoming a provider that
 * silently answers nothing.
 *
 * ## What is deliberately not done here
 *
 * No addon is bundled and no default is added. The URL is user-supplied,
 * exactly as a Torznab URL already is, so no host is blessed — and a debrid
 * account the user has already configured elsewhere reaches this app by pasting
 * the URL they already have.
 */
import { fetchJson } from '../../torrent/http.ts';
import {
  TvType,
  type ExtractorLink,
  type LoadResponse,
  type SearchResponse,
  type SubtitleFile,
} from '../../../src/types/api.ts';
import type {
  NativeCapabilities,
  NativeCatalogRequest,
  NativeCatalogSection,
  NativeProvider,
} from './types.ts';
import { nativeAddress } from './types.ts';

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 40;

export interface StremioCatalogDef {
  type: string;
  id: string;
  name?: string;
  extra?: Array<{ name?: string } | string>;
}

export interface StremioManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  types?: string[];
  resources?: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>;
  catalogs?: StremioCatalogDef[];
  idPrefixes?: string[];
}

interface StremioMeta {
  id?: string;
  imdb_id?: string;
  name?: string;
  type?: string;
  poster?: string;
  background?: string;
  description?: string;
  releaseInfo?: string | number;
  year?: string | number;
  imdbRating?: string | number;
  genre?: string[];
  genres?: string[];
  cast?: string[];
  runtime?: string;
  videos?: Array<{
    id?: string;
    title?: string;
    name?: string;
    season?: number;
    episode?: number;
    released?: string;
    thumbnail?: string;
    overview?: string;
  }>;
}

interface StremioStream {
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  ytId?: string;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: { request?: Record<string, string> };
    videoSize?: number;
    filename?: string;
  };
  subtitles?: Array<{ url?: string; lang?: string; id?: string }>;
}

/** Stremio's content types onto ours. */
const TYPE_MAP: Record<string, TvType> = {
  movie: TvType.Movie,
  series: TvType.TvSeries,
  anime: TvType.Anime,
  tv: TvType.Live,
  channel: TvType.Live,
};

export function normaliseBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/manifest\.json$/i, '');
}

/** Resource names an addon declares, flattened across both manifest spellings. */
export function resourceNames(manifest: StremioManifest): string[] {
  return (manifest.resources ?? []).map((r) => (typeof r === 'string' ? r : r.name));
}

/**
 * Whether this addon can address that id at all.
 *
 * An addon with no `idPrefixes` accepts anything (that is the spec's default);
 * one that declares them answers **500** for an id outside the set, so the
 * check has to happen before the request rather than around it.
 */
export function acceptsId(manifest: StremioManifest, id: string): boolean {
  const prefixes = manifest.idPrefixes;
  if (!prefixes || prefixes.length === 0) return true;
  return prefixes.some((prefix) => id.startsWith(prefix));
}

export function toTvType(type: string | undefined): TvType {
  return TYPE_MAP[(type ?? '').toLowerCase()] ?? TvType.Movie;
}

function yearOf(meta: StremioMeta): number | undefined {
  const raw = String(meta.year ?? meta.releaseInfo ?? '');
  const match = raw.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

/** `<type>|<id>` — a Stremio id means nothing without the type it belongs to. */
export function packHandle(type: string, id: string): string {
  return `${type}|${id}`;
}

export function unpackHandle(handle: string): { type: string; id: string } {
  const bar = handle.indexOf('|');
  if (bar <= 0) return { type: 'movie', id: handle };
  return { type: handle.slice(0, bar), id: handle.slice(bar + 1) };
}

export interface StremioAddonOptions {
  /** Stable id for this addon within the app; part of every address it mints. */
  localId: string;
  baseUrl: string;
  manifest: StremioManifest;
}

export class StremioAddonProvider implements NativeProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly types: TvType[];

  private readonly base: string;
  private readonly manifest: StremioManifest;

  constructor(options: StremioAddonOptions) {
    this.id = options.localId;
    this.base = normaliseBase(options.baseUrl);
    this.manifest = options.manifest;
    this.name = options.manifest.name || options.localId;
    this.description =
      options.manifest.description?.trim() ||
      `Stremio addon at ${this.base}. Supplies ${resourceNames(options.manifest).join(', ') || 'nothing'}.`;
    this.types = [...new Set((options.manifest.types ?? []).map(toTvType))];
  }

  capabilities(): NativeCapabilities {
    const resources = resourceNames(this.manifest);
    const catalogs = this.manifest.catalogs ?? [];
    return {
      // Search rides on `catalog` — there is no separate search resource, and
      // the `search` extra is attempted rather than trusted (see the header).
      search: resources.includes('catalog') && catalogs.length > 0,
      catalog: resources.includes('catalog') && catalogs.length > 0,
      resolve: resources.includes('stream'),
    };
  }

  sections(): NativeCatalogSection[] {
    return (this.manifest.catalogs ?? []).map((catalog) => ({
      id: packHandle(catalog.type, catalog.id),
      title: catalog.name ? `${catalog.name}` : `${catalog.type} · ${catalog.id}`,
      subtitle: this.name,
    }));
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResponse[]> {
    const catalogs = this.manifest.catalogs ?? [];
    if (catalogs.length === 0) return [];

    /**
     * One request per *type*, not per catalogue.
     *
     * An addon commonly publishes eight catalogues over two types; searching
     * every one of them would issue eight requests to somebody else's server
     * for one keystroke-completed query and return the same title eight times.
     * The first catalogue of each type is representative — search ignores the
     * catalogue's own curation by definition.
     */
    const firstOfType = new Map<string, StremioCatalogDef>();
    for (const catalog of catalogs) {
      if (!firstOfType.has(catalog.type)) firstOfType.set(catalog.type, catalog);
    }

    const settled = await Promise.allSettled(
      [...firstOfType.values()].map((catalog) =>
        this.fetchCatalog(catalog.type, catalog.id, { search: query }, signal)
      )
    );

    const rows: SearchResponse[] = [];
    for (const result of settled) {
      // A catalogue that refuses `search=` is not a failure; it is a catalogue
      // that does not search. The manifest under-reports which do.
      if (result.status === 'fulfilled') rows.push(...result.value);
    }
    return rows;
  }

  async catalog(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]> {
    const { type, id } = unpackHandle(request.sectionId);
    const skip = (Math.max(1, request.page ?? 1) - 1) * PAGE_SIZE;
    return this.fetchCatalog(type, id, skip > 0 ? { skip: String(skip) } : {}, signal);
  }

  private async fetchCatalog(
    type: string,
    catalogId: string,
    extra: Record<string, string>,
    signal: AbortSignal
  ): Promise<SearchResponse[]> {
    // Extras travel as a path segment (`search=dune.json`), not a query string —
    // this is the one part of the protocol that surprises everybody.
    const suffix = Object.entries(extra)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const path = suffix
      ? `catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}/${suffix}.json`
      : `catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}.json`;

    const body = await fetchJson<{ metas?: StremioMeta[] }>(`${this.base}/${path}`, {
      timeoutMs: TIMEOUT_MS,
      signal,
    });
    return (body.metas ?? []).flatMap((meta) => {
      const row = this.toRow(meta, type);
      return row ? [row] : [];
    });
  }

  private toRow(meta: StremioMeta, type: string): SearchResponse | null {
    const id = meta.id || meta.imdb_id;
    if (!id || !meta.name) return null;
    return {
      name: meta.name,
      url: nativeAddress(this.id, packHandle(meta.type || type, id)),
      apiName: this.name,
      type: toTvType(meta.type || type),
      posterUrl: meta.poster,
      year: yearOf(meta),
      // The strongest merge key there is, and free whenever the addon is
      // IMDb-keyed — which most of this ecosystem is.
      imdbId: meta.imdb_id ?? (id.startsWith('tt') ? id.split(':')[0] : undefined),
    };
  }

  async load(handle: string, signal: AbortSignal): Promise<LoadResponse> {
    const { type, id } = unpackHandle(handle);
    if (!resourceNames(this.manifest).includes('meta')) {
      throw new Error(`${this.name} does not publish metadata for this item.`);
    }
    if (!acceptsId(this.manifest, id)) {
      throw new Error(`${this.name} does not recognise ids of that kind.`);
    }

    const body = await fetchJson<{ meta?: StremioMeta }>(
      `${this.base}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`,
      { timeoutMs: TIMEOUT_MS, signal }
    );
    const meta = body.meta;
    if (!meta) throw new Error(`${this.name} returned no metadata for ${id}.`);

    return {
      name: meta.name ?? id,
      url: nativeAddress(this.id, handle),
      apiName: this.name,
      type: toTvType(meta.type || type),
      posterUrl: meta.poster ?? meta.background,
      year: yearOf(meta),
      plot: meta.description,
      rating: typeof meta.imdbRating === 'string' ? Number(meta.imdbRating) : meta.imdbRating,
      tags: meta.genres ?? meta.genre,
      actors: meta.cast,
      duration: meta.runtime,
      episodes: (meta.videos ?? []).map((video) => ({
        name: video.title || video.name || `Episode ${video.episode ?? ''}`.trim(),
        // An episode addresses itself, so `loadLinks` asks for that episode
        // rather than for the series — the mistake that makes a show resolve to
        // its pilot forever.
        url: nativeAddress(this.id, packHandle(meta.type || type, video.id ?? id)),
        season: video.season,
        episode: video.episode,
        posterUrl: video.thumbnail,
        description: video.overview,
        date: video.released,
      })),
    };
  }

  async loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]> {
    const { type, id } = unpackHandle(handle);
    if (!resourceNames(this.manifest).includes('stream')) {
      throw new Error(`${this.name} does not supply streams; it is a catalogue only.`);
    }
    if (!acceptsId(this.manifest, id)) {
      throw new Error(`${this.name} does not recognise ids of that kind.`);
    }

    const body = await fetchJson<{ streams?: StremioStream[] }>(
      `${this.base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`,
      { timeoutMs: TIMEOUT_MS, signal }
    );
    const streams = body.streams ?? [];
    if (streams.length === 0) {
      throw new Error(`${this.name} has no streams for this item.`);
    }

    const links: ExtractorLink[] = [];
    for (const stream of streams) {
      const label = [stream.name, stream.title || stream.description]
        .filter(Boolean)
        .join(' · ')
        .replace(/\s+/g, ' ')
        .trim();
      const headers = stream.behaviorHints?.proxyHeaders?.request;
      const subtitles: SubtitleFile[] = (stream.subtitles ?? [])
        .filter((s) => s.url)
        .map((s) => ({ url: s.url!, lang: s.lang || s.id || 'und' }));

      if (stream.infoHash) {
        // A magnet, built here rather than by the caller so `fileIdx` survives:
        // it names the file *inside* the torrent, which is how one episode of a
        // season pack is addressed, and dropping it plays an arbitrary episode.
        links.push({
          source: this.name,
          name: label || 'Torrent',
          url: `magnet:?xt=urn:btih:${stream.infoHash}`,
          referer: '',
          quality: qualityFromLabel(label),
          linkType: 'MAGNET',
          ...(subtitles.length ? { subtitles } : {}),
        });
        continue;
      }

      if (stream.url) {
        links.push({
          source: this.name,
          name: label || 'Stream',
          url: stream.url,
          referer: headers?.Referer ?? headers?.referer ?? '',
          quality: qualityFromLabel(label),
          linkType: stream.url.includes('.m3u8') ? 'M3U8' : 'VIDEO',
          ...(headers ? { headers } : {}),
          ...(subtitles.length ? { subtitles } : {}),
        });
        continue;
      }

      /**
       * `externalUrl` and `ytId` are deliberately dropped.
       *
       * `externalUrl` opens a web page in a browser — it is not a stream, and
       * offering it as a source produces a row that looks playable and is not.
       * `ytId` needs a YouTube resolver; yt-dlp can do it, but routing it here
       * silently would make one addon's rows behave unlike every other's.
       */
    }

    if (links.length === 0) {
      throw new Error(
        `${this.name} returned ${streams.length} stream${streams.length === 1 ? '' : 's'}, none of them playable here (external links and YouTube ids are not sources).`
      );
    }
    return links;
  }

  /**
   * Subtitles for an item, when this addon serves them.
   *
   * Not part of `NativeProvider` because subtitles are merged by
   * `subtitleService` across every source that has them, rather than being one
   * provider's answer. 42 of 95 catalogued addons publish this resource, against
   * the single host that was hardcoded.
   */
  async subtitles(handle: string, signal: AbortSignal): Promise<SubtitleFile[]> {
    const { type, id } = unpackHandle(handle);
    if (!resourceNames(this.manifest).includes('subtitles')) return [];
    if (!acceptsId(this.manifest, id)) return [];

    const body = await fetchJson<{ subtitles?: Array<{ url?: string; lang?: string }> }>(
      `${this.base}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`,
      { timeoutMs: TIMEOUT_MS, signal }
    );
    return (body.subtitles ?? [])
      .filter((s) => s.url)
      .map((s) => ({ url: s.url!, lang: s.lang || 'und' }));
  }
}

/** `1080p`, `4k`, `720p` out of an addon's free-text label. */
export function qualityFromLabel(label: string): number {
  if (/\b(4k|2160p?|uhd)\b/i.test(label)) return 2160;
  if (/\b1440p?\b/i.test(label)) return 1440;
  if (/\b1080p?\b/i.test(label)) return 1080;
  if (/\b720p?\b/i.test(label)) return 720;
  if (/\b480p?\b/i.test(label)) return 480;
  if (/\b360p?\b/i.test(label)) return 360;
  return 0;
}

/**
 * Reads and validates a manifest, so a bad URL fails in front of the user.
 *
 * A URL that is not an addon would otherwise become a provider that is listed,
 * enabled, asked on every search and silently answers nothing — which is
 * indistinguishable from a source that has nothing for this title.
 */
export async function fetchManifest(
  url: string,
  signal?: AbortSignal
): Promise<StremioManifest> {
  const base = normaliseBase(url);
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('An addon address must start with http:// or https://');
  }
  const manifest = await fetchJson<StremioManifest>(`${base}/manifest.json`, {
    timeoutMs: TIMEOUT_MS,
    signal,
  });
  if (!manifest?.id || !manifest?.name) {
    throw new Error('That address answered, but not with a Stremio addon manifest.');
  }
  if (resourceNames(manifest).length === 0) {
    throw new Error(`"${manifest.name}" declares no resources, so it can supply nothing.`);
  }
  return manifest;
}
