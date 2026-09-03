import type {
  ProviderAudioTrack,
  ProviderDrm,
  ProviderPlaylistPart,
  TvType,
} from './api';

/**
 * Video quality tiers, expressed as vertical resolution so they sort numerically
 * and interoperate with `ExtractorLink.quality`.
 */
export const Resolution = {
  UHD_4K: 2160,
  QHD: 1440,
  FHD: 1080,
  HD: 720,
  SD: 480,
  LD: 360,
  Unknown: 0,
} as const;
export type Resolution = (typeof Resolution)[keyof typeof Resolution];

/**
 * Release source, ordered loosely by fidelity. `CAM`/`TS`/`SCR` are the
 * low-fidelity tier and are penalised hard by the ranker — they are the single
 * most common cause of "the stream played but was unwatchable".
 */
export const ReleaseSource = {
  Remux: 'Remux',
  BluRay: 'BluRay',
  WebDL: 'WEB-DL',
  WebRip: 'WEBRip',
  HDTV: 'HDTV',
  DVDRip: 'DVDRip',
  SCR: 'SCR',
  TS: 'TS',
  CAM: 'CAM',
  Unknown: 'Unknown',
} as const;
export type ReleaseSource = (typeof ReleaseSource)[keyof typeof ReleaseSource];

export const VideoCodec = {
  AV1: 'AV1',
  H265: 'x265',
  H264: 'x264',
  XviD: 'XviD',
  VP9: 'VP9',
  Unknown: 'Unknown',
} as const;
export type VideoCodec = (typeof VideoCodec)[keyof typeof VideoCodec];

/**
 * Structured interpretation of a scene/P2P release name.
 *
 * Torrent titles are the only metadata most indexers give us, so nearly every
 * downstream decision — episode matching, quality ranking, codec playability —
 * is derived from parsing this string. See `releaseParser.ts`.
 */
export interface ParsedRelease {
  /** Release name with metadata tokens stripped; used for fuzzy title matching. */
  cleanTitle: string;
  year?: number;
  season?: number;
  episode?: number;
  /** Absolute episode number, common in anime releases (`... - 137 [1080p]`). */
  absoluteEpisode?: number;
  /** True when the release covers a whole season (or multiple) rather than one episode. */
  isSeasonPack: boolean;
  isCompleteSeries: boolean;
  resolution: Resolution;
  source: ReleaseSource;
  videoCodec: VideoCodec;
  audioCodecs: string[];
  /** HDR formats present: HDR10, HDR10+, DV (Dolby Vision), HLG. */
  hdr: string[];
  languages: string[];
  isMultiAudio: boolean;
  isDualAudio: boolean;
  hasHardcodedSubs: boolean;
  isRepack: boolean;
  isProper: boolean;
  isRemastered: boolean;
  is3D: boolean;
  releaseGroup?: string;
}

/**
 * A playable candidate.
 *
 * Two kinds share this shape. Most are torrents, identified by `infoHash` and
 * fetched through the swarm. The rest are ordinary HTTP streams — from an
 * extension provider, or from a Stremio addon answering with `url` — and those
 * carry `directUrl` and no magnet, and skip the torrent engine entirely. Keeping one type means the ranker, the source
 * picker, the in-player switcher and the download queue treat both alike, which
 * is what lets a provider stream and a torrent sit in the same list.
 */
export interface TorrentResult {
  /** Lowercase hex infohash — the canonical cross-indexer identity for dedupe.
   *  For a provider-supplied direct stream this is a synthetic stable id. */
  infoHash: string;
  /**
   * Direct HTTP(S) media URL. When set, this source plays straight from the URL
   * and `magnet`/`torrentUrl` are empty.
   *
   * Written by extension providers and, since the Stremio adapter stopped
   * filtering them away, by any addon that answers with `url` rather than
   * `infoHash` — which is every debrid-fronted one.
   */
  directUrl?: string;
  /** Headers the origin requires — typically a Referer that it 403s without. */
  directHeaders?: Record<string, string>;
  /** True when `directUrl` is an HLS playlist rather than a progressive file. */
  isM3u8?: boolean;
  /**
   * True when `directUrl` is an MPEG-DASH manifest.
   *
   * Computed since the provider bridge learned to report it and then dropped on
   * the floor here, so a DASH stream reached the engine looking progressive and
   * was classified all over again from its first 64 KB.
   */
  isDash?: boolean;
  /** The MIME type the provider declared for this link, when it declared one. */
  mimeType?: string;
  /**
   * DRM the provider declared, which is authoritative over anything a probe
   * could conclude. Its presence keeps the source off the FFmpeg path entirely.
   */
  drm?: ProviderDrm;
  /** Audio delivered as separate files beside the video, as the provider gave them. */
  audioTracks?: ProviderAudioTrack[];
  /** Set when the title arrives in ordered parts rather than as one file. */
  playlist?: ProviderPlaylistPart[];
  /** Raw, unmodified release name as the indexer reported it. */
  title: string;
  magnet: string;
  /** Present when an indexer only exposes a `.torrent` file rather than a magnet. */
  torrentUrl?: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  indexerId: string;
  indexerName: string;
  /**
   * The extension provider that produced this source, when one did.
   *
   * Distinct from `indexerName`, which for an extension link is the *extractor*
   * — "Voe", "Server 3", "Hblinks Pixeldrain". Those are file hosts chosen by
   * the provider, not the provider itself, so attributing a playback failure to
   * one of them would rank hosts rather than extensions and tell the user
   * nothing about which of their sources to keep.
   */
  providerName?: string;
  publishedAt?: number;
  category?: string;
  /**
   * Index of the file to play inside a multi-file torrent, when the indexer
   * knows it. Torrentio supplies this for season packs, which removes the
   * guesswork the engine would otherwise do from file names.
   */
  fileIndex?: number;
  /** Filename the indexer expects to be played, used to verify file selection. */
  expectedFileName?: string;
  parsed: ParsedRelease;
  /** Composite ranking score from `rankResults()`. Higher is better. */
  score: number;
  /** Human-readable reasons behind the score, surfaced in the source picker. */
  scoreReasons: string[];
}

