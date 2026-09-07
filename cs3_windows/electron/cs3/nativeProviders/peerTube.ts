/**
 * PeerTube, through SepiaSearch — federated video, keyless, documented.
 *
 * Measured 2026-09-07 against `sepiasearch.org/api/v1`:
 *
 *   "documentary"   6,641 videos      "film complet"  19,935
 *   "full movie"    8,903 videos      "conference"    10,992
 *   instances indexed by joinpeertube  1,781
 *
 * ## What this is, stated honestly
 *
 * Not a movies-and-TV catalogue. PeerTube is a federated creator platform, and
 * what it has that this app wants is a **documentary, lecture and conference
 * seam** plus a long tail of public-domain and Creative Commons features that
 * their uploaders chose to host there. Filing it under "Movies" would set an
 * expectation it cannot meet; the provider names itself for what it is and its
 * catalogue rows say what they contain.
 *
 * ## Why SepiaSearch rather than per-instance APIs
 *
 * A PeerTube instance exposes the same REST API, so an obvious design is to let
 * the user add instances and fan out across them. That is worse in the way this
 * codebase has learned to recognise: 1,781 instances is a fan-out across 1,781
 * third-party hosts of wildly varying uptime, most of which have nothing for any
 * given query, and the slow ones would set the latency of every search — the
 * same shape as the provider fan-out `sourceScope.ts` exists to narrow.
 *
 * SepiaSearch is the project's own aggregator over the instances that opted into
 * indexing. One host, one documented shape, and a result that already carries
 * which instance to fetch the files from.
 *
 * ## The one real trap
 *
 * **A video's `files` live on its own instance, not on the search host.** A
 * SepiaSearch hit carries `account.host`/`channel.host`, and the playable files
 * come from `https://<that host>/api/v1/videos/<uuid>`. Resolving against
 * sepiasearch.org returns 404, which reads as a dead video rather than as the
 * wrong host being asked. The handle therefore carries both, joined by `@`.
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

const SEARCH_BASE = 'https://sepiasearch.org/api/v1/search/videos';
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 30;

interface SepiaVideo {
  uuid?: string;
  shortUUID?: string;
  name?: string;
  description?: string;
  duration?: number;
  publishedAt?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  url?: string;
  nsfw?: boolean;
  account?: { host?: string; displayName?: string };
  channel?: { host?: string; displayName?: string };
}

interface SepiaEnvelope {
  total?: number;
  data?: SepiaVideo[];
}

interface VideoFile {
  resolution?: { id?: number; label?: string };
  fileUrl?: string;
  fileDownloadUrl?: string;
  size?: number;
}

interface VideoDetail {
  name?: string;
  description?: string;
  duration?: number;
  publishedAt?: string;
  thumbnailUrl?: string;
  nsfw?: boolean;
  files?: VideoFile[];
  streamingPlaylists?: Array<{ playlistUrl?: string; files?: VideoFile[] }>;
  account?: { displayName?: string };
}

const SECTIONS: Array<NativeCatalogSection & { query: string }> = [
  { id: 'documentary', title: 'Documentaries on PeerTube', subtitle: '~6,600 videos', query: 'documentary' },
  { id: 'feature', title: 'Full-length features', subtitle: '~8,900 videos', query: 'full movie' },
  { id: 'film-fr', title: 'Films complets (French)', subtitle: '~19,900 videos', query: 'film complet' },
  { id: 'talks', title: 'Talks & conferences', subtitle: '~11,000 videos', query: 'conference' },
];

export interface PeerTubeOptions {
  adultAllowed: () => boolean;
}

export class PeerTubeProvider implements NativeProvider {
  readonly id = 'peertube';
  readonly name = 'PeerTube';
  readonly description =
    'Federated video from the PeerTube network, searched through the project\'s own SepiaSearch index. Keyless and creator-published — strongest on documentaries, lectures and conference recordings.';
  readonly types = [TvType.Documentary, TvType.Movie];

  private readonly adultAllowed: () => boolean;

  constructor(options: PeerTubeOptions) {
    this.adultAllowed = options.adultAllowed;
  }

  capabilities(): NativeCapabilities {
    return { search: true, catalog: true, resolve: true };
  }

  sections(): NativeCatalogSection[] {
    return SECTIONS.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResponse[]> {
    const term = query.trim();
    if (term.length < 2) return [];
    return this.query(term, 1, signal);
  }

  async catalog(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]> {
    const section = SECTIONS.find((s) => s.id === request.sectionId);
    if (!section) return [];
    return this.query(section.query, request.page ?? 1, signal);
  }

  private async query(search: string, page: number, signal: AbortSignal): Promise<SearchResponse[]> {
    const params = new URLSearchParams({
      search,
      count: String(PAGE_SIZE),
      start: String((Math.max(1, page) - 1) * PAGE_SIZE),
      sort: '-match',
      // The index carries live streams and shorts; neither is what someone
      // browsing "documentaries" is asking for.
      isLive: 'false',
    });
    if (!this.adultAllowed()) params.set('nsfw', 'false');

    const envelope = await fetchJson<SepiaEnvelope>(`${SEARCH_BASE}?${params.toString()}`, {
      timeoutMs: TIMEOUT_MS,
      signal,
    });

    const rows: SearchResponse[] = [];
    for (const video of envelope.data ?? []) {
      const row = this.toRow(video);
      if (row) rows.push(row);
    }
    return rows;
  }

  private toRow(video: SepiaVideo): SearchResponse | null {
    const uuid = video.uuid || video.shortUUID;
    const host = hostOf(video);
    if (!uuid || !host || !video.name) return null;
    if (video.nsfw && !this.adultAllowed()) return null;

    return {
      name: video.name,
      url: nativeAddress(this.id, `${uuid}@${host}`),
      apiName: this.name,
      type: TvType.Documentary,
      posterUrl: absoluteUrl(video.thumbnailUrl ?? video.previewUrl, host),
      year: yearFrom(video.publishedAt),
    };
  }

  async load(handle: string, signal: AbortSignal): Promise<LoadResponse> {
    const { uuid, host } = splitHandle(handle);
    const detail = await this.detail(uuid, host, signal);
    return {
      name: detail.name ?? uuid,
      url: nativeAddress(this.id, handle),
      apiName: this.name,
      type: TvType.Documentary,
      posterUrl: absoluteUrl(detail.thumbnailUrl, host),
      year: yearFrom(detail.publishedAt),
      plot: detail.description?.trim() || undefined,
      duration: detail.duration ? `${Math.round(detail.duration / 60)} min` : undefined,
      actors: detail.account?.displayName ? [detail.account.displayName] : undefined,
    };
  }

  async loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]> {
    const { uuid, host } = splitHandle(handle);
    const detail = await this.detail(uuid, host, signal);
    if (detail.nsfw && !this.adultAllowed()) {
      throw new Error('This video is flagged adult and adult content is turned off in Settings.');
    }

    const links: ExtractorLink[] = [];

    // Progressive files first: they are plain MP4 over range-honouring HTTP,
    // which is the cheapest thing this app can play.
    for (const file of detail.files ?? []) {
      const url = file.fileUrl || file.fileDownloadUrl;
      if (!url) continue;
      links.push({
        source: this.name,
        name: `${file.resolution?.label ?? 'video'} · ${host}`,
        url,
        referer: `https://${host}/`,
        quality: file.resolution?.id ?? 0,
        linkType: 'VIDEO',
      });
    }

    // HLS is the fallback rather than the default: on PeerTube it is the same
    // content, and a progressive file needs no demuxer decisions at all.
    for (const playlist of detail.streamingPlaylists ?? []) {
      if (!playlist.playlistUrl) continue;
      links.push({
        source: this.name,
        name: `HLS · ${host}`,
        url: playlist.playlistUrl,
        referer: `https://${host}/`,
        quality: Math.max(0, ...(playlist.files ?? []).map((f) => f.resolution?.id ?? 0)),
        linkType: 'M3U8',
        isM3u8: true,
      });
    }

    if (links.length === 0) {
      throw new Error(
        `PeerTube video ${uuid} on ${host} published no downloadable files or playlists. The instance may have disabled downloads or transcoding may still be running.`
      );
    }
    return links;
  }

  private async detail(uuid: string, host: string, signal: AbortSignal): Promise<VideoDetail> {
    // Against the origin instance, never against SepiaSearch — see the header.
    return fetchJson<VideoDetail>(`https://${host}/api/v1/videos/${encodeURIComponent(uuid)}`, {
      timeoutMs: TIMEOUT_MS,
      signal,
    });
  }
}

function hostOf(video: SepiaVideo): string | undefined {
  const host = video.channel?.host || video.account?.host;
  if (host) return host;
  // Older index rows carry only the canonical URL.
  try {
    return video.url ? new URL(video.url).host : undefined;
  } catch {
    return undefined;
  }
}

export function splitHandle(handle: string): { uuid: string; host: string } {
  const at = handle.lastIndexOf('@');
  if (at <= 0) throw new Error(`Malformed PeerTube handle "${handle}".`);
  return { uuid: handle.slice(0, at), host: handle.slice(at + 1) };
}

function absoluteUrl(url: string | undefined, host: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${host}${url.startsWith('/') ? '' : '/'}${url}`;
}

function yearFrom(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const year = new Date(iso).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

export { SECTIONS as PEERTUBE_SECTIONS };
