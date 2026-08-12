import { XMLParser } from 'fast-xml-parser';
import { fetchText } from '../http';
import { parseIntSafe, parseSize, type RawTorrent, type TorrentIndexer } from './base';
import type { IndexerConfig, IndexerQuery } from '../../../src/types/torrent';

/**
 * Generic Torznab adapter — the primary and most robust indexer path.
 *
 * Torznab is the protocol Jackett and Prowlarr expose, so this single adapter
 * reaches every indexer those tools support (hundreds), inherits their proxy,
 * CAPTCHA (FlareSolverr) and authentication handling, and keeps site-specific
 * scraping churn out of this codebase entirely. Users behind ISP-level DNS
 * blocks should route through here rather than the built-in public adapters.
 *
 * Protocol reference: `?t=search|tvsearch|movie&q=&season=&ep=&imdbid=&apikey=`
 * returning RSS with `<torznab:attr name="..." value="..."/>` children.
 */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'item' || name === 'torznab:attr',
});

interface TorznabAttr {
  '@_name'?: string;
  '@_value'?: string;
}

interface TorznabItem {
  title?: string;
  link?: string;
  guid?: string | { '#text'?: string };
  pubDate?: string;
  size?: string | number;
  category?: string | string[];
  enclosure?: { '@_url'?: string; '@_length'?: string };
  'torznab:attr'?: TorznabAttr[];
}

function attrMap(item: TorznabItem): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of item['torznab:attr'] ?? []) {
    const name = attr['@_name'];
    const value = attr['@_value'];
    if (name && value !== undefined) out[name.toLowerCase()] = value;
  }
  return out;
}

export class TorznabIndexer implements TorrentIndexer {
  readonly id: string;
  readonly name: string;
  readonly specialises = 'any' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly slug: string;

  constructor(config: IndexerConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? '';
    this.slug = config.indexerSlug || 'all';
  }

  canHandle(): boolean {
    return Boolean(this.baseUrl);
  }

  /**
   * Jackett and Prowlarr expose slightly different base paths. Both are tried
   * so a user can paste either product's URL without having to know which
   * layout it uses.
   */
  private candidateEndpoints(): string[] {
    return [
      `${this.baseUrl}/api/v2.0/indexers/${this.slug}/results/torznab/api`, // Jackett
      `${this.baseUrl}/api/v1/indexer/${this.slug}/newznab`, // Prowlarr
      `${this.baseUrl}/api`, // bare Torznab endpoint
    ];
  }

  private buildQuery(query: IndexerQuery): string {
    const params = new URLSearchParams();

    // `tvsearch` accepts structured season/ep filtering; `movie` accepts imdbid.
    const isEpisodic = query.season !== undefined || query.episode !== undefined;
    params.set('t', isEpisodic ? 'tvsearch' : query.imdbId ? 'movie' : 'search');

    if (this.apiKey) params.set('apikey', this.apiKey);
    if (query.query) params.set('q', query.query);
    if (query.season !== undefined) params.set('season', String(query.season));
    if (query.episode !== undefined) params.set('ep', String(query.episode));
    if (query.imdbId) params.set('imdbid', query.imdbId.replace(/^tt/i, ''));
    params.set('limit', String(Math.min(query.limit ?? 100, 200)));

    return params.toString();
  }

  async search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]> {
    const qs = this.buildQuery(query);
    let lastError: unknown = new Error('No Torznab endpoint responded');

    for (const endpoint of this.candidateEndpoints()) {
      try {
        const body = await fetchText(`${endpoint}?${qs}`, { signal, timeoutMs: 20_000 });
        // A Torznab error is returned as HTTP 200 with an <error> document.
        if (/<error\b/i.test(body)) {
          const code = body.match(/code="(\d+)"/)?.[1];
          const description = body.match(/description="([^"]*)"/)?.[1];
          throw new Error(`Torznab error ${code ?? '?'}: ${description ?? 'unknown'}`);
        }
        return this.parseResponse(body);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private parseResponse(body: string): RawTorrent[] {
    const doc = xml.parse(body);
    const items: TorznabItem[] = doc?.rss?.channel?.item ?? [];

    return items
      .map((item): RawTorrent | null => {
        const title = String(item.title ?? '').trim();
        if (!title) return null;

        const attrs = attrMap(item);
        const magnet = attrs.magneturl || (item.link?.startsWith('magnet:') ? item.link : undefined);
        const enclosureUrl = item.enclosure?.['@_url'];
        const torrentUrl =
          attrs.downloadurl ||
          (enclosureUrl && !enclosureUrl.startsWith('magnet:') ? enclosureUrl : undefined) ||
          (item.link && !item.link.startsWith('magnet:') ? item.link : undefined);

        const infoHash = attrs.infohash?.toLowerCase();
        if (!magnet && !infoHash && !torrentUrl) return null;

        const size =
          parseSize(item.size) ||
          parseSize(attrs.size) ||
          parseSize(item.enclosure?.['@_length']);

        const published = item.pubDate ? Date.parse(item.pubDate) : NaN;

        return {
          title,
          infoHash: infoHash && /^[a-f0-9]{40}$/.test(infoHash) ? infoHash : undefined,
          magnet,
          torrentUrl,
          sizeBytes: size,
          seeders: parseIntSafe(attrs.seeders),
          // Torznab reports `peers` as the total swarm; leechers = peers - seeders.
          leechers: Math.max(0, parseIntSafe(attrs.peers) - parseIntSafe(attrs.seeders)),
          publishedAt: Number.isNaN(published) ? undefined : published,
          category: Array.isArray(item.category) ? item.category[0] : item.category,
        };
      })
      .filter((r): r is RawTorrent => r !== null);
  }

  /** Connectivity/credential probe used by the Settings UI. */
  async testConnection(signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
    if (!this.baseUrl) return { ok: false, message: 'No base URL configured' };

    const params = new URLSearchParams({ t: 'caps' });
    if (this.apiKey) params.set('apikey', this.apiKey);

    for (const endpoint of this.candidateEndpoints()) {
      try {
        const body = await fetchText(`${endpoint}?${params}`, {
          signal,
          timeoutMs: 10_000,
          retries: 0,
        });
        if (/<error\b/i.test(body)) {
          const description = body.match(/description="([^"]*)"/)?.[1];
          return { ok: false, message: description ?? 'Torznab returned an error' };
        }
        if (/<caps\b/i.test(body)) {
          return { ok: true, message: `Connected to ${endpoint.replace(this.baseUrl, '')}` };
        }
      } catch {
        // Try the next endpoint layout.
      }
    }
    return { ok: false, message: 'No Torznab endpoint responded. Check URL and API key.' };
  }
}