export interface IndexerQuery {
  query: string;
  type?: TvType;
  season?: number;
  episode?: number;
  year?: number;
  imdbId?: string;
  /** Result cap applied per indexer, before merging. */
  limit?: number;
}

export const IndexerKind = {
  Builtin: 'builtin',
  Torznab: 'torznab',
  /**
   * Any Stremio stream addon (Torrentio, MediaFusion, Jackettio, Comet…). One
   * documented GET protocol covers the whole ecosystem, so a user with a working
   * addon URL — including a self-hosted or debrid-configured one — can add it
   * without waiting for a bespoke adapter.
   */
  Stremio: 'stremio',
} as const;
export type IndexerKind = (typeof IndexerKind)[keyof typeof IndexerKind];

export interface IndexerConfig {
  id: string;
  name: string;
  kind: IndexerKind;
  enabled: boolean;
  /** Torznab base URL (`http://127.0.0.1:9117`) or Stremio addon base URL. */
  baseUrl?: string;
  apiKey?: string;
  /** Torznab indexer slug; `all` aggregates every configured indexer. */
  indexerSlug?: string;
  /** Adapter-declared content types; used to skip irrelevant indexers. */
  supportedTypes?: TvType[];
}

export interface IndexerHealth {
  id: string;
  name: string;
  enabled: boolean;
  lastOk?: number;
  lastError?: string;
  lastLatencyMs?: number;
  lastResultCount?: number;
  consecutiveFailures: number;
  /** Tripped by the circuit breaker after repeated failures. */
  isCircuitOpen: boolean;
}

/** Ranking inputs, user-tunable from Settings. */
export interface SourcePreferences {
  preferredResolution: Resolution;
  /** Reject anything below this resolution outright. */
  minResolution: Resolution;
  maxSizeBytes?: number;
  minSeeders: number;
  /** Exclude CAM/TS/SCR releases. On by default — they are near-unwatchable. */
  excludeLowQualitySources: boolean;
  /** Penalise x265/HEVC, which some hardware cannot decode in Chromium. */
  preferH264: boolean;
  preferredLanguages: string[];
  preferHDR: boolean;
  /** Release groups to boost or bury, matched case-insensitively. */
  preferredGroups: string[];
  blockedGroups: string[];
  blockedKeywords: string[];
}

export const DEFAULT_SOURCE_PREFERENCES: SourcePreferences = {
  preferredResolution: Resolution.FHD,
  minResolution: Resolution.Unknown,
  minSeeders: 1,
  excludeLowQualitySources: true,
  preferH264: false,
  preferredLanguages: ['en'],
  preferHDR: false,
  preferredGroups: [],
  blockedGroups: [],
  blockedKeywords: [],
};

/** Live state of one streaming torrent, polled by the player. */
export interface TorrentStreamStats {
  infoHash: string;
  name: string;
  /** Loopback URL the player points at. */
  streamUrl: string;
  fileName: string;
  fileSize: number;
  downloaded: number;
  /** 0..1 over the whole torrent. */
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  /** Contiguous bytes available from the start of the file — what playback depends on. */
  readyBytes: number;
  /** True once enough leading data exists to begin playback. */
  isPlayable: boolean;
  timeRemainingMs: number;
  isPaused: boolean;
  /** Milliseconds since the selected file last gained a byte. */
  stalledMs: number;
  /**
   * True when nothing has arrived for long enough that the swarm is more likely
   * dead than slow. Drives the player's failover prompt.
   */
  isStalled: boolean;
  error?: string;
}

export interface TorrentFileEntry {
  index: number;
  name: string;
  path: string;
  length: number;
  isVideo: boolean;
  /** Set on the file the engine selected for playback. */
  isSelected: boolean;
}

// --- swarm health ----------------------------------------------------------

/**
 * What a torrent is being fetched *for*, which is the only input that should
 * change the piece strategy. See `electron/torrent/swarmHealth.ts`.
 */
export type SwarmMode = 'stream' | 'download';

/** How a peer came to be connected. The incoming/outgoing split is the point. */
export type PeerClass = 'incoming' | 'outgoing' | 'webSeed' | 'webrtc';

export interface PeerCensus {
  total: number;
  incoming: number;
  outgoing: number;
  webSeed: number;
  webrtc: number;
}

export type SwarmFindingId =
  | 'unreachable'
  | 'reachable'
  | 'reachability-unknown'
  | 'thin-swarm'
  | 'connection-ceiling'
  | 'no-utp'
  | 'sequential-cost';

export interface SwarmFinding {
  id: SwarmFindingId;
  /** `limit` costs speed now; `note` is context; `good` is a confirmation. */
  tone: 'limit' | 'note' | 'good';
  summary: string;
  /** What the user can actually do, when anything. */
  advice?: string;
}

/** Everything known about how one torrent is connected, and what limits it. */
export interface SwarmReport {
  infoHash: string;
  census: PeerCensus;
  findings: SwarmFinding[];
  summary: string;
  mode: SwarmMode;
  /** The port peers would dial to reach us; 0 when the client is not started. */
  listenPort: number;
  utpAvailable: boolean;
  downloadSpeed: number;
  uploadSpeed: number;
}
