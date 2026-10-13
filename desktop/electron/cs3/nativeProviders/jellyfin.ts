/**
 * The user's own Jellyfin or Emby server — the library they already have.
 *
 * ## Why this is the clearest desktop-exclusive case in the roster
 *
 * It **cannot exist as a `.cs3`.** An Android extension scrapes public websites;
 * it has no route to a server on your LAN, no way to hold your credentials, and
 * no reason to. This is a source class the phone app structurally does not
 * have, so no amount of extension-ecosystem work would ever produce it.
 *
 * It is also the only source in this app that cannot rot. Every other one — a
 * scraper, an indexer, a debrid link, a public archive — can 403, expire, be
 * taken down or simply go quiet. A NAS in the next room does not: the files are
 * the user's, the server is theirs, there is no third party in the loop and no
 * rate limit to respect.
 *
 * ## Keyless by design, which is the whole reason it clears our bar
 *
 * `homeProviders.ts` established the constraint that rules this codebase's
 * source choices: **nobody should have to obtain an API key to use the app**,
 * because a key embedded in a distributed client is a licence violation and a
 * key that gets revoked. That eliminated TMDB, Trakt, OMDb and the rest.
 *
 * Jellyfin sails past it from the other side. The key is *the user's own*, for
 * *their own* server, generated in their own dashboard, and it never leaves
 * their machine except to travel to the host they typed in. There is no
 * third-party service to be revoked by.
 *
 * ## Three things that are load-bearing
 *
 * **A `userId` is required and is not optional politeness.** `/Items` without
 * one answers 400 on Jellyfin. The id is resolved once from `/Users` and cached
 * with the connection, because it never changes for a given key.
 *
 * **`static=true` on the stream URL is what makes this cheap.** It tells the
 * server to hand over the original file rather than starting a transcode. This
 * app has its own compatibility engine, its own ffmpeg and mpv — a server-side
 * transcode would be a second one, running on the user's NAS, producing a worse
 * picture than the file it started from.
 *
 * **The API key travels in a header, never in the URL.** Jellyfin accepts both
 * and the query-string form is all over its own documentation, but a URL is the
 * one part of a request this codebase writes to disk: `MediaProxy` mints routes
 * from it, `SourceCache` persists it, `DiagnosticsLog` records it, and the
 * source export copies it to a clipboard. `X-Emby-Token` keeps a long-lived
 * credential out of every one of those.
 */
import { fetchJson } from '../../torrent/http.ts';
import { TvType, type ExtractorLink, type LoadResponse, type SearchResponse } from '../../../src/types/api.ts';
import type {
  NativeCapabilities,
  NativeCatalogRequest,
  NativeCatalogSection,
  NativeProvider,
} from './types.ts';
import { nativeAddress } from './types.ts';

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 40;

/** Item types worth listing. Music and photos are a different app. */
const ITEM_TYPES = 'Movie,Series,Video';
const FIELDS = 'Overview,Genres,ProductionYear,People,RunTimeTicks,Path,MediaSources';

interface JellyfinItem {
  Id?: string;
  Name?: string;
  Type?: string;
  Overview?: string;
  ProductionYear?: number;
  Genres?: string[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
  CommunityRating?: number;
  ImageTags?: Record<string, string>;
  People?: Array<{ Name?: string; Type?: string }>;
  MediaSources?: Array<{
    Id?: string;
    Name?: string;
    Container?: string;
    Size?: number;
    MediaStreams?: Array<{ Type?: string; Height?: number; Codec?: string }>;
  }>;
}

interface ItemsResponse {
  Items?: JellyfinItem[];
  TotalRecordCount?: number;
}

export interface JellyfinServerConfig {
  /** Stable local id, part of every address this server mints. */
  localId: string;
  /** Display name, shown in the roster and used as the scope key. */
  name: string;
  /** Base URL, no trailing slash. */
  url: string;
  apiKey: string;
  /** Resolved once at add time; `/Items` answers 400 without it. */
  userId: string;
}

const SECTIONS: NativeCatalogSection[] = [
  { id: 'recent', title: 'Recently added', subtitle: 'Newest in your library' },
  { id: 'movies', title: 'Movies', subtitle: 'Your library' },
  { id: 'series', title: 'TV series', subtitle: 'Your library' },
  { id: 'favourites', title: 'Favourites', subtitle: 'Marked on the server' },
];

export class JellyfinProvider implements NativeProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly types = [TvType.Movie, TvType.TvSeries, TvType.Documentary];

