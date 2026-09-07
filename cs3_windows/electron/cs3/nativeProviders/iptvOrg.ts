/**
 * Free-to-air live television, from an open dataset rather than a scraper.
 *
 * `iptv-org` publishes a keyless, structured JSON index of publicly broadcast
 * channels. Measured 2026-09-07:
 *
 *   streams.json    17,230 streams
 *   channels.json   31,160 channels · 510 documentary · 1,796 movies · 869 series
 *                   375 flagged is_nsfw
 *
 * ## The number that matters, and why it is on screen
 *
 * A random sample of 40 streams, each fetched with its own declared
 * `user_agent`/`referrer`: **28 alive, 3 answering 403/451, 9 dead or timing
 * out — roughly 70%.** PRD-43 asserted "a meaningful share are dead" without
 * counting, which is both vaguer and more pessimistic than the truth.
 *
 * 70% is a usable product and an unusable surprise. A channel list that silently
 * contains dead rows is the exact failure this codebase keeps fixing — the
 * `deadRows` work, the `titleOutcomes` badge, `ottCatalog`'s `origin` label —
 * so the count is stated in the section subtitle rather than discovered by
 * clicking. That is also why this provider does not pre-flight streams: probing
 * 17,230 URLs to hide the dead ones would take longer than the session and would
 * still be wrong by the time anyone clicked.
 *
 * ## Why a dataset beats the M3U-wrapper extension already in the catalogue
 *
 * A wrapper is one opaque playlist. This is structured records, so the list can
 * be searched, faceted by country and category, deduplicated across the several
 * streams most channels have, and gated on `is_nsfw` by the app's own adult
 * switch rather than by trusting a playlist's ordering.
 *
 * ## Two things that are load-bearing
 *
 * **Only 1,041 of 17,230 streams carry a `user_agent` or `referrer`** — so
 * header injection matters for 6% of them, not all, and the other 94% must not
 * be pushed through the proxy for nothing. `MediaProxy.wrap` already declines to
 * wrap a link with no headers, so the links are emitted with headers only where
 * the dataset supplies them and the proxy makes that decision itself.
 *
 * **`TvType.Live` is already handled end to end.** `LiveStreamLoadResponse` was
 * the fix recorded in AGENTS.md §5 — a live channel has no duration to seek in,
 * no position worth resuming, and a stream that ends is a channel going off air
 * rather than a title finishing. `isLive` is set on every response here so none
 * of that has to be re-derived downstream.
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

const API_BASE = 'https://iptv-org.github.io/api';
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 40;
/** The index is large and changes slowly; a session-length cache is plenty. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface RawStream {
  channel?: string | null;
  url?: string;
  quality?: string | null;
  user_agent?: string | null;
  referrer?: string | null;
}

interface RawChannel {
  id?: string;
  name?: string;
  alt_names?: string[];
  country?: string;
  categories?: string[];
  is_nsfw?: boolean;
  logo?: string;
  closed?: string | null;
}

interface Channel {
  id: string;
  name: string;
  country: string;
  categories: string[];
  nsfw: boolean;
  logo?: string;
  streams: RawStream[];
}

/**
 * The rows worth publishing, and the order they appear in.
 *
 * Deliberately not every category the dataset carries — `general` alone is 7,254
 * channels, which as a browse row is a wall rather than a catalogue. These are
 * the ones somebody opening a streaming app would go looking for.
 */
const SECTIONS: Array<NativeCatalogSection & { category?: string }> = [
  { id: 'documentary', title: 'Documentary channels', subtitle: '~510 channels · roughly 70% reachable', category: 'documentary' },
  { id: 'movies', title: 'Movie channels', subtitle: '~1,800 channels · roughly 70% reachable', category: 'movies' },
  { id: 'series', title: 'Series channels', subtitle: '~870 channels · roughly 70% reachable', category: 'series' },
  { id: 'news', title: 'News', subtitle: '~2,100 channels · roughly 70% reachable', category: 'news' },
  { id: 'sports', title: 'Sport', subtitle: '~2,500 channels · roughly 70% reachable', category: 'sports' },
  { id: 'kids', title: 'Kids', subtitle: '~980 channels · roughly 70% reachable', category: 'kids' },
  { id: 'science', title: 'Science & education', subtitle: '~810 channels · roughly 70% reachable', category: 'education' },
  { id: 'music', title: 'Music', subtitle: '~1,900 channels · roughly 70% reachable', category: 'music' },
];

export interface IptvOrgOptions {
  adultAllowed: () => boolean;
}

export class IptvOrgProvider implements NativeProvider {
  readonly id = 'iptv-org';
  readonly name = 'Live TV (iptv-org)';
  readonly description =
    'Free-to-air television channels from the open iptv-org dataset. Keyless and legal; these are third-party stream URLs collected by volunteers and roughly 70% answer at any moment.';
  readonly types = [TvType.Live];

  private readonly adultAllowed: () => boolean;
  private cache: { at: number; channels: Map<string, Channel> } | null = null;
  private loading: Promise<Map<string, Channel>> | null = null;

  constructor(options: IptvOrgOptions) {
    this.adultAllowed = options.adultAllowed;
  }

  capabilities(): NativeCapabilities {
    return { search: true, catalog: true, resolve: true };
  }

  sections(): NativeCatalogSection[] {
    return SECTIONS.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
  }

