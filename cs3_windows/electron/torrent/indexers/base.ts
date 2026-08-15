import type { IndexerConfig, IndexerQuery, TorrentResult } from '../../../src/types/torrent';
import { parseReleaseName } from '../releaseParser';

/**
 * Everything an adapter must produce. Normalisation to `TorrentResult`
 * (parsing, magnet construction, scoring) is handled centrally by
 * `finaliseResult` so adapters stay thin and consistent.
 */
export interface RawTorrent {
  title: string;
  /** Either `infoHash` or `magnet` must be present; the other is derived. */
  infoHash?: string;
  magnet?: string;
  torrentUrl?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  publishedAt?: number;
  category?: string;
  /** Index of the playable file inside a multi-file torrent, when known. */
  fileIndex?: number;
  expectedFileName?: string;
}

export interface TorrentIndexer {
  readonly id: string;
  readonly name: string;
  /** Declared content specialisation; the registry uses it to skip irrelevant indexers. */
  readonly specialises: 'movie' | 'tv' | 'anime' | 'any';
  /** False when the adapter cannot serve this query (e.g. EZTV without an IMDb id). */
  canHandle(query: IndexerQuery): boolean;
  search(query: IndexerQuery, signal: AbortSignal): Promise<RawTorrent[]>;
}

/** Trackers appended to bare-infohash magnets so DHT-less peers are still reachable. */
export const DEFAULT_TRACKERS: readonly string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.bitsearch.to:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
];

const INFOHASH_HEX_RE = /\b([a-f0-9]{40})\b/i;
const INFOHASH_B32_RE = /\b([a-z2-7]{32})\b/i;

/** Extracts a normalised lowercase hex infohash from a magnet URI. */
export function infoHashFromMagnet(magnet: string): string | undefined {
  const xt = magnet.match(/xt=urn:btih:([^&]+)/i);
  if (!xt) return undefined;

  const value = decodeURIComponent(xt[1]);
  if (INFOHASH_HEX_RE.test(value)) return value.toLowerCase();

  // Base32 infohashes appear on some older trackers; convert to hex.
  if (INFOHASH_B32_RE.test(value)) {
    try {
      return base32ToHex(value.toUpperCase());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function base32ToHex(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.toLowerCase().slice(0, 40);
}

export function buildMagnet(infoHash: string, displayName?: string): string {
  const params = [`xt=urn:btih:${infoHash.toLowerCase()}`];
  if (displayName) params.push(`dn=${encodeURIComponent(displayName)}`);
  for (const tracker of DEFAULT_TRACKERS) params.push(`tr=${encodeURIComponent(tracker)}`);
  return `magnet:?${params.join('&')}`;
}

/**
 * Parses the size strings indexers emit ("1.4 GB", "700MiB", raw bytes).
 * Returns 0 when unparseable — the ranker treats 0 as "unknown" rather than "tiny".
 */
export function parseSize(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return 0;

  const text = String(value).trim();
  if (/^\d+$/.test(text)) return parseInt(text, 10);

  const match = text.match(/([\d.,]+)\s*([kmgt]?i?b)/i);
  if (!match) return 0;

  const amount = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return 0;

  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1e3,
    kib: 1024,
    mb: 1e6,
    mib: 1024 ** 2,
    gb: 1e9,
    gib: 1024 ** 3,
    tb: 1e12,
    tib: 1024 ** 4,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

export function parseIntSafe(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Normalises a `RawTorrent` into a `TorrentResult`.
 * Returns null when no infohash can be established, since without one the
 * result can be neither deduped nor streamed.
 */
export function finaliseResult(
  raw: RawTorrent,
  indexer: Pick<IndexerConfig, 'id' | 'name'>
): TorrentResult | null {
  let infoHash = raw.infoHash?.toLowerCase();
  let magnet = raw.magnet;

  if (!infoHash && magnet) infoHash = infoHashFromMagnet(magnet);
  if (infoHash && !magnet) magnet = buildMagnet(infoHash, raw.title);

  // Some Torznab indexers only expose a .torrent URL; keep it so the engine can
  // resolve the infohash lazily at stream time.
  if (!infoHash || !magnet) {
    if (!raw.torrentUrl) return null;
    return {
      infoHash: infoHash ?? '',
      title: raw.title,
      magnet: magnet ?? '',
      torrentUrl: raw.torrentUrl,
      sizeBytes: raw.sizeBytes ?? 0,
      seeders: raw.seeders ?? 0,
      leechers: raw.leechers ?? 0,
      indexerId: indexer.id,
      indexerName: indexer.name,
      publishedAt: raw.publishedAt,
      category: raw.category,
      fileIndex: raw.fileIndex,
      expectedFileName: raw.expectedFileName,
      parsed: parseReleaseName(raw.expectedFileName || raw.title),
      score: 0,
      scoreReasons: [],
    };
  }

  if (!/^[a-f0-9]{40}$/.test(infoHash)) return null;

  return {
    infoHash,
    title: raw.title,
    magnet,
    torrentUrl: raw.torrentUrl,
    sizeBytes: raw.sizeBytes ?? 0,
    seeders: raw.seeders ?? 0,
    leechers: raw.leechers ?? 0,
    indexerId: indexer.id,
    indexerName: indexer.name,
    publishedAt: raw.publishedAt,
    category: raw.category,
    fileIndex: raw.fileIndex,
    expectedFileName: raw.expectedFileName,
    // When the indexer names the exact file, parse that instead of the pack
    // title: a season-pack name carries no episode number, but its file does.
    parsed: parseReleaseName(raw.expectedFileName || raw.title),
    score: 0,
    scoreReasons: [],
  };
}
