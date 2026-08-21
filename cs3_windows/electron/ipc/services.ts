import type { BrowserWindow } from 'electron';
import type { DatastoreManager } from '../datastore.ts';
import type { Aria2Engine } from '../aria2Engine.ts';
import type { DownloadService } from '../downloadService.ts';
import type { PluginManager } from '../pluginManager.ts';
import type { BinaryDownloader } from '../binaryDownloader.ts';
import type { TorrentEngine } from '../torrent/torrentEngine.ts';
import type { ContentService } from '../contentService.ts';
import type { ExtensionUpdater } from '../cs3/extensionUpdater.ts';
import type { BatchDownloader } from '../cs3/batchDownloader.ts';
import type { LibraryStore } from '../cs3/libraryStore.ts';
import type { HistoryStore } from '../cs3/historyStore.ts';
import type { BookmarkStore } from '../cs3/bookmarkStore.ts';
import type { HomeProviderRegistry } from '../cs3/homeProviderRegistry.ts';
import type { DiscoveryService } from '../cs3/discovery.ts';
import type { TitleEnricher } from '../cs3/titleEnricher.ts';
import type { SourcePrefetcher } from '../cs3/sourcePrefetcher.ts';
import type { BootstrapService } from '../cs3/bootstrap.ts';
import type { TitleOutcomeStore } from '../cs3/titleOutcomes.ts';
import type { Logger } from '../logging/logger.ts';
import type { DiagnosticsLog } from '../cs3/diagnostics.ts';
import type { ExternalPlayerService } from '../externalPlayer.ts';
import type { ProviderAnalytics } from '../cs3/providerAnalytics.ts';
import type { ProviderRanking } from '../cs3/providerRanking.ts';
import type { ProviderRecommender } from '../cs3/providerRecommendations.ts';
import type { PlaybackSessionManager } from '../playbackSession.ts';
import type { SearchSuggestionService } from '../searchSuggestions.ts';
import type { SearchHistoryStore } from '../searchHistory.ts';
import type { SubtitleService } from '../subtitleService.ts';
import type { MpvEngine } from '../media/mpvEngine.ts';
import type { PlaybackEngine } from '../media/playbackEngine.ts';
import type { NetworkSettingsStore } from '../networkSettings.ts';
import type { ResilientFetch } from '../networkResilience.ts';

/**
 * Everything the IPC handlers are allowed to reach.
 *
 * The handlers used to live in `main.ts` beside the singletons they call, so
 * "what does the download surface depend on?" had no answer short of reading
 * three thousand lines. Splitting them into per-domain modules needs the
 * dependencies named, and naming them turns out to be most of the value: this
 * interface is the app's service inventory, in one place, and a new handler that
 * needs something not on it has to say so.
 *
 * Deliberately a plain bag rather than a container with resolution or
 * lifecycles. Everything here is a singleton constructed once at startup in an
 * order that matters and is documented where it happens; a framework would hide
 * that order without removing the need for it.
 *
 * The last three entries are not services. They are capabilities the handlers
 * need and the composition root owns — the window, and two settings read per
 * call rather than captured.
 */
export interface Services {
  datastore: DatastoreManager;
  aria2: Aria2Engine;
  downloadService: DownloadService;
  pluginManager: PluginManager;
  binaryDownloader: BinaryDownloader;
  torrentEngine: TorrentEngine;
  contentService: ContentService;
  extensionUpdater: ExtensionUpdater;
  batchDownloader: BatchDownloader;
  libraryStore: LibraryStore;
  historyStore: HistoryStore;
  bookmarks: BookmarkStore;
  homeProviders: HomeProviderRegistry;
  discovery: DiscoveryService;
  titleEnricher: TitleEnricher;
  sourcePrefetcher: SourcePrefetcher;
  bootstrap: BootstrapService;
  titleOutcomes: TitleOutcomeStore;
  logger: Logger;
  diagnostics: DiagnosticsLog;
  externalPlayers: ExternalPlayerService;
  providerAnalytics: ProviderAnalytics;
  providerRanking: ProviderRanking;
  providerRecommender: ProviderRecommender;
  playbackSessions: PlaybackSessionManager;
  searchSuggestions: SearchSuggestionService;
  searchHistory: SearchHistoryStore;
  subtitles: SubtitleService;
  mpvEngine: MpvEngine;
  playbackEngine: PlaybackEngine;
  network: NetworkSettingsStore;
  resilientFetch: ResilientFetch;

  /**
   * The main window, resolved at call time.
   *
   * Never captured: it is created after the services are wired, it is replaced
   * on reload, and on macOS the app outlives it. A handler holding a reference
   * from startup would push snapshots at a destroyed window.
   */
  getWindow(): BrowserWindow | null;

  /**
   * Re-probes which options the current ffmpeg understands.
   *
   * Called after an ffmpeg install, because a different binary may have arrived
   * with a different option set — `-extension_picky` exists on 7.1 and not on
   * 7.0, and passing an option a binary does not know is fatal to the whole
   * command line rather than ignored.
   */
  refreshFfmpegOptionSupport(): void;
}

/** The signature every per-domain registrar in this folder implements. */
export type RegisterHandlers = (services: Services) => void;
