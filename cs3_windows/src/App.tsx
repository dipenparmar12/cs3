import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import type { PlayedSource } from './types/library';
import { Sidebar } from './components/Sidebar';
import type { ActiveTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import { MiniPlayerBar } from './components/player/MiniPlayerBar';
import { DownloadCenter } from './components/DownloadCenter';
import { ProviderInspector } from './components/ProviderInspector';
import { ExtensionsScreen } from './components/extensions/ExtensionsScreen';
import { BinarySetupModal } from './components/BinarySetupModal';
import { HomeView } from './views/HomeView';
import { SearchView, EMPTY_SEARCH_UI, type SearchUiState } from './views/SearchView';
import {
  DetailView,
  type PlaybackRequest,
  type PlaybackSessionRequest,
} from './views/DetailView';
import { LibraryView } from './views/LibraryView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';

import { ErrorBoundary } from './components/ErrorBoundary';
import { FirstRunBanner } from './components/FirstRunBanner';

import type { Episode, SearchOptions, SearchResponse } from './types/api';
import type { HistoryEvent } from './types/history';
import type { DownloadRequestResult, DownloadTask } from './types/download';
import { buildDownloadTask } from './utils/downloadIdentity';
import type { TorrentResult } from './types/torrent';
import type { PlaybackSnapshot } from '../electron/playbackSession';
import type { SearchSnapshot } from '../electron/searchSession';

/** One live playback session: its id, what asked for it, and its latest state. */
interface ActiveSession {
  id: string;
  context: PlaybackSessionRequest;
  snapshot: PlaybackSnapshot;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * The live search, or null before the first one.
   *
   * Results, per-source progress and the resolved scope all live in here and
   * arrive as snapshots, so the grid fills in while the slow providers are still
   * scraping instead of after they finish.
   */
  const [search, setSearch] = useState<SearchSnapshot | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** The last query and options, so a scope change can re-run them. */
  const lastQuery = useRef<{ query: string; options?: SearchOptions } | null>(null);
  /**
   * The search view's filters and open groups, kept here because the view is
   * unmounted while a title is open — the detail page replaces it inside the
   * same scroll container.
   */
  const [searchUi, setSearchUi] = useState<SearchUiState>(EMPTY_SEARCH_UI);
  /** The main scroller, so returning from a title lands where you left. */
  const viewportRef = useRef<HTMLElement | null>(null);
  const savedScroll = useRef(0);

  const [selectedMedia, setSelectedMedia] = useState<SearchResponse | null>(null);
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null);
  const [switchingTo, setSwitchingTo] = useState<Episode | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  /**
   * A failure that has no screen of its own yet.
   *
   * Opening a downloaded file can fail before any player exists — the file was
   * moved or deleted since it finished — and the alternative to saying so is a
   * button that does nothing when clicked.
   */
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  /**
   * The instant-play path: the player opens on this state before any stream
   * exists, and `snapshot` is what fills it in as discovery progresses.
   */
  const [session, setSession] = useState<ActiveSession | null>(null);

  /** Holds the player open between a quick-play click and the session existing. */
  const [preparing, setPreparing] = useState<{ title: string } | null>(null);

  /**
   * The player is out of the way but still playing.
   *
   * Distinct from having no player at all, which is what closing it produces.
   * Everything the session owns — the stream, its position, the source list,
   * whatever is downloading — survives, because none of it is state the overlay
   * holds. Only the overlay stops rendering.
   */
  const [playerHidden, setPlayerHidden] = useState(false);

  /**
   * Shrunk to a floating window rather than hidden.
   *
   * The two are different answers to the same situation and the app needs
   * both. `hidden` is for a viewer who wants the app back and does not need to
   * see the video; `mini` is for one who wants to keep watching *while* they
   * search, browse the library or check a download. Only the second is what
   * people mean by "minimise", and the app previously offered only the first —
   * a bar saying "still playing" over a player they could not see.
   */
  const [playerMini, setPlayerMini] = useState(false);
  const [missingComponents, setMissingComponents] = useState(0);

  const refreshMissingComponents = useCallback(async () => {
    try {
      const res = await window.cloudstream?.getComponentStatus?.();
      if (res && typeof res.missingCount === 'number') {
        setMissingComponents(res.missingCount);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshMissingComponents();
    const unsubRuntime = window.cloudstream?.onSystemRuntimeProgress?.(() => {
      void refreshMissingComponents();
    });
    const unsubBinary = window.cloudstream?.onBinarySetupProgress?.(() => {
      void refreshMissingComponents();
    });
    return () => {
      unsubRuntime?.();
      unsubBinary?.();
    };
  }, [refreshMissingComponents]);

  // `startSession` is handed down into the detail view and must not close over
  // `session`, or it would go stale between episode switches.
  const sessionRef = useRef<ActiveSession | null>(null);
  /** Mirrors `playback` so the refresh handler below is stable across renders. */
  const playbackRef = useRef<PlaybackRequest | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);
  /** Indexer names, for the F12 inspector. The search scope owns its own list. */
  const [providersList, setProvidersList] = useState<string[]>([]);

  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  /**
   * Whether the machine has a network at all.
   *
   * Offline, every provider fails on its own and the app filled with thirty
   * separate honest errors instead of one true sentence — and the home screen,
   * which can render entirely from cache, showed a spinner. `navigator.onLine`
   * is a weak signal (it reports the link, not reachability) and that is exactly
   * why it is used only to *add* a banner, never to stop the app trying.
   */
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const online = () => setIsOffline(false);
    const offline = () => setIsOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  const [isBinaryModalOpen, setIsBinaryModalOpen] = useState(false);
  const [hasBinaries, setHasBinaries] = useState(true);

  useEffect(() => {
    let disposeProgress: (() => void) | undefined;

    if (window.cloudstream) {
      window.cloudstream.getDownloadQueue().then(setDownloadQueue);
      // The listener now returns a disposer; previously listeners accumulated
      // on every remount and fired the setter N times per tick.
      disposeProgress = window.cloudstream.onDownloadProgress(setDownloadQueue);
      window.cloudstream.checkBinaries().then((status) => setHasBinaries(status.aria2));
      window.cloudstream
        .getIndexerConfigs()
        .then((configs) => setProvidersList(configs.filter((c) => c.enabled).map((c) => c.name)));
    }

    /**
     * Tells the main process what this build can actually decode.
     *
     * Chromium's HEVC support depends on the build and on platform decoders
     * being present, so a table of "unsupported codecs" compiled in the main
     * process is a guess about someone else's machine. `canPlayType` here is a
     * measurement of this one, and the transcoder believes it over its own
     * table — in both directions, so a build that *can* decode HEVC is not made
     * to re-encode it for nothing.
     */
    void (async () => {
      const probes = await window.cloudstream?.getCodecProbes?.();
      if (!probes) return;
      const element = document.createElement('video');
      const video: Record<string, boolean> = {};
      for (const [codec, type] of Object.entries(probes)) {
        video[codec] = element.canPlayType(type) !== '';
      }
      await window.cloudstream?.setMediaCapabilities?.({ video });
    })();

    // Subscribed once, filtered by session id: the player is driven entirely by
    // these snapshots from the moment it opens until the session ends.
    const disposePlayback = window.cloudstream?.onPlaybackUpdate((snapshot) => {
      setSession((current) =>
        current && current.id === snapshot.sessionId ? { ...current, snapshot } : current
      );
    });

    // Same shape for search. Snapshots from an abandoned search are dropped by
    // id: a cancelled provider can still answer after the user has moved on, and
    // its results belong to a query that is no longer on screen.
    const disposeSearch = window.cloudstream?.onSearchUpdate((snapshot) => {
      setSearch((current) => (current && current.id === snapshot.id ? snapshot : current));
    });

    /**
     * F12 opens the provider inspector.
     *
     * This listener existed and could never fire: the main process bound F12 to
     * Chromium's DevTools in `before-input-event` and called `preventDefault()`,
     * which suppresses the page keyboard event — so the inspector, which has no
     * other entry point, was unreachable. DevTools is `Ctrl+Shift+I` now, and
     * the same command is in the Help menu so it is discoverable at all.
     */
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setIsInspectorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const disposeInspector = window.cloudstream?.onToggleInspector?.(() =>
      setIsInspectorOpen((prev) => !prev)
    );

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      disposeProgress?.();
      disposePlayback?.();
      disposeSearch?.();
      disposeInspector?.();
    };
  }, []);

  /**
   * Play a file the user already has on disk.
   *
   * The engine could always do this — `MediaProxy` serves local files and the
   * inspect→decide→play path does not care where a stream came from — and there
   * was no way to ask for it. So the app could finish a download and then not
   * play it from disk, and a user's own 10-bit HEVC MKV, the exact file this
   * engine exists for, could not be opened at all.
   *
   * The loopback URL rather than the path is the important half: it goes through
   * `media:prepare` like every other source, so a local file gets the same
   * codec routing — including out to mpv — that a provider link does.
   */
  const handleOpenLocalFile = useCallback(async (filePath: string) => {
    const served = await window.cloudstream?.getPlayableDownloadUrl(filePath);
    if (!served?.ok || !served.url) {
      setActionNotice(served?.error ?? 'That file could not be opened.');
      return;
    }
    const name = filePath.split(/[\\/]/).pop() ?? 'Local file';
    setPlayerHidden(false);
    setPlayerMini(false);
    setPlayback({
      streamUrl: served.url,
      mimeType: 'video/mp4',
      title: name.replace(/\.[^.]+$/, ''),
      infoHash: `local:${filePath}`,
      subtitles: [],
    });
  }, []);

  useEffect(() => {
    return window.cloudstream?.onOpenLocalFile?.((filePath) => {
      void handleOpenLocalFile(filePath);
    });
  }, [handleOpenLocalFile]);

  /**
   * A file dropped on the window plays; it does not navigate.
   *
   * Electron's default for a top-level drop is to navigate to the file, which
   * replaced the whole app with the raw video and — with no menu at the time —
   * left no way back short of relaunching. The main process refuses the
   * navigation now; this turns the gesture into the thing the user meant.
   */
  useEffect(() => {
    const allow = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      // `webUtils.getPathForFile` is the supported route in newer Electron;
      // `file.path` remains populated in this build and is the simpler one.
      const filePath = (file as (File & { path?: string }) | undefined)?.path;
      if (filePath) void handleOpenLocalFile(filePath);
    };
    window.addEventListener('dragover', allow);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', allow);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleOpenLocalFile]);

  /**
   * Opens a search. Returns as soon as it has started, not when it has finished.
   *
   * The awaited call only carries the opening snapshot — which sources are being
   * asked and under what scope. Everything after that arrives through
   * `onSearchUpdate`, which is what puts the first provider's results on screen
   * seconds before the slowest one has answered.
   */
  const handleSearch = useCallback(async (query: string, options?: SearchOptions) => {
    lastQuery.current = { query, options };
    setSearchQuery(query);
    setSelectedMedia(null); // Instantly dismiss open DetailView overlay
    setSearch(null); // Instantly clear old search results
    // A new query is a new question, so the previous answer's filters and
    // disclosure state say nothing about it.
    setSearchUi(EMPTY_SEARCH_UI);
    savedScroll.current = 0;
    setActiveTab('search');
    setSearchError(null);

    if (!window.cloudstream) return;
    try {
      const response = await window.cloudstream.startSearch(query, options);
      if (response.snapshot) setSearch(response.snapshot);
      if (!response.ok && response.error) setSearchError(response.error);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /**
   * Abandons the running search, keeping whatever it has already found.
   *
   * The point of a cancel here is not to undo anything — it is to stop paying
   * for answers the viewer no longer needs once they have spotted the row they
   * came for.
   */
  const handleCancelSearch = useCallback(async () => {
    const id = search?.id;
    if (!id) return;
    const response = await window.cloudstream?.cancelSearch(id);
    if (response?.snapshot) setSearch(response.snapshot);
  }, [search?.id]);

  /** Re-runs the current query under a scope the user just changed. */
  const handleScopeChange = useCallback(() => {
    const previous = lastQuery.current;
    if (previous?.query) void handleSearch(previous.query, previous.options);
  }, [handleSearch]);

  /**
   * Re-run the last query with no scope at all.
   *
   * The empty-results screen is the one place this is genuinely the next step:
   * the sentence on it has just said the selected providers had nothing, and
   * "search everywhere" was reachable only by finding the scope picker in the
   * toolbar and clearing it by hand.
   */
  const handleSearchAllSources = useCallback(() => {
    const previous = lastQuery.current;
    if (!previous?.query) return;
    void handleSearch(previous.query, { ...previous.options, providers: [], indexers: [] });
  }, [handleSearch]);

  /**
   * Plays the exact source the library saved as working.
   *
   * The panel has already done the hard half — reused the stored link or
   * re-resolved the same release through its provider — so this is the ordinary
   * "start a stream from this source" path, the same one the detail screen uses
   * when the viewer picks from a list. Going straight to a known-good source is
   * the whole point: no discovery, no ranking, no waiting on fifteen scrapers.
   */
  const handlePlaySavedSource = useCallback(
    async (source: TorrentResult, record: PlayedSource) => {
      const response = await window.cloudstream?.startStream(
        source,
        record.season,
        record.episode
      );
      if (!response?.handle?.streamUrl) return;

      setPlayback({
        streamUrl: response.handle.streamUrl,
        mimeType: response.handle.mimeType,
        title: record.origin.title,
        episodeTitle: record.origin.episodeTitle,
        infoHash: response.handle.infoHash,
        subtitles: response.handle.subtitleUrls ?? [],
        progress: {
          mediaUrl: record.origin.mediaUrl,
          year: record.origin.year,
          season: record.season,
          episode: record.episode,
          // Straight back to where they stopped, which is the other half of
          // "take me back to what was working".
          resumeAt: record.positionSeconds,
        },
      });
      setPlayerHidden(false);
      setPlayerMini(false);
    },
    []
  );

  /**
   * Search from inside the player.
   *
   * Closes the player first. Leaving the film running behind the results is a
   * second thing happening that nobody asked for, and the audio underneath a
   * search screen reads as a bug rather than a feature.
   */
  const handleSearchFromPlayer = useCallback(
    (query: string) => {
      void handleClosePlayer();
      setSelectedMedia(null);
      setActiveTab('search');
      setSearchQuery(query);
      void handleSearch(query);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleSearch]
  );

  const handleSearchFromDetail = useCallback(
    (query: string) => {
      setSelectedMedia(null);
      setActiveTab('search');
      setSearchQuery(query);
      void handleSearch(query);
    },
    [handleSearch]
  );

  const handleSelectMedia = (item: SearchResponse) => {
    savedScroll.current = viewportRef.current?.scrollTop ?? 0;
    setSelectedMedia(item);
  };

  /**
   * Back to the list, at the place it was left.
   *
   * Restored after paint rather than immediately: the results grid does not
   * exist yet at the moment `selectedMedia` clears, so setting `scrollTop`
   * before the browser has laid it out scrolls a shorter page and clamps to
   * whatever fits.
   */
  const handleBackToResults = useCallback(() => {
    setSelectedMedia(null);
    const target = savedScroll.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (viewportRef.current) viewportRef.current.scrollTop = target;
      });
    });
  }, []);

  /**
   * Tears down the stream that was playing before the current one.
   *
   * Streaming torrents keep sockets and disk cache alive, so moving through a
   * season would otherwise leave one live swarm per episode watched. Doing it
   * here — reactively, once the *next* stream exists — rather than before
   * resolving the next episode is what keeps a failed switch recoverable: the
   * old stream stays playable until a replacement is actually ready.
   */
  const previousInfoHash = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousInfoHash.current;
    previousInfoHash.current = playback?.infoHash;

    if (previous && previous !== playback?.infoHash) {
      // Files are kept: the user may have promoted this stream to a download.
      window.cloudstream?.stopStream(previous, true);
    }
  }, [playback?.infoHash]);

  /**
   * Opens the player first and resolves a source into it.
   *
   * The session is started before anything is known about whether a source
   * exists, which is the whole point: the viewer sees the player and watches
   * discovery happen rather than a detail page that appears to have ignored the
   * click. Any previous session is ended first so two never hold streams at once.
   */
  const startSession = useCallback(async (context: PlaybackSessionRequest) => {
    if (!window.cloudstream) return;

    setPlayback(null);
    setSwitchError(null);
    // Starting something new always brings the player back to the front, even
    // if the last one was left minimised.
    setPlayerHidden(false);
    setPlayerMini(false);

    const previous = sessionRef.current;
    if (previous) await window.cloudstream.stopPlayback(previous.id, true);

    const response = await window.cloudstream.startPlayback(
      context.request,
      context.title,
      context.episodeTitle
    );
    if (!response.ok || !response.snapshot) {
      setSwitchError(response.error ?? 'Could not start playback.');
      return;
    }
    setSession({ id: response.snapshot.sessionId, context, snapshot: response.snapshot });
  }, []);

  /**
   * Switches episode from inside the player.
   *
   * Resolution runs through the detail view (which owns source lookup) and can
   * take tens of seconds once failover is involved, so the player is told what
   * is being loaded and told again if it fails.
   */
  const handleSwitchEpisode = async (episode: Episode) => {
    const request = session ? session.context : playback;
    if (!request?.onRequestEpisode) return;

    setSwitchError(null);
    setSwitchingTo(episode);
    try {
      await request.onRequestEpisode(episode);
    } catch (error) {
      setSwitchError(
        error instanceof Error ? error.message : 'Could not start that episode.'
      );
    } finally {
      setSwitchingTo(null);
    }
  };

  const handleClosePlayer = () => {
    // The teardown effect above stops the stream once `playback` clears; a
    // session owns its own stream, so it is ended explicitly instead.
    if (session) window.cloudstream?.stopPlayback(session.id, true);
    void window.cloudstream?.mpvStop?.();
    setSession(null);
    setPreparing(null);
    setPlayback(null);
    setSwitchingTo(null);
    setSwitchError(null);
    setPlayerHidden(false);
    setPlayerMini(false);
  };

  /**
   * Shrinks the player and hands the app back, still playing.
   *
   * Nothing about the session changes — this is a geometry change to an element
   * that stays mounted, so there is no stream to restart and no position to
   * restore. That is the whole reason it is safe to offer.
   */
  const handleMinimizePlayer = () => {
    if (!session && !playback && !preparing) return;
    setPlayerMini(true);
    setPlayerHidden(false);
  };

  const handleExpandPlayer = () => {
    setPlayerMini(false);
    setPlayerHidden(false);
  };

  /**
   * Steps out of the player without ending it.
   *
   * The player is an overlay over the tab views, and closing it stops the
   * stream — so "open the Downloads screen" could not be spelled as a close
   * followed by a navigation without throwing away exactly the thing the viewer
   * was watching. Hiding the overlay leaves the session, the stream and every
   * running download untouched; the bar below is the way back in.
   */
  const handleLeavePlayer = (tab: ActiveTab) => {
    if (!session && !playback && !preparing) return;
    // Shrunk rather than hidden. Stepping out to Downloads used to blank the
    // video and leave a bar saying it was still playing, which is a strange
    // thing to tell someone about a film they were watching a second ago.
    setPlayerMini(true);
    setPlayerHidden(false);
    setSelectedMedia(null);
    setActiveTab(tab);
  };

  /**
   * Quick-play straight from a card.
   *
   * The player is shown on the click, before anything is known about the title,
   * because resolving the detail is a network round trip and a card that
   * appears to do nothing for half a second reads as broken. `preparing` holds
   * the player open in its resolving state until the real session exists.
   *
   * A series starts at its first episode. Handing a series URL to source
   * discovery finds season packs at best, and nothing at all more often.
   */
  const handleQuickPlay = useCallback(
    async (item: SearchResponse) => {
      setSelectedMedia(null);
      setPlayerHidden(false);
      setPlayerMini(false);
      setPreparing({ title: item.name });

      try {
        const response = await window.cloudstream?.loadMedia(item.url);
        const detail = response?.ok ? response.detail : null;

        const episodes = detail?.episodes ?? [];
        const first = [...episodes].sort(
          (a, b) => (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0)
        )[0];

        await startSession({
          request: {
            mediaUrl: first?.url ?? item.url,
            season: first?.season,
            episode: first?.episode,
          },
          title: detail?.name ?? item.name,
          originalTitle: item.originalTitle || (detail as any)?.originalTitle,
          providerProvenance: item.apiName ? { provider: item.apiName } : undefined,
          episodeTitle: first?.name,
          progress: {
            mediaUrl: first?.url ?? item.url,
            year: detail?.year ?? item.year,
            posterUrl: detail?.posterUrl ?? item.posterUrl,
            season: first?.season,
            episode: first?.episode,
          },
          subtitleContext: {
            imdbId: (detail as { imdbId?: string } | null)?.imdbId,
            season: first?.season,
            episode: first?.episode,
          },
        });
      } finally {
        setPreparing(null);
      }
    },
    [startSession]
  );

  const handlePlayFromHistory = useCallback(
    async (item: HistoryEvent) => {
      setSelectedMedia(null);
      setPlayerHidden(false);
      setPlayerMini(false);
      setPreparing({ title: item.title });

      try {
        await startSession({
          request: {
            mediaUrl: item.mediaUrl,
            season: item.season,
            episode: item.episode,
          },
          title: item.title,
          originalTitle: item.source?.sourceName !== item.title ? item.source?.sourceName : undefined,
          providerProvenance: {
            provider: item.source?.providerName,
            repositoryName: item.source?.repository,
            extensionName: item.source?.extension,
            indexerName: item.source?.indexerName,
          },
          episodeTitle: item.episodeTitle,
          progress: {
            mediaUrl: item.mediaUrl,
            year: item.year,
            posterUrl: item.posterUrl,
            season: item.season,
            episode: item.episode,
          },
          subtitleContext: {
            season: item.season,
            episode: item.episode,
          },
        });
      } finally {
        setPreparing(null);
      }
    },
    [startSession]
  );

  /**
   * Tells the originating view which release actually started.
   *
   * Which source won is only known once failover has settled, and it is what a
   * later session prefers for this title — so it is reported on the transition
   * into `playing`, not at the moment the user pressed play.
   */
  const reportedSource = useRef<string | undefined>(undefined);
  useEffect(() => {
    const active = session?.snapshot.activeInfoHash;
    if (!session || session.snapshot.phase !== 'playing' || !active) return;

    // Keyed by session as well as hash: consecutive episodes are often served
    // by the same season pack, and each still needs its own remembered choice.
    const key = `${session.id}:${active}`;
    if (reportedSource.current === key) return;

    reportedSource.current = key;
    const source = session.snapshot.sources.find((s) => s.infoHash === active);
    if (source) session.context.onStarted?.(source);
  }, [session]);

  const handleSelectSource = useCallback(
    (source: TorrentResult) => {
      if (!sessionRef.current) return;
      window.cloudstream?.playbackSelectSource(sessionRef.current.id, source.infoHash);
    },
    []
  );

  /**
   * A source started and then would not play; move to the next.
   *
   * The distinction the main process cannot make on its own — it saw the stream
   * start successfully. Without this the viewer sat on a dead frame with a list
   * of other sources one click away and no reason to believe any of them would
   * behave differently.
   */
  const handleSourceUnplayable = useCallback(
    async (reason: string) => {
      const id = sessionRef.current?.id;
      if (!id) return;
      const response = await window.cloudstream?.skipPlaybackSource?.(id, reason);
      if (response?.snapshot) {
        setSession((current) =>
          current && current.id === response.snapshot!.sessionId
            ? { ...current, snapshot: response.snapshot! }
            : current
        );
      }
    },
    []
  );

  const handleRefreshSources = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackRefreshSources(sessionRef.current.id);
  }, []);

  /**
   * Ask beyond the providers this title was found on.
   *
   * A separate action from refresh, because it is a different question. The
   * default search asks the providers whose results produced this row — what
   * the Android app does — and this reaches every other installed provider plus
   * the torrent indexers. Once asked, the session keeps the wider scope, so a
   * later refresh does not quietly narrow back.
   */
  const handleWidenSources = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackRefreshSources(sessionRef.current.id, true);
  }, []);

  const handleCancelSourceSearch = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackCancelSourceSearch(sessionRef.current.id);
  }, []);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  /**
   * "Search again" on a player that was opened from the detail page's source list.
   *
   * This path had `onRefresh: () => {}` — a button rendered, styled and wired to
   * nothing, which is the worst of the three possible states because it looks
   * like the search simply found nothing new. There are three ways into the
   * player and only one of them (a live `PlaybackSession`) had a working
   * refresh; the other two are reached by picking a source yourself, which is
   * exactly when you are most likely to want a different one.
   *
   * It runs a real discovery rather than re-reading the cache — a refresh is the
   * viewer saying the cached answer is wrong, and serving it back is what made
   * the equivalent button on the detail screen look broken. Results stream in,
   * so the list grows while the search runs instead of appearing all at once.
   */
  const [playbackRefresh, setPlaybackRefresh] = useState<{
    sessionId: string;
    searched: number;
    total: number;
    done: boolean;
    error?: string;
  } | null>(null);
  const playbackRefreshRef = useRef<string | null>(null);

  const handleRefreshPlaybackSources = useCallback(async () => {
    const current = playbackRef.current;
    if (!current || !window.cloudstream) return;

    setPlaybackRefresh({ sessionId: '', searched: 0, total: 0, done: false });

    const response = await window.cloudstream.startSourceDiscovery(
      {
        mediaUrl: current.progress?.mediaUrl ?? current.streamUrl,
        season: current.progress?.season,
        episode: current.progress?.episode,
      },
      current.title,
      current.episodeTitle,
      { bypassCache: true }
    );

    /**
     * A refresh that cannot start says so. The requirement this satisfies is
     * "the action must never silently fail" — and the previous no-op failed
     * that twice over, by neither acting nor reporting.
     */
    if (!response?.ok || !response.snapshot) {
      setPlaybackRefresh({
        sessionId: '',
        searched: 0,
        total: 0,
        done: true,
        error: response?.error ?? 'A new source search could not be started.',
      });
      return;
    }

    playbackRefreshRef.current = response.snapshot.sessionId;
    setPlaybackRefresh({
      sessionId: response.snapshot.sessionId,
      searched: 0,
      total: response.snapshot.totalIndexers ?? 0,
      done: false,
    });
  }, []);

  /**
   * Streams the refreshed list into the open player.
   *
   * Filtered by session id: a discovery that has just been superseded can still
   * emit once more, and those results answer a different question — the previous
   * episode, or the search the viewer just replaced.
   */
  useEffect(() => {
    if (!playbackRefresh || !playbackRefresh.sessionId) return;

    const dispose = window.cloudstream?.onPlaybackUpdate((snapshot) => {
      if (snapshot.sessionId !== playbackRefreshRef.current) return;

      setPlaybackRefresh((state) =>
        state && state.sessionId === snapshot.sessionId
          ? {
              ...state,
              searched: snapshot.searched,
              total: snapshot.totalIndexers,
              done: snapshot.searchDone,
            }
          : state
      );

      // The active source is preserved across a refresh: the viewer asked for
      // more choices, not for their film to be restarted from a new link.
      setPlayback((request) =>
        request?.sources
          ? { ...request, sources: { ...request.sources, list: snapshot.sources } }
          : request
      );
    });

    return dispose;
  }, [playbackRefresh?.sessionId]);

  const handlePlayNow = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackPlayNow(sessionRef.current.id);
  }, []);

  /**
   * The one place a user-initiated download goes.
   *
   * `requestDownload` rather than `enqueueDownload` because a press is a
   * request for the file to make progress, not a command to create a task: it
   * resumes a paused transfer and recovers a failed one where enqueue would
   * have silently created a second task pointing at the same bytes. The result
   * is returned so the caller can say which of those happened.
   */
  const handleEnqueueDownload = async (task: DownloadTask): Promise<DownloadRequestResult> => {
    if (!window.cloudstream) {
      return { ok: false, action: 'started', message: 'Desktop bridge unavailable.' };
    }
    const result = await window.cloudstream.requestDownload(task);

    try {
      await window.cloudstream.recordHistoryEvent?.({
        title: task.title,
        mediaUrl: task.mediaUrl || task.link.url,
        posterUrl: task.posterUrl,
        season: task.seasonNumber,
        episode: task.episodeNumber,
        action: 'download_started',
        status: 'Attempted',
        source: {
          providerName: task.providerName,
          sourceName: task.link.name,
          directUrl: task.link.url,
          directHeaders: task.headers,
          quality: task.quality ? `${task.quality}p` : undefined,
          resolution: task.resolution,
          sizeBytes: task.totalBytes,
        },
      });
    } catch {}

    const queue = await window.cloudstream.getDownloadQueue();
    setDownloadQueue(queue);
    return result;
  };

  const handlePauseDownload = async (id: string) => {
    if (window.cloudstream) await window.cloudstream.pauseDownload(id);
  };

  const handleResumeDownload = async (id: string) => {
    if (window.cloudstream) await window.cloudstream.resumeDownload(id);
  };

  const handleRemoveDownload = async (id: string) => {
    if (window.cloudstream) await window.cloudstream.removeDownload(id);
  };

  const handleBinarySetupSuccess = () => {
    setHasBinaries(true);
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setSelectedMedia(null);
        }}
        downloadCount={downloadQueue.filter((t) => t.state === 'Downloading' || t.state === 'Queued').length}
        missingComponentCount={missingComponents}
      />

      {/* Main App View Area */}
      <div className="main-content">
        <Navbar
          onSearch={handleSearch}
          isSearching={Boolean(search && !search.done)}
          onScopeChange={handleScopeChange}
          onOpenInspector={() => setIsInspectorOpen(true)}
          // So a search started from the details page shows in the bar that
          // claims to say what is being searched.
          externalQuery={searchQuery}
        />

        {isOffline && (
          <div className="offline-banner" role="status">
            <WifiOff size={15} aria-hidden />
            <span>
              <strong>You are offline.</strong> Saved pages and downloaded files still work;
              searching and streaming need a connection.
            </span>
          </div>
        )}

        {/* First launch only, and never blocking: the app works while the
            bundled repositories install behind it. */}
        <FirstRunBanner />

        <main className="view-viewport" ref={viewportRef}>
          {/* Active Fullscreen Video Player Overlay.
              A session takes precedence: it renders the player from the first
              click, before a stream exists, and fills it in as one resolves. */}
          {session ? (
            <VideoPlayer
              streamUrl={session.snapshot.handle?.streamUrl ?? ''}
              mimeType={session.snapshot.handle?.mimeType ?? ''}
              title={session.context.title}
              originalTitle={session.context.originalTitle}
              episodeTitle={session.context.episodeTitle}
              providerProvenance={session.context.providerProvenance}
              infoHash={session.snapshot.activeInfoHash}
              subtitles={session.snapshot.handle?.subtitleUrls ?? []}
              onBack={handleClosePlayer}
              onSearchTitle={handleSearchFromPlayer}
              hidden={playerHidden}
              mini={playerMini}
              onMinimize={handleMinimizePlayer}
              onExpand={handleExpandPlayer}
              onOpenDownloads={() => handleLeavePlayer('downloads')}
              series={session.context.series}
              progress={session.context.progress}
              switchingTo={switchingTo}
              switchError={switchError}
              subtitleContext={session.context.subtitleContext}
              onDownloadCurrent={() => {
                const active =
                  session.snapshot.sources.find(
                    (s) => s.infoHash === session.snapshot.activeInfoHash
                  ) ?? session.snapshot.sources[0];

                if (session.context.onDownloadSource && active) {
                  session.context.onDownloadSource(active);
                  return;
                }

                const task = buildDownloadTask(active, {
                  title: session.context.title,
                  episodeTitle: session.context.episodeTitle,
                  mediaUrl: session.context.progress?.mediaUrl,
                  posterUrl: session.context.progress?.posterUrl,
                  season: session.context.subtitleContext?.season,
                  episode: session.context.subtitleContext?.episode,
                  fallbackUrl: session.snapshot.handle?.streamUrl,
                });
                if (task) void handleEnqueueDownload(task);
              }}
              onSelectEpisode={
                session.context.onRequestEpisode
                  ? (episode) => handleSwitchEpisode(episode)
                  : undefined
              }
              sourceSession={{
                phase: session.snapshot.phase,
                sources: session.snapshot.sources,
                activeInfoHash: session.snapshot.activeInfoHash,
                searched: session.snapshot.searched,
                totalIndexers: session.snapshot.totalIndexers,
                lastIndexerName: session.snapshot.lastIndexerName,
                searchDone: session.snapshot.searchDone,
                searchCancelled: session.snapshot.searchCancelled,
                error: session.snapshot.error,
                attempts: session.snapshot.attempts,
                onPlayNow: handlePlayNow,
                onSelectSource: handleSelectSource,
                onRefresh: handleRefreshSources,
                onWiden: handleWidenSources,
                canWiden: session.snapshot.canWiden,
                onCancelSearch: handleCancelSourceSearch,
                onSourceUnplayable: handleSourceUnplayable,
                onDownloadSource: session.context.onDownloadSource,
              }}
            />
          ) : preparing ? (
            /* The click already happened; this is the gap before the session
               exists. Same player, same resolving overlay, no flicker when the
               real session replaces it. */
            <VideoPlayer
              streamUrl=""
              mimeType=""
              title={preparing.title}
              subtitles={[]}
              onBack={handleClosePlayer}
              onSearchTitle={handleSearchFromPlayer}
              hidden={playerHidden}
              mini={playerMini}
              onMinimize={handleMinimizePlayer}
              onExpand={handleExpandPlayer}
              onOpenDownloads={() => handleLeavePlayer('downloads')}
              sourceSession={{
                phase: 'searching',
                sources: [],
                searched: 0,
                totalIndexers: 0,
                searchDone: false,
                attempts: [],
                onPlayNow: () => {},
                onSelectSource: () => {},
                onRefresh: () => {},
              }}
            />
          ) : playback ? (
            <VideoPlayer
              streamUrl={playback.streamUrl}
              mimeType={playback.mimeType}
              title={playback.title}
              episodeTitle={playback.episodeTitle}
              infoHash={playback.infoHash}
              subtitles={playback.subtitles}
              onBack={handleClosePlayer}
              onSearchTitle={handleSearchFromPlayer}
              hidden={playerHidden}
              mini={playerMini}
              onMinimize={handleMinimizePlayer}
              onExpand={handleExpandPlayer}
              onOpenDownloads={() => handleLeavePlayer('downloads')}
              series={playback.series}
              progress={playback.progress}
              switchingTo={switchingTo}
              switchError={switchError}
              onSelectEpisode={
                playback.onRequestEpisode
                  ? (episode) => handleSwitchEpisode(episode)
                  : undefined
              }
              /*
                A manually chosen source gets the same player as a quick-played
                one. It did not: this path passed a bare stream URL, so choosing
                a source deliberately produced a player with no source list, no
                download button and no way past a source that would not play —
                the more considered action giving the less capable result.
              */
              onDownloadCurrent={() => {
                if (playback.sources) {
                  const current =
                    playback.sources.list.find(
                      (source) => source.infoHash === playback.sources!.activeInfoHash
                    ) ?? playback.sources.list[0];
                  if (current) {
                    playback.sources.onDownload(current);
                    return;
                  }
                }
                const task = buildDownloadTask(null, {
                  title: playback.title,
                  episodeTitle: playback.episodeTitle,
                  mediaUrl: playback.progress?.mediaUrl,
                  posterUrl: playback.progress?.posterUrl,
                  season: playback.progress?.season,
                  episode: playback.progress?.episode,
                  fallbackUrl: playback.streamUrl,
                });
                if (task) void handleEnqueueDownload(task);
              }}
              sourceSession={
                playback.sources
                  ? {
                      // Discovery is already finished on this path — the viewer
                      // picked from its results — so the panel opens straight
                      // onto the list rather than a progress bar.
                      // A refresh in flight is shown as one: the panel's own
                      // progress row is what tells the viewer the button did
                      // something, which is the whole complaint it fixes.
                      phase: playbackRefresh && !playbackRefresh.done ? 'searching' : 'playing',
                      sources: playback.sources.list,
                      activeInfoHash: playback.sources.activeInfoHash,
                      searched: playbackRefresh?.searched ?? 0,
                      totalIndexers: playbackRefresh?.total ?? 0,
                      searchDone: playbackRefresh ? playbackRefresh.done : true,
                      error: playbackRefresh?.error,
                      attempts: [],
                      onPlayNow: () => {},
                      onSelectSource: playback.sources.onSelect,
                      onRefresh: handleRefreshPlaybackSources,
                      onSourceUnplayable: playback.sources.onUnplayable,
                      onDownloadSource: playback.sources.onDownload,
                    }
                  : undefined
              }
            />
          ) : null}

          {/*
            The fallback marker for a player that is running out of sight.

            Now reached only when something is `hidden` rather than minimised —
            minimising shows the video itself, which is a better answer to the
            same problem and is what every path in this app now takes. The bar
            stays because a session with nothing on screen pointing at it is the
            failure it exists to prevent, and `hidden` is still a state the
            player supports.
          */}
          {playerHidden && !playerMini && (session || playback || preparing) && (
            <MiniPlayerBar
              title={session?.context.title ?? playback?.title ?? preparing?.title ?? 'Playing'}
              episodeTitle={session?.context.episodeTitle ?? playback?.episodeTitle}
              onReturn={() => setPlayerHidden(false)}
              onStop={handleClosePlayer}
            />
          )}

          {/* Media Details View Overlay */}
          {selectedMedia ? (
            <DetailView
              mediaItem={selectedMedia}
              onBack={handleBackToResults}
              onPlay={(request) => {
                setPlayerHidden(false);
                setPlayerMini(false);
                setPlayback(request);
              }}
              onStartSession={startSession}
              onEnqueueDownload={handleEnqueueDownload}
              onSearch={handleSearchFromDetail}
              // Opening a related title is the same navigation as opening a
              // search result, so it reuses the same handler and the same
              // scroll-restore behaviour.
              onSelectMedia={handleSelectMedia}
              // Recorded on a bookmark, so a saved page remembers the search
              // that found it and can be reached that way again.
              searchQuery={searchQuery}
            />
          ) : (
            <>
              {activeTab === 'home' && (
                <ErrorBoundary>
                  <HomeView
                    onSelectMedia={handleSelectMedia}
                    onPlayDirectly={handleQuickPlay}
                    // Trending anime carries no IMDb id, so those cards open
                    // through a search rather than straight into a detail page.
                    onSearch={handleSearchFromDetail}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'search' && (
                <ErrorBoundary>
                  <SearchView
                    query={searchQuery}
                    search={search}
                    onSelectMedia={handleSelectMedia}
                    onPlayDirectly={handleQuickPlay}
                    onCancel={handleCancelSearch}
                    error={searchError}
                    ui={searchUi}
                    onUiChange={setSearchUi}
                    onSearchAllSources={handleSearchAllSources}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'library' && (
                <ErrorBoundary>
                  <LibraryView
                    onSelectMedia={handleSelectMedia}
                    onSearch={handleSearchFromDetail}
                    onPlaySavedSource={handlePlaySavedSource}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'history' && (
                <ErrorBoundary>
                  <HistoryView
                    onSelectMedia={handleSelectMedia}
                    onPlayDirect={handlePlayFromHistory}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'downloads' && (
                <DownloadCenter
                  tasks={downloadQueue}
                  hasBinaries={hasBinaries}
                  onPause={handlePauseDownload}
                  onResume={handleResumeDownload}
                  onRemove={handleRemoveDownload}
                  onReveal={(filePath) => window.cloudstream?.revealInFolder(filePath)}
                  onOpenBinarySetup={() => setIsBinaryModalOpen(true)}
                  /* The download carries where it came from; this is the way back
                     to episodes, other sources and playback for that title. */
                  onOpenTitle={(task) => {
                    if (!task.mediaUrl) return;
                    handleSelectMedia({
                      name: task.title,
                      url: task.mediaUrl,
                      apiName: task.providerName ?? 'Downloads',
                      posterUrl: task.posterUrl,
                    });
                  }}
                  /* Plays the file we already have, in our own player.

                     The stream URL is a loopback address rather than the path,
                     so the file is inspected and classified by `media:prepare`
                     exactly like a provider link — a downloaded 10-bit HEVC
                     file needs the same routing decision a streamed one does.
                     Subtitles recorded alongside the download come with it. */
                  onPlayFile={(task) => {
                    void (async () => {
                      const served = await window.cloudstream?.getPlayableDownloadUrl(
                        task.targetFilePath
                      );
                      if (!served?.ok || !served.url) {
                        setActionNotice(
                          served?.error ?? 'That file could not be opened. It may have been moved.'
                        );
                        return;
                      }
                      setPlayerHidden(false);
                      setPlayerMini(false);
                      setPlayback({
                        streamUrl: served.url,
                        mimeType: 'video/mp4',
                        title: task.title,
                        episodeTitle:
                          task.episodeNumber !== undefined
                            ? `Episode ${task.episodeNumber}`
                            : undefined,
                        infoHash: `download:${task.id}`,
                        // `SubtitleFile` carries a language, not a display
                        // name, and the player's list is labelled by name.
                        subtitles: (task.subtitles ?? []).map((sub) => ({
                          name: sub.lang,
                          url: sub.url,
                        })),
                        progress: task.mediaUrl
                          ? {
                              mediaUrl: task.mediaUrl,
                              posterUrl: task.posterUrl,
                              season: task.seasonNumber,
                              episode: task.episodeNumber,
                            }
                          : undefined,
                      });
                    })();
                  }}
                />
              )}
              {activeTab === 'extensions' && (
                <ErrorBoundary fallbackTitle="Error loading Extensions Manager">
                  <ExtensionsScreen />
                </ErrorBoundary>
              )}
              {activeTab === 'settings' && (
                <ErrorBoundary>
                  <SettingsView
                    hasBinaries={hasBinaries}
                    onOpenBinarySetup={() => setIsBinaryModalOpen(true)}
                  />
                </ErrorBoundary>
              )}
            </>
          )}
        </main>
      </div>

      {/* Provider Inspector Panel Drawer */}
      <ProviderInspector
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        providers={providersList}
      />

      {/* 1-Click Binary Setup Modal */}
      <BinarySetupModal
        isOpen={isBinaryModalOpen}
        onClose={() => setIsBinaryModalOpen(false)}
        onSuccess={handleBinarySetupSuccess}
      />

      {/* Dismissed by clicking it, because it reports something the viewer
          asked for and may want to read twice — not a status that ages out. */}
      {actionNotice && (
        <div
          className="toast"
          role="status"
          onClick={() => setActionNotice(null)}
          style={{ cursor: 'pointer' }}
        >
          {actionNotice}
        </div>
      )}
    </div>
  );
};

export default App;