  private readonly config: JellyfinServerConfig;

  constructor(config: JellyfinServerConfig) {
    this.config = { ...config, url: normaliseServerUrl(config.url) };
    this.id = config.localId;
    this.name = config.name;
    this.description = `Your own media server at ${this.config.url}. Direct play from your library — nothing to scrape, nothing to expire.`;
  }

  capabilities(): NativeCapabilities {
    return { search: true, catalog: true, resolve: true };
  }

  sections(): NativeCatalogSection[] {
    return SECTIONS;
  }

  /** The key travels here, never in a URL. See the header. */
  private headers(): Record<string, string> {
    return { 'X-Emby-Token': this.config.apiKey, Accept: 'application/json' };
  }

  private async items(params: Record<string, string>, signal: AbortSignal): Promise<JellyfinItem[]> {
    const query = new URLSearchParams({
      userId: this.config.userId,
      Recursive: 'true',
      IncludeItemTypes: ITEM_TYPES,
      Fields: FIELDS,
      Limit: String(PAGE_SIZE),
      ...params,
    });
    const body = await fetchJson<ItemsResponse>(`${this.config.url}/Items?${query.toString()}`, {
      timeoutMs: TIMEOUT_MS,
      headers: this.headers(),
      signal,
    });
    return body.Items ?? [];
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResponse[]> {
    const term = query.trim();
    if (term.length < 2) return [];
    const items = await this.items({ SearchTerm: term, SortBy: 'SortName' }, signal);
    return items.map((item) => this.toRow(item));
  }

  async catalog(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]> {
    const start = (Math.max(1, request.page ?? 1) - 1) * PAGE_SIZE;
    const base: Record<string, string> = { StartIndex: String(start) };

    const params: Record<string, string> =
      request.sectionId === 'recent'
        ? { ...base, SortBy: 'DateCreated', SortOrder: 'Descending' }
        : request.sectionId === 'movies'
          ? { ...base, IncludeItemTypes: 'Movie', SortBy: 'SortName' }
          : request.sectionId === 'series'
            ? { ...base, IncludeItemTypes: 'Series', SortBy: 'SortName' }
            : request.sectionId === 'favourites'
              ? { ...base, Filters: 'IsFavorite', SortBy: 'SortName' }
              : base;

    return (await this.items(params, signal)).map((item) => this.toRow(item));
  }

  private toRow(item: JellyfinItem): SearchResponse {
    return {
      name: item.Name ?? 'Untitled',
      url: nativeAddress(this.id, item.Id ?? ''),
      apiName: this.name,
      type: item.Type === 'Series' ? TvType.TvSeries : TvType.Movie,
      posterUrl: this.imageUrl(item),
      year: item.ProductionYear,
    };
  }

  /**
   * Poster URL, which is the one place the key genuinely cannot travel.
   *
   * It is set as an `<img src>` in the renderer, which cannot carry a header —
   * so this is the single exception to the rule above, and it is bounded: an
   * image route leaks the key only to the user's own server, which already has
   * it. Jellyfin also serves images to unauthenticated requests by default, so
   * the key is frequently not needed at all; it is omitted here for that reason
   * and a server configured to require it simply shows no artwork rather than
   * putting a credential in a `src` attribute the DOM will happily expose.
   */
  private imageUrl(item: JellyfinItem): string | undefined {
    const tag = item.ImageTags?.Primary;
    if (!item.Id || !tag) return undefined;
    return `${this.config.url}/Items/${item.Id}/Images/Primary?tag=${encodeURIComponent(tag)}&maxHeight=480`;
  }

  async load(handle: string, signal: AbortSignal): Promise<LoadResponse> {
    const item = await fetchJson<JellyfinItem>(
      `${this.config.url}/Users/${this.config.userId}/Items/${encodeURIComponent(handle)}`,
      { timeoutMs: TIMEOUT_MS, headers: this.headers(), signal }
    );
    if (!item?.Id) throw new Error(`${this.name} has no item with that id any more.`);

    const isSeries = item.Type === 'Series';
    let episodes: LoadResponse['episodes'];
    if (isSeries) {
      const body = await fetchJson<ItemsResponse>(
        `${this.config.url}/Shows/${encodeURIComponent(item.Id)}/Episodes?userId=${encodeURIComponent(this.config.userId)}&Fields=${FIELDS}`,
        { timeoutMs: TIMEOUT_MS, headers: this.headers(), signal }
      );
      episodes = (body.Items ?? []).map((episode) => ({
        name: episode.Name ?? `Episode ${episode.IndexNumber ?? ''}`.trim(),
        url: nativeAddress(this.id, episode.Id ?? ''),
        season: episode.ParentIndexNumber,
        episode: episode.IndexNumber,
        description: episode.Overview,
        posterUrl: this.imageUrl(episode),
      }));
    }

    return {
      name: item.Name ?? handle,
      url: nativeAddress(this.id, handle),
      apiName: this.name,
      type: isSeries ? TvType.TvSeries : TvType.Movie,
      posterUrl: this.imageUrl(item),
      year: item.ProductionYear,
      plot: item.Overview,
      rating: item.CommunityRating,
      tags: item.Genres,
      actors: (item.People ?? [])
        .filter((p) => p.Type === 'Actor' && p.Name)
        .map((p) => p.Name!)
        .slice(0, 10),
      duration: item.RunTimeTicks
        ? `${Math.round(item.RunTimeTicks / 600_000_000)} min`
        : undefined,
      episodes,
    };
  }

  async loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]> {
    const item = await fetchJson<JellyfinItem>(
      `${this.config.url}/Users/${this.config.userId}/Items/${encodeURIComponent(handle)}`,
      { timeoutMs: TIMEOUT_MS, headers: this.headers(), signal }
    );
    if (!item?.Id) throw new Error(`${this.name} has no item with that id any more.`);
    if (item.Type === 'Series') {
      throw new Error('That is a series. Pick an episode to play.');
    }

    const mediaSources = item.MediaSources ?? [];
    if (mediaSources.length === 0) {
      throw new Error(
        `${this.name} lists "${item.Name ?? handle}" but reports no media file for it. The file may have been moved or the library may need a rescan.`
      );
    }

    return mediaSources.map((source) => {
      const video = (source.MediaStreams ?? []).find((s) => s.Type === 'Video');
      const query = new URLSearchParams({
        // The original file, not a server-side transcode — this app has its own
        // compatibility engine and a second one on the user's NAS would produce
        // a worse picture than the file it started from.
        static: 'true',
        mediaSourceId: source.Id ?? item.Id!,
      });
      return {
        source: this.name,
        name: [source.Name || item.Name, video?.Height ? `${video.Height}p` : null, source.Container?.toUpperCase()]
          .filter(Boolean)
          .join(' · '),
        url: `${this.config.url}/Videos/${encodeURIComponent(item.Id!)}/stream?${query.toString()}`,
        referer: this.config.url,
        quality: video?.Height ?? 0,
        linkType: 'VIDEO' as const,
        // The proxy applies these, so the credential never reaches a URL that
        // gets cached, exported or logged.
        headers: { 'X-Emby-Token': this.config.apiKey },
      };
    });
  }
}

