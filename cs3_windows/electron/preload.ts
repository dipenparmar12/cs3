import { contextBridge, ipcRenderer } from 'electron';
import type { LogLevel } from './logging/logger';
import type {
  ProviderCatalog,
  ProviderCatalogPage,
  SearchHistoryEntry,
  SearchOptions,
  SearchResponse,
  SearchSuggestion,
} from '../src/types/api';
import type { OttPlatformView } from './cs3/ottPlatforms';
import type { DownloadRequestResult, DownloadTask } from '../src/types/download';
import type { SwarmReport } from '../src/types/torrent';
import type { SitePlugin, PluginCompatibilityReport, ProviderTreeRepository } from '../src/types/plugin';
import type {
  IndexerConfig,
  IndexerHealth,
  SourcePreferences,
  TorrentFileEntry,
  TorrentResult,
  TorrentStreamStats,
} from '../src/types/torrent';
import type { OfficialRepository } from './officialRepositories';
import type { MetadataDetail } from './metadataProvider';
import type { SourceResponse, StreamAttempt } from './contentService';
import type {
  ExtensionProvider,
  PluginRuntimeReport,
  ProviderLoadProgress,
  RepositoryFetchResult,
} from './pluginManager';
import type { ProbeConfig } from './media/mediaInspector';
import type { SearchScope } from './searchScope';
import type { SearchSnapshot } from './searchSession';
import type { DnsPreset, NetworkSettings } from './networkSettings';
import type { SystemRuntimeStatus, RuntimeProgress } from './cs3/runtimeProvisioner';
import type { Bookmark } from './cs3/bookmarkStore';
import type { DiscoverySection } from './cs3/discovery';
import type { PrefetchState } from './cs3/sourcePrefetcher';
import type { EnrichedMetadata } from './cs3/titleEnricher';
import type {
  AnalyticsSettings,
  ProviderAnalyticsRecord,
  ProviderPreference,
  ProviderRecommendation,
  ProviderScore,
  RankingCriterionInfo,
} from '../src/types/analytics';
import type {
  AvailableUpdate,
  UpdateCheckResult,
  UpdateOutcome,
  UpdateSettings,
} from './cs3/extensionUpdater';
import type { BatchDownloadRequest, BatchProgress } from './cs3/batchDownloader';
import type { BootstrapProgress } from './cs3/bootstrap';
import type { TitleOutcome, TitleOutcomeKind } from './cs3/titleOutcomes';
import type { StoredSource, PlayedSource } from '../src/types/library';
import type {
  HistoryEvent,
  HistoryFilter,
  HistoryListResponse,
  HistoryStats,
} from '../src/types/history';
import type { DiagnosticRecord, DiagnosticStage } from './cs3/diagnostics';
import type { ExtensionIssue, IssueSummary } from './cs3/extensionIssues';
import type { ExternalPlayer } from './externalPlayer';
import type { ExternalPlaybackSnapshot } from '../src/types/player';
import type {
  LibraryEntry,
  SourceMemory,
  WatchProgress,
  WatchStatus,
} from './cs3/libraryStore';
import type { StreamHandle } from './torrent/torrentEngine';
import type { PlaybackSnapshot } from './playbackSession';
import type { SubtitleSearchResult } from './subtitleService';
import type {
  PlaybackDiagnosticEvent,
  PlaybackStreamRequest,
  PlaybackStreamResponse,
  RendererCapabilities,
  SourceCapabilityModel,
} from '../src/types/media';
import type {
  MpvCommandResult,
  MpvEngineStatus,
  MpvOpenRequest,
  MpvSnapshot,
} from '../src/types/mpv';

/**
 * Typed, allow-listed IPC surface (ARCH-2 / SEC-9).
 *
 * Handlers that can fail return an `{ ok, error }` envelope rather than
 * rejecting, so a transport failure surfaces in the UI as a message the user can
 * act on instead of an unhandled rejection in the renderer.
 */

export interface Envelope {
  ok: boolean;
  error?: string;
}

export interface CloudStreamElectronAPI {
  // Content
  searchAll: (
    query: string,
    options?: SearchOptions
  ) => Promise<Envelope & { results: SearchResponse[] }>;

  /**
   * Opens a search and returns its opening snapshot immediately.
   *
   * Push-shaped, like `startPlayback`: results, per-source outcomes and the
   * resolved scope all arrive afterwards through {@link onSearchUpdate}. The
   * search can be abandoned with {@link cancelSearch} once the viewer has found
   * what they wanted, which stops the providers still scraping.
   */
  startSearch: (
    query: string,
    options?: SearchOptions
  ) => Promise<Envelope & { snapshot: SearchSnapshot | null }>;
  cancelSearch: (id: string) => Promise<Envelope & { snapshot: SearchSnapshot | null }>;
  /** Returns an unsubscribe function. */
  onSearchUpdate: (callback: (snapshot: SearchSnapshot) => void) => () => void;
  /**
   * A catalogue row for browsing, not a search.
   *
   * Answers from the metadata catalogues in a few hundred milliseconds instead
   * of waiting on every installed scraper. Pass a provider name to browse that
   * one provider's own library instead.
   */
  browse: (query: string, provider?: string) => Promise<Envelope & { results: SearchResponse[] }>;
  /**
   * What happened last time each title was opened, keyed by URL.
   *
   * `no-sources` is the source's problem and is worth showing on the row;
   * `app-error` is ours, and is shown as such rather than as the title being
   * unavailable — blaming the content for our own bug is how one broken
   * translation pass came to look like a hundred broken providers.
   */
  getTitleOutcomes: () => Promise<Record<string, TitleOutcome>>;