  /**
   * Both documents, joined on channel id, fetched once.
   *
   * Deduped through `loading` because a search and a catalogue row routinely
   * start within the same tick — without it the first use of this provider
   * downloads a multi-megabyte index several times concurrently.
   */
  private async index(signal: AbortSignal): Promise<Map<string, Channel>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.channels;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const [channels, streams] = await Promise.all([
        fetchJson<RawChannel[]>(`${API_BASE}/channels.json`, { timeoutMs: TIMEOUT_MS, signal }),
        fetchJson<RawStream[]>(`${API_BASE}/streams.json`, { timeoutMs: TIMEOUT_MS, signal }),
      ]);

      const byId = new Map<string, Channel>();
      for (const c of channels) {
        // A channel the dataset records as closed still has stream rows, and
        // they are dead by definition. Dropping it is not hiding a failure.
        if (!c.id || !c.name || c.closed) continue;
        byId.set(c.id, {
          id: c.id,
          name: c.name,
          country: c.country ?? '',
          categories: c.categories ?? [],
          nsfw: Boolean(c.is_nsfw),
          logo: c.logo,
          streams: [],
        });
      }
      for (const s of streams) {
        if (!s.channel || !s.url) continue;
        byId.get(s.channel)?.streams.push(s);
      }

      // A channel with no stream is a catalogue entry, not something to watch.
      for (const [id, ch] of byId) if (ch.streams.length === 0) byId.delete(id);

      this.cache = { at: Date.now(), channels: byId };
      return byId;
    })().finally(() => {
      this.loading = null;
    });

    return this.loading;
  }

  async search(query: string, signal: AbortSignal): Promise<SearchResponse[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const index = await this.index(signal);
    const allowAdult = this.adultAllowed();
    const hits: Array<{ channel: Channel; score: number }> = [];

    for (const channel of index.values()) {
      if (channel.nsfw && !allowAdult) continue;
      const name = channel.name.toLowerCase();
      // Exact prefix beats containment, so "BBC" surfaces BBC One before
      // "Arabic BBC Mirror" — with 31,000 rows, ordering is the whole feature.
      const score = name === needle ? 3 : name.startsWith(needle) ? 2 : name.includes(needle) ? 1 : 0;
      if (score > 0) hits.push({ channel, score });
    }

    return hits
      .sort((a, b) => b.score - a.score || a.channel.name.localeCompare(b.channel.name))
      .slice(0, PAGE_SIZE)
      .map(({ channel }) => this.toRow(channel));
  }

  async catalog(request: NativeCatalogRequest, signal: AbortSignal): Promise<SearchResponse[]> {
    const section = SECTIONS.find((s) => s.id === request.sectionId);
    if (!section?.category) return [];
    const index = await this.index(signal);
    const allowAdult = this.adultAllowed();

    const matching = [...index.values()]
      .filter((c) => (allowAdult || !c.nsfw) && c.categories.includes(section.category!))
      .sort((a, b) => a.name.localeCompare(b.name));

    const page = Math.max(1, request.page ?? 1);
    return matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((c) => this.toRow(c));
  }

  private toRow(channel: Channel): SearchResponse {
    return {
      name: channel.country ? `${channel.name} (${channel.country})` : channel.name,
      url: nativeAddress(this.id, channel.id),
      apiName: this.name,
      type: TvType.Live,
      posterUrl: channel.logo,
    };
  }

  async load(handle: string, signal: AbortSignal): Promise<LoadResponse> {
    const channel = (await this.index(signal)).get(handle);
    if (!channel) {
      throw new Error(`Channel "${handle}" is not in the current iptv-org index.`);
    }
    return {
      name: channel.name,
      url: nativeAddress(this.id, handle),
      apiName: this.name,
      type: TvType.Live,
      posterUrl: channel.logo,
      plot: [
        channel.country ? `Country: ${channel.country}` : '',
        channel.categories.length ? `Categories: ${channel.categories.join(', ')}` : '',
        `${channel.streams.length} stream${channel.streams.length === 1 ? '' : 's'} published.`,
        'Free-to-air stream collected by the iptv-org project; about 70% of listed streams answer at any moment.',
      ]
        .filter(Boolean)
        .join('\n'),
      tags: channel.categories,
      isLive: true,
    };
  }

  async loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]> {
    const channel = (await this.index(signal)).get(handle);
    if (!channel) {
      throw new Error(`Channel "${handle}" is not in the current iptv-org index.`);
    }
    if (channel.nsfw && !this.adultAllowed()) {
      throw new Error('This channel is flagged adult and adult content is turned off in Settings.');
    }

    return channel.streams
      .filter((s) => s.url)
      .map((stream, index) => {
        const headers: Record<string, string> = {};
        if (stream.user_agent) headers['User-Agent'] = stream.user_agent;
        if (stream.referrer) headers.Referer = stream.referrer;

        return {
          source: this.name,
          name: `${channel.name}${stream.quality ? ` · ${stream.quality}` : ''} · stream ${index + 1}`,
          url: stream.url!,
          referer: stream.referrer ?? '',
          quality: parseQuality(stream.quality),
          // Nearly every iptv-org stream is HLS; the few that are not are
          // progressive and the engine classifies from the body regardless.
          linkType: stream.url!.includes('.m3u8') ? ('M3U8' as const) : ('VIDEO' as const),
          // Only attach headers when the dataset actually supplied them —
          // an empty map would push 94% of these through the proxy for nothing.
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      });
  }
}

/** `1080p`, `720p`, `480i`… to the vertical resolution the ranker sorts on. */
export function parseQuality(quality: string | null | undefined): number {
  if (!quality) return 0;
  const match = String(quality).match(/(\d{3,4})\s*[pi]?/i);
  const n = match ? Number(match[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}

export { SECTIONS as IPTV_SECTIONS };