export function normaliseServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Checks a server and resolves the `userId` every later request needs.
 *
 * Done at add time so a wrong URL or a bad key fails in front of the person who
 * typed it, rather than becoming a provider that is listed, enabled, asked on
 * every search and silently answers nothing.
 */
export async function probeServer(
  url: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<{ name: string; userId: string; version?: string }> {
  const base = normaliseServerUrl(url);
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('A server address must start with http:// or https://');
  }
  const headers = { 'X-Emby-Token': apiKey, Accept: 'application/json' };

  const info = await fetchJson<{ ServerName?: string; Version?: string }>(
    `${base}/System/Info`,
    { timeoutMs: TIMEOUT_MS, headers, signal }
  );
  if (!info) throw new Error('That address answered, but not like a Jellyfin or Emby server.');

  const users = await fetchJson<Array<{ Id?: string; Name?: string }>>(`${base}/Users`, {
    timeoutMs: TIMEOUT_MS,
    headers,
    signal,
  });
  const userId = Array.isArray(users) ? users.find((u) => u.Id)?.Id : undefined;
  if (!userId) {
    // The commonest real failure, and the message names the actual cause:
    // an API key that authenticates but is not attached to a user account
    // returns an empty list here rather than a 401.
    throw new Error(
      'The server answered but returned no user account for that API key. Check the key in Dashboard → API Keys.'
    );
  }

  return { name: info.ServerName || 'Media server', userId, version: info.Version };
}