  /**
   * Recorded provider failures, newest first.
   *
   * What makes one of these actionable is the tuple — which provider, on which
   * query, for which item, at what address — not the message, so all of it is
   * kept and `reportDiagnostics` renders it as pasteable text.
   */
  getDiagnostics: (
    limit?: number,
    /** Defaults to problems only; pass `info` too for the full activity log. */
    levels?: Array<'error' | 'warn' | 'info'>
  ) => Promise<
    Envelope & { records: DiagnosticRecord[]; total: number; filePath: string }
  >;
  clearDiagnostics: () => Promise<Envelope>;
  /** Omit `ids` for the whole log; pass them for the one failure on screen. */
  /**
   * Renders a pasteable report.
   *
   * `mode: 'current'` narrows to the failure described by `context`; `'full'`
   * takes the session. Both deduplicate repeated events into occurrence counts,
   * so the full report stays readable even when a provider failed in a loop.
   */
  reportDiagnostics: (options?: {
    ids?: string[];
    mode?: 'current' | 'full';
    context?: { query?: string; title?: string; url?: string; source?: string; message?: string };
  }) => Promise<Envelope & { text: string; records: number }>;
  recordDiagnostic: (entry: {
    level: 'error' | 'warn';
    stage: DiagnosticStage;
    source?: string;
    query?: string;
    title?: string;
    url?: string;
    message: string;
    detail?: string;
  }) => Promise<Envelope>;
  recordTitleOutcome: (
    url: string,
    kind: TitleOutcomeKind,
    reason?: string
  ) => Promise<Envelope>;
  /**
   * Title metadata, from cache when there is one.
   *
   * Returns immediately on a hit whatever its age; a stale entry is refreshed
   * behind the call and the result arrives through {@link onDetailUpdate}.
   */
  loadMedia: (url: string) => Promise<Envelope & { detail: MetadataDetail | null }>;
  /** Fires when a background refresh produced newer metadata. Returns a disposer. */
  onDetailUpdate: (
    callback: (payload: { url: string; detail: MetadataDetail }) => void
  ) => () => void;
  getSources: (request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  }) => Promise<Envelope & SourceResponse>;
  getPluginRuntimeStatus: () => Promise<{
    available: boolean;
    installedCount: number;
    reason: string;
  }>;

  // Search assistance: what the user probably meant, and what they asked before.
  /** Title autocomplete merged across catalogues; tolerant of misspellings. */
  suggestTitles: (
    query: string
  ) => Promise<Envelope & { suggestions: SearchSuggestion[] }>;
  /**
   * Subtitles for what is playing, from both sources that have them.
   *
   * `imdbId` drives the OpenSubtitles lookup. `mediaUrl` is what unlocks the
   * other half: a `cs3ext://` URL lets the provider be asked for the subtitles
   * it published with the stream, which is often the only set that exists for
   * content the catalogues have never heard of.
   */
  searchSubtitles: (
    imdbId: string,
    season?: number,
    episode?: number,
    mediaUrl?: string
  ) => Promise<Envelope & { results: SubtitleSearchResult[] }>;
  /** Searches subtitles with a custom title or IMDb id query. */
  searchSubtitlesByTitle: (
    query: string,
    season?: number,
    episode?: number,
    mediaUrl?: string
  ) => Promise<
    Envelope & {
      results: SubtitleSearchResult[];
      imdbId?: string;
      matchedTitle?: string;
    }
  >;
  /** Downloads one subtitle, already converted from SubRip to WebVTT. */
  fetchSubtitle: (url: string) => Promise<Envelope & { vtt: string }>;

  getSearchHistory: () => Promise<SearchHistoryEntry[]>;
  removeSearchHistory: (query: string) => Promise<SearchHistoryEntry[]>;
  clearSearchHistory: () => Promise<SearchHistoryEntry[]>;

  // Torrent streaming
  startStream: (
    source: TorrentResult,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { handle: StreamHandle | null }>;
  /** Tries ranked sources in order until one produces playable data. */
  startBestStream: (
    sources: TorrentResult[],
    season?: number,
    episode?: number
  ) => Promise<
    Envelope & {
      handle: StreamHandle | null;
      source: TorrentResult | null;
      attempts: StreamAttempt[];
    }
  >;
  /** Finds sources and starts the first that works, in one round trip. */
  autoPlay: (request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  }) => Promise<
    Envelope & {
      handle: StreamHandle | null;
      source: TorrentResult | null;
      attempts: StreamAttempt[];
    }
  >;
  // Playback sessions — the progressive "press play, watch it resolve" flow.
  /** Opens the session; returns as soon as it exists, not when a stream is ready. */
  startPlayback: (
    request: { mediaUrl: string; season?: number; episode?: number; titleOverride?: string },
    title: string,
    episodeTitle?: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  /** Starts the best source found so far instead of waiting for every indexer. */
  /** Abandons a source that started but will not play, and tries the next. */
  skipPlaybackSource: (
    sessionId: string,
    reason: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  playbackPlayNow: (
    sessionId: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  playbackSelectSource: (
    sessionId: string,
    infoHash: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  /**
   * Re-runs discovery for a live session.
   *
   * `widen` is the difference between "ask again" and "ask everyone". The
   * default re-asks the providers this title was found on — the Android
   * behaviour — and widening reaches every enabled provider and every torrent
   * indexer, which is a deliberate choice rather than the default.
   */
  playbackRefreshSources: (
    sessionId: string,
    widen?: boolean
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  /**
   * Finds sources without starting one — the detail screen's picker.
   *
   * Reports through `onPlaybackUpdate` like playing does, so the caller filters
   * snapshots by the session id this returns.
   */
  startSourceDiscovery: (
    request: { mediaUrl: string; season?: number; episode?: number; titleOverride?: string },
    title: string,
    episodeTitle?: string,
    options?: { bypassCache?: boolean }
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  /** Stops waiting for the remaining providers; keeps what has been found. */
  playbackCancelSourceSearch: (
    sessionId: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  stopPlayback: (sessionId: string, keepFiles?: boolean) => Promise<Envelope>;
  recordBufferHeartbeat: (
    sessionId: string,
    bufferedSeconds: number,
    currentBitrate?: number
  ) => Promise<Envelope>;
  recordBufferStall: (sessionId: string) => Promise<Envelope>;
  onPlaybackUpdate: (callback: (snapshot: PlaybackSnapshot) => void) => () => void;

  /** Resolved-source cache: how much is stored, and a way to drop it. */
  /** Providers registered by installed extensions, plus which are switched off. */
  /**
   * How many extension providers a search asks at once.
   *
   * Raising it past the machine's core count mostly moves the queue into the
   * sidecar; lowering it helps a slow connection, where every simultaneous
   * scrape contends for the same bandwidth.
   */
  getSearchConcurrency: () => Promise<{ value: number; min: number; max: number; def: number }>;
  setSearchConcurrency: (
    value: number
  ) => Promise<{ value: number; min: number; max: number; def: number }>;

  /** First-run install of the bundled repositories. Returns an unsubscribe fn. */
  getBootstrapProgress: () => Promise<BootstrapProgress>;
  onBootstrapProgress: (callback: (progress: BootstrapProgress) => void) => () => void;
  /**
   * Adult content, off by default. Turning it off hides adult repositories from
   * the catalogue and withdraws every NSFW provider from search immediately.
   */
  getAdultAllowed: () => Promise<boolean>;
  setAdultAllowed: (
    enabled: boolean
  ) => Promise<Envelope & { enabled: boolean; providers: string[] }>;

  getExtensionProviders: () => Promise<
    Envelope & { providers: ExtensionProvider[]; disabled: string[] }
  >;
  setProviderEnabled: (name: string, enabled: boolean) => Promise<string[]>;
  setProvidersEnabled: (names: string[], enabled: boolean) => Promise<string[]>;
  getProviderTree: () => Promise<
    Envelope & {
      tree: ProviderTreeRepository[];
      disabled: string[];
      disabledExtensions: string[];
      disabledRepositories: string[];
    }
  >;

  /**
   * Switch a repository or extension off without deleting it.
   *
   * Distinct from `removeRepository`/`uninstallPlugin`, which delete archives.
   * Each returns the new disabled list so the renderer re-renders from what was
   * stored rather than from what it assumed.
   */
  setRepositoryEnabled: (repositoryId: string, enabled: boolean) => Promise<string[]>;
  setRepositoriesEnabled: (repositoryIds: string[], enabled: boolean) => Promise<string[]>;
  setExtensionEnabled: (internalName: string, enabled: boolean) => Promise<string[]>;
  setExtensionsEnabled: (internalNames: string[], enabled: boolean) => Promise<string[]>;

  /** The repository → extension → provider tree, plus the current narrowing. */
  /** DNS configuration, and a reachability check against real indexer hosts. */
  getNetworkSettings: () => Promise<{ settings: NetworkSettings; presets: DnsPreset[] }>;
  setNetworkSettings: (settings: Partial<NetworkSettings>) => Promise<NetworkSettings>;
  resetNetworkSettings: () => Promise<NetworkSettings>;
  /** Probes the catalogues and every configured indexer through the DNS setting. */
  testNetwork: () => Promise<{
    ok: boolean;
    dnsMode: NetworkSettings['dnsMode'];
    results: Array<{
      name: string;
      /** `indexer` rows follow the user's own configuration; `catalogue` are fixed. */
      kind: 'catalogue' | 'indexer';
      /** False for an indexer switched off in Settings → Sources. */
      enabled: boolean;
      ok: boolean;
      status?: number;
      latencyMs: number;
      error?: string;
    }>;
  }>;

  /**
   * @param ensureLoaded pay for the one-time load of every installed extension.
   * Pass `false` for an instant answer from whatever is already registered —
   * which is what a component should do when it mounts, so it can render
   * something rather than waiting minutes for a list it could partly show now.
   */
  getSearchScopeOptions: (ensureLoaded?: boolean) => Promise<
    Envelope & {
      repositories: ProviderTreeRepository[];
      disabledProviders: string[];
      indexers: Array<{ id: string; name: string }>;
      scope: SearchScope;
      /** False while extensions are still being loaded into the sidecar. */
      ready: boolean;
      progress: ProviderLoadProgress;
    }
  >;
  setSearchScope: (scope: Partial<SearchScope>) => Promise<SearchScope>;
  /** Fires as each installed extension is loaded, so lists can fill in. */
  onProviderLoadProgress: (
    callback: (progress: ProviderLoadProgress) => void
  ) => () => void;

  /**
   * Inspects a stream's audio tracks. Reports tracks Chromium cannot decode,
   * which a `<video>` element does not expose at all.
   */
  /**
   * Inspects a stream's audio *and* video for codecs Chromium cannot decode.
   *
   * A `<video>` element exposes almost nothing about tracks it cannot decode,
   * so without this the app cannot tell the difference between a file with no
   * sound and one whose AC-3 track was silently dropped — nor between a broken
   * source and an HEVC one.
   */
  inspectMediaSource: (
    request: Pick<PlaybackStreamRequest, 'url' | 'headers' | 'isM3u8' | 'refresh'>
  ) => Promise<Envelope & { capability: SourceCapabilityModel | null }>;
  /**
   * Inspects, decides and opens a playable stream in one call.
   *
   * The whole contract with the player: ask, wait, attach. There is deliberately
   * no way to obtain a URL that has not been classified — that shape is what
   * created the race PRD-37 §4.1 describes, where the element failed on an
   * unsupported bitstream before the probe it was racing had returned.
   */
  preparePlaybackStream: (request: PlaybackStreamRequest) => Promise<PlaybackStreamResponse>;
  /**
   * Maps a different audio track and resumes at the current position.
   *
   * The element only ever receives the one track selected for it, so switching
   * restarts the conversion with a different `-map`. The returned URL carries
   * the seek, which is the difference between changing track and losing your
   * place in the film.
   */
  switchAudioTrack: (
    sessionId: string,
    audioIndex: number,
    positionSeconds: number
  ) => Promise<Envelope & { url?: string }>;
  closePlaybackStream: (sessionId: string) => Promise<Envelope>;
  /** Strategy, codecs and encoder timings for every playback attempt. */
  getPlaybackDiagnostics: (
    sessionId?: string
  ) => Promise<Envelope & { events: PlaybackDiagnosticEvent[] }>;
  /** Codec strings to hand `canPlayType`, keyed by ffprobe's name for each. */
  getCodecProbes: () => Promise<Record<string, string>>;
  /**
   * Reports what this build actually decodes.
   *
   * Believed over the main process's own table: Chromium's HEVC support depends
   * on the build and on platform decoders being present, so only the renderer
   * can answer for the machine in front of the user.
   */
  setMediaCapabilities: (capabilities: RendererCapabilities) => Promise<Envelope>;
  /**
   * How long a source gets to describe itself before it is given up on.
   *
   * The default budget is generous on a normal connection and too short on a
   * slow or high-latency one — where the visible result is that *every* source
   * "fails", because ffprobe ran out of time rather than because anything was
   * wrong with the stream. Exposed so the user it affects can raise it; it was
   * registered in the main process with no way to reach it.
   */
  getProbeConfig: () => Promise<Envelope & { config: ProbeConfig }>;
  setProbeConfig: (config: Partial<ProbeConfig>) => Promise<Envelope & { config?: ProbeConfig }>;

  /**
   * Media players installed on this machine, and where to get one.
   *
   * Chromium decodes a subset of what people stream, and this app closes part
   * of the gap by transcoding. Handing the stream to VLC or mpv closes the rest
   * for free — they carry their own ffmpeg and play essentially anything.
   * Nothing is ever downloaded on the user's behalf; `downloads` are links.
   */
  listExternalPlayers: (
    refresh?: boolean
  ) => Promise<
    Envelope & {
      players: ExternalPlayer[];
      downloads: Array<{ id: string; name: string; url: string; note: string }>;
    }
  >;
  /**
   * Opens a stream in one of them.
   *
   * Pass the URL the player is using, proxied and all: external players each
   * have their own incompatible way of setting a `Referer`, and the loopback
   * URL has the provider's headers already applied.
   */
  openInExternalPlayer: (playerId: string, url: string) => Promise<Envelope>;
  /**
   * Puts back the archive an update replaced.
   *
   * A failed update rolls itself back; this is for the case the load check
   * cannot see — an extension that links fine and then scrapes nothing.
   */
  rollbackExtension: (
    repositoryUrl: string,
    internalName: string
  ) => Promise<Envelope & { message: string }>;
  hasPreviousExtensionVersion: (
    repositoryUrl: string,
    internalName: string
  ) => Promise<Envelope & { available: boolean }>;

  // --- external playback, with a control channel where one exists ---
  /**
   * Hands the stream over **and** reports whether we can drive that player.
   *
   * `capability: 'full'` means the controls below reach it and its position
   * comes back; `'none'` means it is playing and we have no channel to it. The
   * player UI must respect the difference rather than showing controls that
   * cannot work.
   */
  openControlledExternal: (
    playerId: string,
    url: string
  ) => Promise<Envelope & { capability: 'full' | 'none'; engine?: string }>;
  getExternalCapability: (
    playerId: string
  ) => Promise<Envelope & { capability: 'full' | 'none' }>;
  getExternalSnapshot: () => Promise<Envelope & { snapshot: ExternalPlaybackSnapshot | null }>;
  onExternalUpdate: (callback: (snapshot: ExternalPlaybackSnapshot) => void) => () => void;
  externalSetPaused: (paused: boolean) => Promise<Envelope>;
  externalSeek: (seconds: number) => Promise<Envelope>;
  externalSetVolume: (percent: number) => Promise<Envelope>;
  externalSetMuted: (muted: boolean) => Promise<Envelope>;
  externalSetSpeed: (rate: number) => Promise<Envelope>;
  externalSetFullscreen: () => Promise<Envelope>;
  externalStop: () => Promise<Envelope>;

  /** Opens an http(s) link in the system browser. Other schemes are refused. */
  openExternalLink: (url: string) => Promise<Envelope>;

  // --- native playback engine (mpv) ---
  /**
   * The engine's controls, mirroring what a `<video>` element would have offered.
   *
   * A stream routed to mpv produces no `timeupdate`, no `buffered` ranges and no
   * track list in the DOM, so the player renders from {@link onMpvUpdate}
   * snapshots and drives playback through these instead. There is deliberately
   * no method that takes a raw URL: everything playable still comes out of
   * `preparePlaybackStream`, which inspects the source first.
   */
  getMpvStatus: () => Promise<Envelope & { status: MpvEngineStatus }>;
  openInNativeEngine: (request: MpvOpenRequest) => Promise<MpvCommandResult>;
  mpvSetPaused: (paused: boolean) => Promise<MpvCommandResult>;
  mpvSeek: (seconds: number) => Promise<MpvCommandResult>;
  mpvSetVolume: (volume: number) => Promise<MpvCommandResult>;
  mpvSetMuted: (muted: boolean) => Promise<MpvCommandResult>;
  mpvSetSpeed: (speed: number) => Promise<MpvCommandResult>;
  mpvSetFullscreen: (fullscreen: boolean) => Promise<MpvCommandResult>;
  /** mpv track ids, which are 1-based and per type — not ffprobe ordinals. */
  mpvSetAudioTrack: (id: number | null) => Promise<MpvCommandResult>;
  mpvSetSubtitleTrack: (id: number | null) => Promise<MpvCommandResult>;
  mpvAddSubtitle: (url: string, title?: string, language?: string) => Promise<MpvCommandResult>;
  mpvSetSubtitleDelay: (seconds: number) => Promise<MpvCommandResult>;
  /** Appearance, already translated to mpv property names. */
  mpvSetSubtitleStyle: (properties: Record<string, unknown>) => Promise<MpvCommandResult>;
  mpvStop: () => Promise<MpvCommandResult>;
  /** A pull, for a player that mounted while something was already playing. */
  getMpvSnapshot: () => Promise<Envelope & { snapshot: MpvSnapshot }>;
  onMpvUpdate: (callback: (snapshot: MpvSnapshot) => void) => () => void;
  getNativeEnginePolicy: () => Promise<
    Envelope & { policy: 'off' | 'auto' | 'aggressive'; available: boolean }
  >;
  setNativeEnginePolicy: (
    policy: 'off' | 'auto' | 'aggressive'
  ) => Promise<Envelope & { policy?: string }>;
  /** Fetches mpv. Not part of `setupAllBinaries` — it is the biggest download. */
  setupMpv: () => Promise<Envelope & { status: MpvEngineStatus }>;

  getSourceCacheStats: () => Promise<{ entries: number; sources: number }>;
  clearSourceCache: () => Promise<Envelope>;

  getStreamStats: (infoHash: string) => Promise<TorrentStreamStats | null>;
  selectStreamFile: (infoHash: string, fileIndex: number) => Promise<StreamHandle | null>;
  stopStream: (infoHash: string, keepFiles?: boolean) => Promise<void>;
  getActiveStreams: () => Promise<TorrentStreamStats[]>;
  clearTorrentCache: () => Promise<Envelope & { removed: number }>;
  getTorrentCachePath: () => Promise<string>;
  /**
   * Why this torrent is as fast or as slow as it is, including the part no
   * setting can change. See `torrent/swarmHealth.ts`.
   */
  getSwarmReport: (infoHash: string) => Promise<SwarmReport | null>;

  // Indexers and ranking preferences
  getIndexerConfigs: () => Promise<IndexerConfig[]>;
  saveIndexerConfig: (config: IndexerConfig) => Promise<IndexerConfig[]>;
  removeIndexerConfig: (id: string) => Promise<IndexerConfig[]>;
  testIndexer: (config: IndexerConfig) => Promise<{ ok: boolean; message: string }>;
  getIndexerHealth: () => Promise<IndexerHealth[]>;
  getSourcePreferences: () => Promise<SourcePreferences>;
  saveSourcePreferences: (prefs: Partial<SourcePreferences>) => Promise<SourcePreferences>;

  // Downloads
  enqueueDownload: (task: DownloadTask) => Promise<string>;
  /**
   * Asks for a variant to make progress, and says what that meant.
   *
   * Prefer this to {@link enqueueDownload} for anything a person clicked: it
   * resumes a paused transfer, recovers a failed one and refuses only a genuine
   * duplicate, where enqueue would create a second task for all three.
   */
  requestDownload: (task: DownloadTask) => Promise<DownloadRequestResult>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  /**
   * Removes a download from the list, and its file when `deleteFile` is true.
   *
   * The flag is required rather than inferred: on a finished film the two are
   * unrecoverably different actions, and the destructive one cannot be undone.
   */
  removeDownload: (id: string, deleteFile?: boolean) => Promise<void>;
  /**
   * Player preferences that outlive one film: volume, mute, speed, and the
   * track *languages* the viewer keeps choosing.
   */
  getPlayerPreferences: () => Promise<
    Envelope & {
      preferences: {
        volume: number;
        muted: boolean;
        speed: number;
        audioLanguage?: string;
        subtitleLanguage?: string;
        /** Multiplier on the base cue size, 0.5–3. */
        subtitleScale: number;
        /** `#rrggbb`; anything else is replaced with the default on read. */
        subtitleColor: string;
        /** How a cue is separated from the picture behind it. */
        subtitleBackground: 'none' | 'shadow' | 'outline' | 'box';
        subtitleWeight: 'normal' | 'bold';
        /** Percent of frame height to lift cues by, for hard-subbed releases. */
        subtitlePosition: number;
        /**
         * What "minimise" does. `pip` is Chromium's native Picture-in-Picture
         * and is only reachable while the `<video>` element is what is playing
         * — mpv and an external player have their own windows and there is no
         * surface for PiP to detach.
         */
        floatingMode: 'mini' | 'floating' | 'pip' | 'background';
        /** Whether the film keeps running when it is out of sight. */
        backgroundPlayback: 'continue' | 'audio-only' | 'pause';
        /** Pin the app above other windows while a floating player is showing. */
        alwaysOnTop: boolean;
      };
    }
  >;
  setPlayerPreferences: (patch: {
    volume?: number;
    muted?: boolean;
    speed?: number;
    audioLanguage?: string;
    subtitleLanguage?: string;
    subtitleScale?: number;
    subtitleColor?: string;
    subtitleBackground?: 'none' | 'shadow' | 'outline' | 'box';
    subtitleWeight?: 'normal' | 'bold';
    subtitlePosition?: number;
    floatingMode?: 'mini' | 'floating' | 'pip' | 'background';
    backgroundPlayback?: 'continue' | 'audio-only' | 'pause';
    alwaysOnTop?: boolean;
  }) => Promise<Envelope>;
  /**
   * Pins the application window above everything else.
   *
   * The one floating mechanism that is indifferent to what is playing. Native
   * Picture-in-Picture detaches the element's surface and cannot help a stream
   * routed to mpv; mpv's own `ontop` cannot help one playing in the element.
   * This changes a window level, so a torrent stream, a 4K file the native
   * engine is decoding and an ordinary MP4 all float equally.
   */
  setWindowAlwaysOnTop: (onTop: boolean) => Promise<Envelope & { alwaysOnTop: boolean }>;
  getWindowAlwaysOnTop: () => Promise<Envelope & { alwaysOnTop: boolean }>;
  /**
   * Pins mpv's own window, for a stream the native engine is holding.
   *
   * Answers `applied: false` rather than failing when mpv is not running: the
   * caller is applying one preference across every engine and only one of them
   * has the stream.
   */
  setMpvOnTop: (onTop: boolean) => Promise<Envelope & { applied: boolean }>;
  /**
   * Drops mpv's video track for audio-only background playback.
   *
   * Meaningful only on the native engine. An offscreen `<video>` element keeps
   * decoding whatever it is told to, so "audio only" there is a description of
   * what is on screen rather than of what the machine is doing; mpv genuinely
   * stops.
   */
  setMpvVideoEnabled: (enabled: boolean) => Promise<Envelope & { applied: boolean }>;
  getDeleteDownloadPreference: () => Promise<
    Envelope & { preference: 'ask' | 'list-only' | 'list-and-file' }
  >;
  setDeleteDownloadPreference: (
    preference: 'ask' | 'list-only' | 'list-and-file'
  ) => Promise<Envelope & { preference?: string }>;
  getDownloadQueue: () => Promise<DownloadTask[]>;
  /**
   * A finished download, as a URL the player can open.
   *
   * Served from loopback rather than handed over as a path, so the file goes
   * through `media:prepare` like any other source and is classified before
   * anything is attached to it.
   */
  getPlayableDownloadUrl: (filePath: string) => Promise<Envelope & { url?: string }>;
  revealInFolder: (filePath?: string) => Promise<void>;
  onDownloadProgress: (callback: (tasks: DownloadTask[]) => void) => () => void;

  // Season / series batch downloads
  startBatchDownload: (
    request: BatchDownloadRequest
  ) => Promise<Envelope & { progress: BatchProgress | null }>;
  cancelBatchDownload: (batchId: string) => Promise<boolean>;
  getActiveBatches: () => Promise<BatchProgress[]>;
  onBatchProgress: (callback: (progress: BatchProgress) => void) => () => void;

  // Unified Components & Binaries
  getComponentStatus: () => Promise<Envelope & {
    allReady: boolean;
    missingCount: number;
    runtime: SystemRuntimeStatus;
    binaries: { aria2: boolean; ytdlp: boolean; ffmpeg: boolean; ffprobe: boolean; mpv: boolean };
    suites: { runtime: boolean; downloads: boolean; media: boolean };
  }>;
  checkBinaries: () => Promise<{
    aria2: boolean;
    ytdlp: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
    /**
     * The native engine. Bundled on Windows; on Linux and macOS it comes from
     * the platform's own package, so absent is a normal, working state there.
     */
    mpv: boolean;
    /** Which of these shipped with the app rather than being downloaded. */
    bundled: { ffmpeg: boolean; ffprobe: boolean; mpv: boolean };
  }>;
  testAllBinaries: () => Promise<{
    aria2: { ok: boolean; version?: string; path?: string; error?: string };
    ytdlp: { ok: boolean; version?: string; path?: string; error?: string };
    ffmpeg: { ok: boolean; version?: string; path?: string; error?: string };
    ffprobe: { ok: boolean; version?: string; path?: string; error?: string };
  }>;
  testBinary: (
    name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv'
  ) => Promise<{ ok: boolean; version?: string; path?: string; error?: string }>;
  removeBinary: (
    name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'media' | 'downloads' | 'all'
  ) => Promise<{ ok: boolean }>;
  setupAria2: () => Promise<{ ok: boolean; message: string }>;
  setupYtDlp: () => Promise<{ ok: boolean; message: string }>;
  setupAllBinaries: () => Promise<{ ok: boolean; message: string }>;
  /** Installs FFmpeg + FFprobe. No PATH or codec configuration is exposed. */
  setupFfmpeg: () => Promise<Envelope & { message: string }>;
  onBinarySetupProgress: (
    callback: (progress: { component?: string; status: string; percent: number }) => void
  ) => () => void;

  // Plug-and-Play Runtime Provisioner
  getSystemRuntimeStatus: () => Promise<Envelope & SystemRuntimeStatus>;
  provisionSystemRuntime: () => Promise<Envelope & { ready: boolean }>;
  repairSystemRuntime: () => Promise<Envelope & { ready: boolean }>;
  testSystemRuntime: () => Promise<{
    ok: boolean;
    version?: string;
    javaPath?: string;
    sidecarPath?: string;
    runtimeDir?: string;
    error?: string;
  }>;
  cleanSystemRuntime: () => Promise<{ ok: boolean; message: string }>;
  onSystemRuntimeProgress: (
    callback: (progress: RuntimeProgress) => void
  ) => () => void;

  // Background source loading
  /**
   * Starts looking for sources for what this page would play.
   *
   * Fire-and-forget: nothing waits on the reply. Results go into the source
   * cache, so pressing Play afterwards is answered from it — and pressing Play
   * *during* it joins the same run rather than starting a second scrape.
   * Progress arrives through `onSourcePrefetch`.
   */
  prefetchSources: (request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  }) => Promise<Envelope>;
  /** Abandons the pending prefetch; safe to call when there is none. */
  cancelSourcePrefetch: () => Promise<Envelope>;
  onSourcePrefetch: (callback: (state: PrefetchState) => void) => () => void;
  getSourcePrefetchSetting: () => Promise<Envelope & { enabled: boolean }>;
  setSourcePrefetchSetting: (enabled: boolean) => Promise<Envelope & { enabled: boolean }>;

  // Discovery — the dynamic home screen
  /**
   * Home-screen sections, already ordered.
   *
   * Answers from cache immediately and refreshes behind that answer, so the
   * page draws at once and quietly improves. Sections with nothing in them are
   * omitted rather than rendered empty.
   */
  getDiscoverySections: (options?: { includeAnime?: boolean }) => Promise<
    Envelope & { sections: DiscoverySection[]; personalGenres: string[] }
  >;
  /** Pages one row further. */
  getMoreDiscovery: (
    section: string,
    skip: number
  ) => Promise<Envelope & { items: SearchResponse[] }>;
  refreshDiscovery: () => Promise<Envelope>;
  /**
   * The catalogue behind the home screen changed; whatever is on screen is now
   * someone else's rows.
   *
   * The main process has always emitted this after a provider switch, and
   * nothing listened for it — so picking a different catalogue in Settings saved
   * the setting, succeeded, and left the previous provider's rows on the home
   * screen until each one aged out six hours later. The user's reasonable
   * conclusion was that the setting did not work.
   */
  onDiscoveryInvalidated: (callback: () => void) => () => void;
  /**
   * Replaces provider release names with catalogue titles and artwork.
   *
   * The source is untouched — only what the user reads changes. A row that
   * cannot be matched confidently keeps its original name rather than being
   * given a plausible wrong one.
   */
  enrichResults: (
    results: SearchResponse[],
    limit?: number
  ) => Promise<Envelope & { results: SearchResponse[] }>;
  resolveTitle: (
    rawTitle: string,
    hint?: { year?: number }
  ) => Promise<Envelope & { metadata: EnrichedMetadata | null }>;

  /** repository ▸ extension ▸ provider, for a provider name. */
  getProviderProvenance: (providerName: string) => Promise<
    Envelope & {
      provenance: {
        provider: string;
        repositoryId?: string;
        repositoryName?: string;
        extensionInternalName?: string;
        extensionName?: string;
      };
    }
  >;

  /**
   * The extension issue ledger — what is actually broken, counted.
   *
   * Separate from `queryLog` and `getDiagnostics` in the question it answers,
   * not in where it is stored. The log is ordered and per-session; the
   * diagnostics describe one failure well enough to hand to a maintainer; this
   * is the only one of the three that answers "how many distinct problems are
   * there, and which of them matter".
   */
  listIssues: (query?: {
    limit?: number;
    cause?: string;
    source?: string;
    includeMuted?: boolean;
    thisSessionOnly?: boolean;
  }) => Promise<
    Envelope & {
      issues: ExtensionIssue[];
      summary: IssueSummary[];
      sources: Array<{ source: string; issues: number; occurrences: number }>;
    }
  >;
  /** Triage. A muted row keeps counting, so a regression is still visible. */
  annotateIssue: (
    id: string,
    changes: { muted?: boolean; note?: string }
  ) => Promise<Envelope>;
  /** A pasteable report, tally first. */
  reportIssues: () => Promise<Envelope & { report: string }>;
  clearIssues: () => Promise<Envelope & { removed: number }>;

  // The structured log. Deliberately a thin surface — the log's job is to be on
  // disk when something goes wrong, not to be browsed.
  queryLog: (filter?: {
    level?: LogLevel;
    scopes?: string[];
    event?: string;
    search?: string;
    since?: number;
    limit?: number;
  }) => Promise<
    Envelope & {
      records: Array<Record<string, unknown>>;
      session: string;
      level: LogLevel;
      file: string;
    }
  >;
  listLogSessions: () => Promise<
    Envelope & {
      sessions: Array<{ file: string; bytes: number; modified: number; current: boolean }>;
      directory: string;
    }
  >;
  setLogLevel: (level: LogLevel) => Promise<Envelope & { level: LogLevel }>;
  revealLogFile: () => Promise<Envelope>;
  exportLogSession: () => Promise<Envelope & { text: string; file: string }>;
  /**
   * The same mapping for many providers at once.
   *
   * A source list routinely holds thirty rows drawn from a dozen providers, and
   * every row wants its origin chain. Asking one at a time is thirty IPC round
   * trips to read from one in-memory Map, so the whole list is answered in one.
   */
  getProviderProvenanceMap: (providerNames: string[]) => Promise<
    Envelope & {
      provenance: Record<
        string,
        { provider: string; repositoryName?: string; extensionName?: string }
      >;
    }
  >;

  // Saved detail pages
  /**
   * Saved pages, newest first, with the facets to filter them by.
   *
   * The facets come from what has been saved rather than from the installed
   * catalogue: "only search this provider next time" needs a list of the
   * providers the user actually keeps things from.
   */
  listBookmarks: () => Promise<
    Envelope & {
      bookmarks: Bookmark[];
      facets: { providers: string[]; repositories: Array<{ id: string; name: string }>; types: string[] };
    }
  >;
  getBookmark: (mediaUrl: string) => Promise<Envelope & { bookmark: Bookmark | null }>;
  /** Save and unsave in one call, so the button and the store cannot disagree. */
  toggleBookmark: (
    input: Omit<Bookmark, 'id' | 'savedAt' | 'openCount'>
  ) => Promise<Envelope & { saved: boolean; bookmark: Bookmark | null }>;
  removeBookmark: (mediaUrl: string) => Promise<Envelope & { removed: boolean }>;
  setBookmarkNote: (
    mediaUrl: string,
    note?: string
  ) => Promise<Envelope & { bookmark: Bookmark | null }>;
  markBookmarkOpened: (mediaUrl: string) => Promise<Envelope>;

  // Provider analytics and ranking
  /**
   * Measured behaviour and the score derived from it, together.
   *
   * They travel as one reply because the UI never wants one without the other:
   * a score with no counters behind it cannot be argued with, and counters with
   * no score are a spreadsheet.
   */
  getProviderLeaderboard: () => Promise<
    Envelope & {
      scores: ProviderScore[];
      records: ProviderAnalyticsRecord[];
      settings?: AnalyticsSettings;
      criteria: RankingCriterionInfo[];
    }
  >;
  getProviderRecommendations: (
    limit?: number
  ) => Promise<Envelope & { recommendations: ProviderRecommendation[] }>;
  getAnalyticsSettings: () => Promise<
    Envelope & { settings: AnalyticsSettings; criteria: RankingCriterionInfo[] }
  >;
  setAnalyticsSettings: (
    next: Partial<AnalyticsSettings>
  ) => Promise<Envelope & { settings: AnalyticsSettings }>;
  setRankingWeight: (
    id: string,
    weight: number
  ) => Promise<Envelope & { criteria: RankingCriterionInfo[] }>;
  resetRankingWeights: () => Promise<Envelope & { criteria: RankingCriterionInfo[] }>;
  /** Pins or blocks a provider by hand; `null` returns it to being measured. */
  setProviderPreference: (
    provider: string,
    preference: ProviderPreference | null
  ) => Promise<Envelope & { score: ProviderScore }>;
  /** Erases measured history. Omit `provider` to erase everything. */
  resetProviderAnalytics: (provider?: string) => Promise<Envelope>;
  applyProviderAutoEnable: () => Promise<Envelope & { enabled: string[] }>;
  /**
   * Records an outcome only the renderer can observe.
   *
   * Playback is why this exists: whether a source produced pictures is known to
   * the `<video>` element and to nothing in the main process.
   */
  recordProviderOutcome: (input: {
    provider: string;
    stage: 'search' | 'detail' | 'links' | 'playback' | 'download';
    outcome: 'success' | 'empty' | 'failure';
    produced?: number;
    latencyMs?: number;
    error?: string;
  }) => Promise<Envelope>;

  // Extensions
  getOfficialRepositories: () => Promise<OfficialRepository[]>;
  fetchRepository: (
    repoUrl: string
  ) => Promise<Envelope & { repository: RepositoryFetchResult | null }>;
  analyzePlugin: (plugin: SitePlugin) => Promise<PluginCompatibilityReport>;
  installPlugin: (
    plugin: SitePlugin,
    repoUrl?: string
  ) => Promise<{ ok: boolean; message: string; report?: PluginCompatibilityReport }>;
  uninstallPlugin: (internalName: string) => Promise<boolean>;
  getInstalledRepositories: () => Promise<string[]>;
  /**
   * Adds a repository without installing from it.
   *
   * The address is verified before it is kept — an unreachable one would become
   * a permanent row that fails every time it is opened, and that failure reads
   * as the extensions being broken rather than the address.
   */
  // --- OTT platform destinations -------------------------------------------

  /**
   * Every OTT platform the app knows, with what is installed behind it.
   *
   * Always the full list, including platforms nothing can serve. A sidebar that
   * silently omitted Sony LIV would leave a user who came looking for it to
   * conclude the app cannot do that, when the truth is one repository install
   * away and `availability` says so.
   */
  listOttPlatforms: () => Promise<{
    ok: boolean;
    error?: string;
    platforms: OttPlatformView[];
  }>;
  /** What this platform offers to browse, before any row is fetched. */
  getOttCatalog: (
    platformId: string
  ) => Promise<{ ok: boolean; error?: string; catalog: ProviderCatalog | null }>;
  /**
   * One page of one catalogue row.
   *
   * `section` travels back exactly as it arrived: `data` is the provider's own
   * opaque handle for the row and is not a URL. Rebuilding it here — or
   * "cleaning" it — is how a browse request stops matching the row it names.
   */
  getOttCatalogPage: (
    provider: string,
    section: { name: string; data: string; horizontalImages?: boolean },
    page: number
  ) => Promise<{ ok: boolean; error?: string; page: ProviderCatalogPage | null }>;
  /**
   * The providers a search from this platform's page should be scoped to.
   *
   * Pass the result as `SearchOptions.providers`. It is fetched rather than
   * derived in the renderer so the page's "searching Netflix, Prime Video"
   * caption cannot disagree with what the main process actually asks.
   */
  getOttSearchScope: (
    platformId: string
  ) => Promise<{ ok: boolean; error?: string; providers: string[] }>;
  /** Repositories to offer when nothing installed serves this platform. */
  getOttSuggestions: (platformId: string) => Promise<{
    ok: boolean;
    error?: string;
    suggestions: Array<{
      id: string;
      name: string;
      description: string;
      url: string;
      rawRepoUrl: string;
      installed: boolean;
    }>;
  }>;
  /**
   * Installs one of this platform's suggested repositories.
   *
   * By id, never by URL. This channel is reachable from the renderer, and
   * accepting an address here would turn "set up Netflix" into a way to make
   * the app install code from anywhere; adding a repository by hand stays a
   * separate, deliberate action on the extensions screen.
   */
  installOttSuggestion: (
    platformId: string,
    repositoryId: string
  ) => Promise<{ ok: boolean; message: string; installed: number; failed: number }>;

  addRepository: (
    url: string
  ) => Promise<{ ok: boolean; message: string; name?: string; plugins?: number }>;
  /**
   * Installs a repository's extensions in one action.
   *
   * `limit` defaults to unlimited, unlike the first-run bootstrap's cap of 12:
   * that cap protects a user who has not seen the app work yet, and this is a
   * user who has explicitly asked for this repository. Adult extensions are
   * skipped unless the setting is on, and the setting is read in the main
   * process — never passed from here.
   */
  installRepository: (
    url: string,
    options?: { limit?: number }
  ) => Promise<{
    ok: boolean;
    message: string;
    installed: number;
    failed: number;
    skipped: number;
  }>;
  /**
   * Uninstalls the repository *and* the extensions it installed, reporting
   * both. To silence one reversibly, use `setRepositoryEnabled`.
   */
  removeRepository: (
    repoUrl: string
  ) => Promise<{ repositories: string[]; removedExtensions: string[] }>;
  getInstalledPlugins: () => Promise<SitePlugin[]>;
  /**
   * What the runtime made of one archive: its compatibility tier, and — when it
   * is `T4_BLOCKED` — the reason verbatim.
   *
   * This is the only place the app can answer "the extension is installed and
   * registered nothing, why?", and it was registered in the main process with no
   * way for the renderer to call it. Without it an extension that failed to link
   * is indistinguishable from one that simply has no providers.
   */
  getExtensionRuntimeReport: (internalName: string) => Promise<PluginRuntimeReport | null>;
  onExtensionInstallProgress: (
    callback: (progress: {
      internalName: string;
      name: string;
      step: 'downloading' | 'verifying' | 'analyzing' | 'complete' | 'error';
      downloadedBytes?: number;
      totalBytes?: number;
      percent: number;
      message?: string;
    }) => void
  ) => () => void;

  // Extension updates (over-the-air; independent of app updates)
  checkExtensionUpdates: () => Promise<Envelope & { result: UpdateCheckResult | null }>;
  getCachedExtensionUpdates: () => Promise<AvailableUpdate[]>;
  updateExtension: (internalName: string) => Promise<UpdateOutcome>;
  updateAllExtensions: (internalNames?: string[]) => Promise<UpdateOutcome[]>;
  getUpdateSettings: () => Promise<UpdateSettings>;
  saveUpdateSettings: (patch: Partial<UpdateSettings>) => Promise<UpdateSettings>;
  /** Subscribes to update lifecycle events; returns an unsubscribe function. */
  onExtensionUpdateEvent: (
    callback: (event: string, payload: unknown) => void
  ) => () => void;

  // Library, watch progress and source memory
  getLibraryEntries: (status?: WatchStatus) => Promise<LibraryEntry[]>;
  upsertLibraryEntry: (input: {
    title: string;
    year?: number;
    type?: string;
    posterUrl?: string;
    mediaUrl: string;
    status?: WatchStatus;
    sources?: StoredSource[];
  }) => Promise<LibraryEntry>;
  setLibraryStatus: (key: string, status: WatchStatus) => Promise<LibraryEntry | null>;
  setLibraryUserRating: (key: string, rating?: number) => Promise<LibraryEntry | null>;
  removeLibraryEntry: (key: string) => Promise<boolean>;
  getLibraryEntryForUrl: (mediaUrl: string) => Promise<LibraryEntry | null>;
  recordWatchProgress: (input: {
    title: string;
    year?: number;
    mediaUrl: string;
    posterUrl?: string;
    episodeTitle?: string;
    season?: number;
    episode?: number;
    positionSeconds: number;
    durationSeconds: number;
    type?: string;
  }) => Promise<WatchProgress | null>;
  getProgressForKey: (key: string) => Promise<WatchProgress[]>;
  getContinueWatching: (limit?: number) => Promise<WatchProgress[]>;
  // The home screen's catalogue source. Only a provider that is actually
  // answering can be selected — see `home:selectProvider`.
  listHomeProviders: (force?: boolean) => Promise<
    Envelope & {
      providers: Array<{
        id: string;
        name: string;
        description: string;
        requiresKey: boolean;
        catalogs: string[];
        genres: number;
        selectable: boolean;
        active: boolean;
        health: {
          status: 'healthy' | 'degraded' | 'unavailable' | 'unchecked';
          latencyMs?: number;
          items?: number;
          withArtwork?: number;
          reason?: string;
          needsKey?: boolean;
          checkedAt: number;
        } | null;
      }>;
      selected: string;
      tmdbKeySet: boolean;
      customUrl: string;
    }
  >;
  selectHomeProvider: (id: string) => Promise<Envelope & { id: string }>;
  setTmdbKey: (key: string) => Promise<Envelope & { health: unknown }>;
  setCustomCatalogUrl: (url: string) => Promise<Envelope & { health: unknown }>;

  /** Takes one title off the row. The watch position is kept. */
  dismissContinueWatching: (key: string) => Promise<Envelope & { removed: boolean }>;
  /** Empties the row. Nothing is deleted; positions survive. */
  clearContinueWatching: () => Promise<Envelope & { cleared: number }>;
  getContinueWatchingEnabled: () => Promise<Envelope & { enabled: boolean }>;
  setContinueWatchingEnabled: (enabled: boolean) => Promise<Envelope & { enabled: boolean }>;
  clearWatchProgress: (key: string, season?: number, episode?: number) => Promise<boolean>;

  // --- the source that actually played ---
  /**
   * Saves the exact stream that delivered playback, with the query to rebuild it.
   *
   * Distinct from `rememberSource`, which records what the viewer *picked*. A
   * release that is chosen and then fails to start is not one that works, and
   * saving it as one sends them straight back to a stream that already failed.
   */
  recordPlayedSource: (input: {
    title: string;
    year?: number;
    mediaUrl: string;
    episodeTitle?: string;
    season?: number;
    episode?: number;
    source: TorrentResult;
    positionSeconds?: number;
    durationSeconds?: number;
  }) => Promise<Envelope & { record: PlayedSource | null }>;
  getPlayedSource: (
    key: string,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { record: PlayedSource | null }>;
  listPlayedSources: (limit?: number) => Promise<Envelope & { records: PlayedSource[] }>;
  getPlayedSourcesForKey: (key: string) => Promise<Envelope & { records: PlayedSource[] }>;
  forgetPlayedSource: (
    key: string,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { removed: boolean }>;
  /**
   * Hands back a playable source for a saved record, refreshing a dead link.
   *
   * `resolution` says which happened — `reused` (the stored link still holds),
   * `refreshed` (the same release re-resolved), or `unavailable` (the provider
   * no longer offers it, and `sources` carries the alternatives).
   */
  resolvePlayedSource: (
    key: string,
    season?: number,
    episode?: number
  ) => Promise<
    Envelope & {
      resolution: 'reused' | 'refreshed' | 'unavailable' | null;
      record?: PlayedSource;
      source?: TorrentResult;
      sources: TorrentResult[];
    }
  >;

  rememberSource: (input: Omit<SourceMemory, 'chosenAt'>) => Promise<void>;
  recallSource: (key: string, season?: number, episode?: number) => Promise<SourceMemory | null>;
  exportLibrary: () => Promise<{
    entries: LibraryEntry[];
    progress: WatchProgress[];
    sources: SourceMemory[];
  }>;
  importLibrary: (payload: {
    entries?: LibraryEntry[];
    progress?: WatchProgress[];
    sources?: SourceMemory[];
  }) => Promise<{ entries: number; progress: number; sources: number }>;

  setLibrarySources: (key: string, sources: StoredSource[]) => Promise<StoredSource[]>;
  getLibrarySources: (key: string) => Promise<StoredSource[]>;
  refreshLibrarySources: (
    mediaUrl: string,
    title: string,
    year?: number,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { sources: TorrentResult[]; storedSources: StoredSource[] }>;

  // Media History
  recordHistoryEvent: (
    event: Omit<HistoryEvent, 'id' | 'timestamp' | 'mediaKey'> & {
      id?: string;
      timestamp?: number;
      mediaKey?: string;
    }
  ) => Promise<HistoryEvent>;
  updateHistoryEvent: (id: string, updates: Partial<HistoryEvent>) => Promise<HistoryEvent | null>;
  listHistory: (filter?: HistoryFilter) => Promise<HistoryListResponse>;
  getHistory: (id: string) => Promise<HistoryEvent | null>;
  deleteHistoryItem: (id: string) => Promise<boolean>;
  deleteHistoryItems: (ids: string[]) => Promise<number>;
  clearHistory: () => Promise<Envelope>;
  getHistoryStats: () => Promise<HistoryStats>;
  exportHistory: () => Promise<HistoryEvent[]>;

  // Datastore
  getSetting: (key: string, defaultValue?: unknown) => Promise<string>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getObject: <T>(key: string, defaultValue?: T) => Promise<T>;
  setObject: <T>(key: string, value: T) => Promise<void>;
  importBackup: (filePath: string) => Promise<boolean>;
  exportBackup: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
  reloadApp: () => Promise<void>;
  relaunchApp: () => Promise<void>;

  /**
   * A whole-installation backup, and the way back from one.
   *
   * Distinct from `exportDatastoreBackup`, which writes the *Android* format so
   * a backup can move between the phone app and this one. This carries every
   * store — library, history, saved pages, searches, settings, repositories,
   * which extensions are off, indexer configuration — so a new machine can be
   * made into this one.
   *
   * `inspectBackup` reads a file and describes it without changing anything, so
   * a restore can be confirmed against what is actually in the file rather than
   * against its filename.
   */
  exportUserData: () => Promise<
    Envelope & { path?: string; bytes?: number; cancelled?: boolean }
  >;
  inspectBackup: () => Promise<
    Envelope & {
      cancelled?: boolean;
      path?: string;
      envelope?: {
        formatVersion: number;
        createdAt: number;
        app: { version: string; platform: string };
        summary: Record<string, number>;
      };
    }
  >;
  restoreUserData: (
    filePath: string,
    only?: string[]
  ) => Promise<
    Envelope & { sections?: Array<{ name: string; restored: number; note?: string }> }
  >;
  /** Puts the key/value store back as it was immediately before a restore. */
  undoRestore: () => Promise<Envelope>;
  /**
   * Commands from the application menu.
   *
   * The menu is the only place these are discoverable — a keyboard shortcut with
   * nothing naming it is a feature only its author knows about, which is what
   * the provider inspector was for as long as F12 was being swallowed before the
   * renderer ever saw it.
   */
  onToggleInspector: (callback: () => void) => () => void;
  onShowLicences: (callback: () => void) => () => void;
  /** A file the user picked from File → Open, to be prepared and played. */
  onOpenLocalFile: (callback: (filePath: string) => void) => () => void;
}

export type { TorrentFileEntry };

/**
 * Subscribes to a pushed channel and hands back a disposer.
 *
 * Fourteen `on*` methods each wrote this out: name a listener so it can be
 * removed, register it, close over it in a teardown function. The teardown is
 * the part that matters and the part that is easy to leave out — an earlier
 * version of this file registered listeners that accumulated on every React
 * remount, which shows up as a snapshot handler firing five times for one
 * update rather than as an error.
 *
 * The `IpcRendererEvent` is dropped on the way through: no subscriber in the
 * app uses it, and every one of them had to write `_: unknown` to get past it.
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: CloudStreamElectronAPI = {
  searchAll: (query, options) => ipcRenderer.invoke('api:searchAll', query, options),
  startSearch: (query, options) => ipcRenderer.invoke('search:start', query, options),
  cancelSearch: (id) => ipcRenderer.invoke('search:cancel', id),
  onSearchUpdate: (callback) => subscribe('search:update', callback),
  browse: (query, provider) => ipcRenderer.invoke('api:browse', query, provider),
  getTitleOutcomes: () => ipcRenderer.invoke('api:getTitleOutcomes'),
  getDiagnostics: (limit, levels) => ipcRenderer.invoke('diagnostics:list', limit, levels),
  clearDiagnostics: () => ipcRenderer.invoke('diagnostics:clear'),
  reportDiagnostics: (options) => ipcRenderer.invoke('diagnostics:report', options ?? {}),
  recordDiagnostic: (entry) => ipcRenderer.invoke('diagnostics:record', entry),
  recordTitleOutcome: (url, kind, reason) =>
    ipcRenderer.invoke('api:recordTitleOutcome', url, kind, reason),
  loadMedia: (url) => ipcRenderer.invoke('api:loadMedia', url),
  onDetailUpdate: (callback) => subscribe('detail:update', callback),
  getSources: (request) => ipcRenderer.invoke('api:getSources', request),
  getPluginRuntimeStatus: () => ipcRenderer.invoke('api:getPluginRuntimeStatus'),

  suggestTitles: (query) => ipcRenderer.invoke('api:suggest', query),
  searchSubtitles: (imdbId, season, episode, mediaUrl) =>
    ipcRenderer.invoke('subtitles:search', imdbId, season, episode, mediaUrl),
  searchSubtitlesByTitle: (query, season, episode, mediaUrl) =>
    ipcRenderer.invoke('subtitles:searchByTitle', query, season, episode, mediaUrl),
  fetchSubtitle: (url) => ipcRenderer.invoke('subtitles:fetch', url),

  getSearchHistory: () => ipcRenderer.invoke('api:getSearchHistory'),
  removeSearchHistory: (query) => ipcRenderer.invoke('api:removeSearchHistory', query),
  clearSearchHistory: () => ipcRenderer.invoke('api:clearSearchHistory'),

  startStream: (source, season, episode) =>
    ipcRenderer.invoke('torrent:startStream', source, season, episode),
  startBestStream: (sources, season, episode) =>
    ipcRenderer.invoke('torrent:startBestStream', sources, season, episode),
  autoPlay: (request) => ipcRenderer.invoke('torrent:autoPlay', request),
  startPlayback: (request, title, episodeTitle) =>
    ipcRenderer.invoke('playback:start', request, title, episodeTitle),
  playbackPlayNow: (sessionId) => ipcRenderer.invoke('playback:playNow', sessionId),
  skipPlaybackSource: (sessionId, reason) =>
    ipcRenderer.invoke('playback:skipSource', sessionId, reason),
  playbackSelectSource: (sessionId, infoHash) =>
    ipcRenderer.invoke('playback:selectSource', sessionId, infoHash),
  playbackRefreshSources: (sessionId, widen) =>
    ipcRenderer.invoke('playback:refreshSources', sessionId, widen ?? false),
  startSourceDiscovery: (request, title, episodeTitle, options) =>
    ipcRenderer.invoke('playback:startDiscovery', request, title, episodeTitle, options),
  playbackCancelSourceSearch: (sessionId) =>
    ipcRenderer.invoke('playback:cancelSourceSearch', sessionId),
  stopPlayback: (sessionId, keepFiles) =>
    ipcRenderer.invoke('playback:stop', sessionId, keepFiles),
  recordBufferHeartbeat: (sessionId, bufferedSeconds, currentBitrate) =>
    ipcRenderer.invoke('playback:recordBufferHeartbeat', sessionId, bufferedSeconds, currentBitrate),
  recordBufferStall: (sessionId) =>
    ipcRenderer.invoke('playback:recordBufferStall', sessionId),
  onPlaybackUpdate: (callback) => subscribe('playback:update', callback),

  getSearchConcurrency: () => ipcRenderer.invoke('search:getConcurrency'),
  setSearchConcurrency: (value) => ipcRenderer.invoke('search:setConcurrency', value),

  getBootstrapProgress: () => ipcRenderer.invoke('extension:getBootstrapProgress'),
  onBootstrapProgress: (callback) => subscribe('extension:bootstrapProgress', callback),
  getAdultAllowed: () => ipcRenderer.invoke('extension:getAdultAllowed'),
  setAdultAllowed: (enabled) => ipcRenderer.invoke('extension:setAdultAllowed', enabled),

  getExtensionProviders: () => ipcRenderer.invoke('extension:getProviders'),
  setProviderEnabled: (name, enabled) =>
    ipcRenderer.invoke('extension:setProviderEnabled', name, enabled),
  setProvidersEnabled: (names: string[], enabled: boolean) =>
    ipcRenderer.invoke('extension:setProvidersEnabled', names, enabled),
  getProviderTree: () => ipcRenderer.invoke('extension:getProviderTree'),
  setRepositoryEnabled: (repositoryId, enabled) =>
    ipcRenderer.invoke('extension:setRepositoryEnabled', repositoryId, enabled),
  setRepositoriesEnabled: (repositoryIds, enabled) =>
    ipcRenderer.invoke('extension:setRepositoriesEnabled', repositoryIds, enabled),
  setExtensionEnabled: (internalName, enabled) =>
    ipcRenderer.invoke('extension:setExtensionEnabled', internalName, enabled),
  setExtensionsEnabled: (internalNames, enabled) =>
    ipcRenderer.invoke('extension:setExtensionsEnabled', internalNames, enabled),
  getNetworkSettings: () => ipcRenderer.invoke('network:get'),
  setNetworkSettings: (settings) => ipcRenderer.invoke('network:set', settings),
  resetNetworkSettings: () => ipcRenderer.invoke('network:reset'),
  testNetwork: () => ipcRenderer.invoke('network:test'),
  getSearchScopeOptions: (ensureLoaded = true) =>
    ipcRenderer.invoke('search:getScopeOptions', ensureLoaded),
  setSearchScope: (scope) => ipcRenderer.invoke('search:setScope', scope),
  onProviderLoadProgress: (callback) => subscribe('extension:providerLoadProgress', callback),

  inspectMediaSource: (request) => ipcRenderer.invoke('media:inspect', request),
  preparePlaybackStream: (request) => ipcRenderer.invoke('media:prepare', request),
  switchAudioTrack: (sessionId, audioIndex, positionSeconds) =>
    ipcRenderer.invoke('media:switchAudio', sessionId, audioIndex, positionSeconds),
  closePlaybackStream: (sessionId) => ipcRenderer.invoke('media:closeStream', sessionId),
  getPlaybackDiagnostics: (sessionId) =>
    ipcRenderer.invoke('media:getPlaybackDiagnostics', sessionId),
  getCodecProbes: () => ipcRenderer.invoke('media:getCodecProbes'),
  getProbeConfig: () => ipcRenderer.invoke('media:getProbeConfig'),
  setProbeConfig: (config) => ipcRenderer.invoke('media:setProbeConfig', config),
  setMediaCapabilities: (capabilities) =>
    ipcRenderer.invoke('media:setCapabilities', capabilities),
  listExternalPlayers: (refresh) => ipcRenderer.invoke('player:listExternal', refresh),
  openInExternalPlayer: (playerId, url) =>
    ipcRenderer.invoke('player:openExternal', playerId, url),
  rollbackExtension: (repositoryUrl, internalName) =>
    ipcRenderer.invoke('extension:rollback', repositoryUrl, internalName),
  hasPreviousExtensionVersion: (repositoryUrl, internalName) =>
    ipcRenderer.invoke('extension:hasPreviousVersion', repositoryUrl, internalName),
  openControlledExternal: (playerId, url) => ipcRenderer.invoke('external:open', playerId, url),
  getExternalCapability: (playerId) => ipcRenderer.invoke('external:capability', playerId),
  getExternalSnapshot: () => ipcRenderer.invoke('external:snapshot'),
  onExternalUpdate: (callback) => subscribe('external:update', callback),
  externalSetPaused: (paused) => ipcRenderer.invoke('external:setPaused', paused),
  externalSeek: (seconds) => ipcRenderer.invoke('external:seek', seconds),
  externalSetVolume: (percent) => ipcRenderer.invoke('external:setVolume', percent),
  externalSetMuted: (muted) => ipcRenderer.invoke('external:setMuted', muted),
  externalSetSpeed: (rate) => ipcRenderer.invoke('external:setSpeed', rate),
  externalSetFullscreen: () => ipcRenderer.invoke('external:setFullscreen'),
  externalStop: () => ipcRenderer.invoke('external:stop'),
  openExternalLink: (url) => ipcRenderer.invoke('shell:openExternal', url),

  getMpvStatus: () => ipcRenderer.invoke('mpv:status'),
  openInNativeEngine: (request) => ipcRenderer.invoke('mpv:open', request),
  mpvSetPaused: (paused) => ipcRenderer.invoke('mpv:setPaused', paused),
  mpvSeek: (seconds) => ipcRenderer.invoke('mpv:seek', seconds),
  mpvSetVolume: (volume) => ipcRenderer.invoke('mpv:setVolume', volume),
  mpvSetMuted: (muted) => ipcRenderer.invoke('mpv:setMuted', muted),
  mpvSetSpeed: (speed) => ipcRenderer.invoke('mpv:setSpeed', speed),
  mpvSetFullscreen: (fullscreen) => ipcRenderer.invoke('mpv:setFullscreen', fullscreen),
  mpvSetAudioTrack: (id) => ipcRenderer.invoke('mpv:setAudioTrack', id),
  mpvSetSubtitleTrack: (id) => ipcRenderer.invoke('mpv:setSubtitleTrack', id),
  mpvAddSubtitle: (url, title, language) =>
    ipcRenderer.invoke('mpv:addSubtitle', url, title, language),
  mpvSetSubtitleDelay: (seconds) => ipcRenderer.invoke('mpv:setSubtitleDelay', seconds),
  mpvSetSubtitleStyle: (properties) => ipcRenderer.invoke('mpv:setSubtitleStyle', properties),
  mpvStop: () => ipcRenderer.invoke('mpv:stop'),
  getMpvSnapshot: () => ipcRenderer.invoke('mpv:snapshot'),
  onMpvUpdate: (callback) => subscribe('mpv:update', callback),
  getNativeEnginePolicy: () => ipcRenderer.invoke('mpv:getPolicy'),
  setNativeEnginePolicy: (policy) => ipcRenderer.invoke('mpv:setPolicy', policy),
  setupMpv: () => ipcRenderer.invoke('binary:setupMpv'),

  getSourceCacheStats: () => ipcRenderer.invoke('sources:getCacheStats'),
  clearSourceCache: () => ipcRenderer.invoke('sources:clearCache'),

  getStreamStats: (infoHash) => ipcRenderer.invoke('torrent:getStats', infoHash),
  selectStreamFile: (infoHash, fileIndex) =>
    ipcRenderer.invoke('torrent:selectFile', infoHash, fileIndex),
  stopStream: (infoHash, keepFiles) =>
    ipcRenderer.invoke('torrent:stopStream', infoHash, keepFiles),
  getActiveStreams: () => ipcRenderer.invoke('torrent:getActiveStreams'),
  clearTorrentCache: () => ipcRenderer.invoke('torrent:clearCache'),
  getTorrentCachePath: () => ipcRenderer.invoke('torrent:getCachePath'),
  getSwarmReport: (infoHash) => ipcRenderer.invoke('torrent:getSwarmReport', infoHash),

  getIndexerConfigs: () => ipcRenderer.invoke('indexer:getConfigs'),
  saveIndexerConfig: (config) => ipcRenderer.invoke('indexer:saveConfig', config),
  removeIndexerConfig: (id) => ipcRenderer.invoke('indexer:removeConfig', id),
  testIndexer: (config) => ipcRenderer.invoke('indexer:test', config),
  getIndexerHealth: () => ipcRenderer.invoke('indexer:getHealth'),
  getSourcePreferences: () => ipcRenderer.invoke('sources:getPreferences'),
  saveSourcePreferences: (prefs) => ipcRenderer.invoke('sources:savePreferences', prefs),

  enqueueDownload: (task) => ipcRenderer.invoke('download:enqueue', task),
  requestDownload: (task) => ipcRenderer.invoke('download:request', task),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  removeDownload: (id, deleteFile) => ipcRenderer.invoke('download:remove', id, deleteFile),
  getPlayerPreferences: () => ipcRenderer.invoke('player:getPreferences'),
  setPlayerPreferences: (patch) => ipcRenderer.invoke('player:setPreferences', patch),
  setWindowAlwaysOnTop: (onTop) => ipcRenderer.invoke('window:setAlwaysOnTop', onTop),
  getWindowAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop'),
  setMpvOnTop: (onTop) => ipcRenderer.invoke('mpv:setOnTop', onTop),
  setMpvVideoEnabled: (enabled) => ipcRenderer.invoke('mpv:setVideoEnabled', enabled),
  getDeleteDownloadPreference: () => ipcRenderer.invoke('download:getDeletePreference'),
  setDeleteDownloadPreference: (preference) =>
    ipcRenderer.invoke('download:setDeletePreference', preference),
  getDownloadQueue: () => ipcRenderer.invoke('download:getQueue'),
  getPlayableDownloadUrl: (filePath) => ipcRenderer.invoke('download:getPlayableUrl', filePath),
  revealInFolder: (filePath) => ipcRenderer.invoke('download:revealInFolder', filePath),
  onDownloadProgress: (callback) => subscribe('download:progress', callback),

  startBatchDownload: (request) => ipcRenderer.invoke('download:startBatch', request),
  cancelBatchDownload: (batchId) => ipcRenderer.invoke('download:cancelBatch', batchId),
  getActiveBatches: () => ipcRenderer.invoke('download:getActiveBatches'),
  onBatchProgress: (callback) => subscribe('download:batchProgress', callback),

  // Unified Components & Binaries
  getComponentStatus: () => ipcRenderer.invoke('components:getStatus'),
  checkBinaries: () => ipcRenderer.invoke('binary:checkBinaries'),
  testAllBinaries: () => ipcRenderer.invoke('binary:testAll'),
  testBinary: (name) => ipcRenderer.invoke('binary:testOne', name),
  removeBinary: (name) => ipcRenderer.invoke('binary:remove', name),
  setupAria2: () => ipcRenderer.invoke('binary:setupAria2'),
  setupYtDlp: () => ipcRenderer.invoke('binary:setupYtDlp'),
  setupAllBinaries: () => ipcRenderer.invoke('binary:setupAll'),
  setupFfmpeg: () => ipcRenderer.invoke('binary:setupFfmpeg'),
  onBinarySetupProgress: (callback) => subscribe('binary:setupProgress', callback),

  // Plug-and-Play Runtime Provisioner
  getSystemRuntimeStatus: () => ipcRenderer.invoke('runtime:getStatus'),
  provisionSystemRuntime: () => ipcRenderer.invoke('runtime:provision'),
  repairSystemRuntime: () => ipcRenderer.invoke('runtime:repair'),
  testSystemRuntime: () => ipcRenderer.invoke('runtime:test'),
  cleanSystemRuntime: () => ipcRenderer.invoke('runtime:clean'),
  onSystemRuntimeProgress: (callback) => subscribe('runtime:progress', callback),

  prefetchSources: (request) => ipcRenderer.invoke('sources:prefetch', request),
  cancelSourcePrefetch: () => ipcRenderer.invoke('sources:cancelPrefetch'),
  onSourcePrefetch: (callback) => subscribe('sources:prefetch', callback),
  getSourcePrefetchSetting: () => ipcRenderer.invoke('sources:getPrefetchSetting'),
  setSourcePrefetchSetting: (enabled) =>
    ipcRenderer.invoke('sources:setPrefetchSetting', enabled),

  getDiscoverySections: (options) => ipcRenderer.invoke('discover:sections', options),
  getMoreDiscovery: (section, skip) => ipcRenderer.invoke('discover:more', section, skip),
  refreshDiscovery: () => ipcRenderer.invoke('discover:refresh'),
  onDiscoveryInvalidated: (callback) => subscribe('discover:invalidated', callback),
  enrichResults: (results, limit) => ipcRenderer.invoke('discover:enrich', results, limit),
  resolveTitle: (rawTitle, hint) => ipcRenderer.invoke('discover:resolveTitle', rawTitle, hint),

  getProviderProvenance: (providerName) =>
    ipcRenderer.invoke('api:getProviderProvenance', providerName),
  getProviderProvenanceMap: (providerNames) =>
    ipcRenderer.invoke('api:getProviderProvenanceMap', providerNames),

  listIssues: (query) => ipcRenderer.invoke('issues:list', query),
  annotateIssue: (id, changes) => ipcRenderer.invoke('issues:annotate', id, changes),
  reportIssues: () => ipcRenderer.invoke('issues:report'),
  clearIssues: () => ipcRenderer.invoke('issues:clear'),

  queryLog: (filter) => ipcRenderer.invoke('log:query', filter),
  listLogSessions: () => ipcRenderer.invoke('log:sessions'),
  setLogLevel: (level) => ipcRenderer.invoke('log:setLevel', level),
  revealLogFile: () => ipcRenderer.invoke('log:reveal'),
  exportLogSession: () => ipcRenderer.invoke('log:exportSession'),

  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  getBookmark: (mediaUrl) => ipcRenderer.invoke('bookmarks:get', mediaUrl),
  toggleBookmark: (input) => ipcRenderer.invoke('bookmarks:toggle', input),
  removeBookmark: (mediaUrl) => ipcRenderer.invoke('bookmarks:remove', mediaUrl),
  setBookmarkNote: (mediaUrl, note) => ipcRenderer.invoke('bookmarks:setNote', mediaUrl, note),
  markBookmarkOpened: (mediaUrl) => ipcRenderer.invoke('bookmarks:markOpened', mediaUrl),

  getProviderLeaderboard: () => ipcRenderer.invoke('analytics:getLeaderboard'),
  getProviderRecommendations: (limit) =>
    ipcRenderer.invoke('analytics:getRecommendations', limit),
  getAnalyticsSettings: () => ipcRenderer.invoke('analytics:getSettings'),
  setAnalyticsSettings: (next) => ipcRenderer.invoke('analytics:setSettings', next),
  setRankingWeight: (id, weight) => ipcRenderer.invoke('analytics:setWeight', id, weight),
  resetRankingWeights: () => ipcRenderer.invoke('analytics:resetWeights'),
  setProviderPreference: (provider, preference) =>
    ipcRenderer.invoke('analytics:setPreference', provider, preference),
  resetProviderAnalytics: (provider) => ipcRenderer.invoke('analytics:reset', provider),
  applyProviderAutoEnable: () => ipcRenderer.invoke('analytics:applyAutoEnable'),
  recordProviderOutcome: (input) => ipcRenderer.invoke('analytics:observe', input),

  getOfficialRepositories: () => ipcRenderer.invoke('extension:getOfficialRepositories'),
  fetchRepository: (repoUrl) => ipcRenderer.invoke('extension:fetchRepository', repoUrl),
  analyzePlugin: (plugin) => ipcRenderer.invoke('extension:analyzePlugin', plugin),
  installPlugin: (plugin, repoUrl) =>
    ipcRenderer.invoke('extension:installPlugin', plugin, repoUrl),
  uninstallPlugin: (internalName) =>
    ipcRenderer.invoke('extension:uninstallPlugin', internalName),
  getInstalledRepositories: () => ipcRenderer.invoke('extension:getInstalledRepositories'),
  listOttPlatforms: () => ipcRenderer.invoke('ott:listPlatforms'),
  getOttCatalog: (platformId) => ipcRenderer.invoke('ott:getCatalog', platformId),
  getOttCatalogPage: (provider, section, page) =>
    ipcRenderer.invoke('ott:getCatalogPage', provider, section, page),
  getOttSearchScope: (platformId) => ipcRenderer.invoke('ott:getSearchScope', platformId),
  getOttSuggestions: (platformId) => ipcRenderer.invoke('ott:getSuggestions', platformId),
  installOttSuggestion: (platformId, repositoryId) =>
    ipcRenderer.invoke('ott:installSuggestion', platformId, repositoryId),
  addRepository: (url) => ipcRenderer.invoke('extension:addRepository', url),
  installRepository: (url, options) => ipcRenderer.invoke('extension:installRepository', url, options),
  removeRepository: (repoUrl) => ipcRenderer.invoke('extension:removeRepository', repoUrl),
  getInstalledPlugins: () => ipcRenderer.invoke('extension:getInstalledPlugins'),
  getExtensionRuntimeReport: (internalName) =>
    ipcRenderer.invoke('extension:getRuntimeReport', internalName),
  onExtensionInstallProgress: (callback) => subscribe('extension:installProgress', callback),

  checkExtensionUpdates: () => ipcRenderer.invoke('extension:checkUpdates'),
  getCachedExtensionUpdates: () => ipcRenderer.invoke('extension:getCachedUpdates'),
  updateExtension: (internalName) => ipcRenderer.invoke('extension:update', internalName),
  updateAllExtensions: (internalNames) =>
    ipcRenderer.invoke('extension:updateAll', internalNames),
  getUpdateSettings: () => ipcRenderer.invoke('extension:getUpdateSettings'),
  saveUpdateSettings: (patch) => ipcRenderer.invoke('extension:saveUpdateSettings', patch),
  /**
   * The one subscription that does not go through `subscribe`: it carries a
   * discriminator alongside the payload rather than a single snapshot, and
   * widening the helper to a variadic signature to absorb one caller would cost
   * every other subscriber its argument type.
   */
  onExtensionUpdateEvent: (callback) => {
    const listener = (_: unknown, event: string, payload: unknown) => callback(event, payload);
    ipcRenderer.on('extension:updateEvent', listener);
    return () => ipcRenderer.removeListener('extension:updateEvent', listener);
  },

  getLibraryEntries: (status) => ipcRenderer.invoke('library:getEntries', status),
  upsertLibraryEntry: (input) => ipcRenderer.invoke('library:upsertEntry', input),
  setLibraryStatus: (key, status) => ipcRenderer.invoke('library:setStatus', key, status),
  setLibraryUserRating: (key, rating) => ipcRenderer.invoke('library:setUserRating', key, rating),
  removeLibraryEntry: (key) => ipcRenderer.invoke('library:removeEntry', key),
  getLibraryEntryForUrl: (mediaUrl) => ipcRenderer.invoke('library:getEntryForUrl', mediaUrl),
  recordWatchProgress: (input) => ipcRenderer.invoke('library:recordProgress', input),
  getProgressForKey: (key) => ipcRenderer.invoke('library:getProgressForKey', key),
  getContinueWatching: (limit) => ipcRenderer.invoke('library:getContinueWatching', limit),
  listHomeProviders: (force) => ipcRenderer.invoke('home:listProviders', force),
  selectHomeProvider: (id) => ipcRenderer.invoke('home:selectProvider', id),
  setTmdbKey: (key) => ipcRenderer.invoke('home:setTmdbKey', key),
  setCustomCatalogUrl: (url) => ipcRenderer.invoke('home:setCustomCatalogUrl', url),

  dismissContinueWatching: (key) => ipcRenderer.invoke('library:dismissContinueWatching', key),
  clearContinueWatching: () => ipcRenderer.invoke('library:clearContinueWatching'),
  getContinueWatchingEnabled: () => ipcRenderer.invoke('library:getContinueWatchingEnabled'),
  setContinueWatchingEnabled: (enabled) =>
    ipcRenderer.invoke('library:setContinueWatchingEnabled', enabled),
  clearWatchProgress: (key, season, episode) =>
    ipcRenderer.invoke('library:clearProgress', key, season, episode),
  recordPlayedSource: (input) => ipcRenderer.invoke('library:recordPlayedSource', input),
  getPlayedSource: (key, season, episode) =>
    ipcRenderer.invoke('library:getPlayedSource', key, season, episode),
  listPlayedSources: (limit) => ipcRenderer.invoke('library:listPlayedSources', limit),
  getPlayedSourcesForKey: (key) => ipcRenderer.invoke('library:getPlayedSourcesForKey', key),
  forgetPlayedSource: (key, season, episode) =>
    ipcRenderer.invoke('library:forgetPlayedSource', key, season, episode),
  resolvePlayedSource: (key, season, episode) =>
    ipcRenderer.invoke('library:resolvePlayedSource', key, season, episode),
  rememberSource: (input) => ipcRenderer.invoke('library:rememberSource', input),
  recallSource: (key, season, episode) =>
    ipcRenderer.invoke('library:recallSource', key, season, episode),
  exportLibrary: () => ipcRenderer.invoke('library:export'),
  importLibrary: (payload) => ipcRenderer.invoke('library:import', payload),
  setLibrarySources: (key, sources) => ipcRenderer.invoke('library:setSources', key, sources),
  getLibrarySources: (key) => ipcRenderer.invoke('library:getSources', key),
  refreshLibrarySources: (mediaUrl, title, year, season, episode) =>
    ipcRenderer.invoke('library:refreshSources', mediaUrl, title, year, season, episode),

  // Media History
  recordHistoryEvent: (event) => ipcRenderer.invoke('history:recordEvent', event),
  updateHistoryEvent: (id, updates) => ipcRenderer.invoke('history:updateEvent', id, updates),
  listHistory: (filter) => ipcRenderer.invoke('history:list', filter),
  getHistory: (id) => ipcRenderer.invoke('history:get', id),
  deleteHistoryItem: (id) => ipcRenderer.invoke('history:deleteItem', id),
  deleteHistoryItems: (ids) => ipcRenderer.invoke('history:deleteItems', ids),
  clearHistory: () => ipcRenderer.invoke('history:clearAll'),
  getHistoryStats: () => ipcRenderer.invoke('history:getStats'),
  exportHistory: () => ipcRenderer.invoke('history:exportAll'),

  getSetting: (key, defaultValue) => ipcRenderer.invoke('datastore:getSetting', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke('datastore:setSetting', key, value),
  getObject: (key, defaultValue) => ipcRenderer.invoke('datastore:getObject', key, defaultValue),
  setObject: (key, value) => ipcRenderer.invoke('datastore:setObject', key, value),
  importBackup: (filePath) => ipcRenderer.invoke('datastore:importBackup', filePath),
  exportBackup: () => ipcRenderer.invoke('datastore:exportBackup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  exportUserData: () => ipcRenderer.invoke('backup:export'),
  inspectBackup: () => ipcRenderer.invoke('backup:inspect'),
  restoreUserData: (filePath, only) => ipcRenderer.invoke('backup:restore', filePath, only),
  undoRestore: () => ipcRenderer.invoke('backup:undoRestore'),
  onToggleInspector: (callback) => subscribe('app:toggleInspector', callback),
  onShowLicences: (callback) => subscribe('app:showLicences', callback),
  onOpenLocalFile: (callback) => subscribe('app:openLocalFile', callback),
};

contextBridge.exposeInMainWorld('cloudstream', api);
