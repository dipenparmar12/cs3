import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { type DownloadTask, DownloadState } from './types/download';
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
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);
  /** Indexer names, for the F12 inspector. The search scope owns its own list. */
  const [providersList, setProvidersList] = useState<string[]>([]);

  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setIsInspectorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      disposeProgress?.();
      disposePlayback?.();
      disposeSearch?.();
    };
  }, []);

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

  const handleCancelSourceSearch = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackCancelSourceSearch(sessionRef.current.id);
  }, []);

  const handlePlayNow = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackPlayNow(sessionRef.current.id);
  }, []);

  const handleEnqueueDownload = async (task: DownloadTask) => {
    if (window.cloudstream) {
      await window.cloudstream.enqueueDownload(task);
      const queue = await window.cloudstream.getDownloadQueue();
      setDownloadQueue(queue);
    }
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
              episodeTitle={session.context.episodeTitle}
              infoHash={session.snapshot.activeInfoHash}
              subtitles={session.snapshot.handle?.subtitleUrls ?? []}
              onBack={handleClosePlayer}
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
                if (session.context.onDownloadSource) {
                  const active =
                    session.snapshot.sources.find(
                      (s) => s.infoHash === session.snapshot.activeInfoHash
                    ) ?? session.snapshot.sources[0];
                  if (active) {
                    session.context.onDownloadSource(active);
                    return;
                  }
                }
                const streamUrl = session.snapshot.handle?.streamUrl;
                if (streamUrl) {
                  const taskTitle =
                    session.context.title +
                    (session.context.episodeTitle ? ` - ${session.context.episodeTitle}` : '');
                  const task: DownloadTask = {
                    id: `dl-${session.snapshot.activeInfoHash || Date.now()}-${taskTitle}`.replace(
                      /[^a-zA-Z0-9-_]/g,
                      '_'
                    ),
                    parentId: session.context.progress?.mediaUrl || '',
                    title: taskTitle,
                    episodeNumber: session.context.subtitleContext?.episode,
                    seasonNumber: session.context.subtitleContext?.season,
                    posterUrl: '',
                    targetFilePath: '',
                    link: {
                      source: 'Player Stream',
                      name: taskTitle,
                      url: streamUrl,
                      referer: '',
                      quality: 1080,
                    },
                    headers: {},
                    bytesDownloaded: 0,
                    totalBytes: 0,
                    downloadSpeed: 0,
                    etaSeconds: 0,
                    state: DownloadState.Queued,
                    providerName: 'Current Stream',
                    createdTime: Date.now(),
                    mediaUrl: session.context.progress?.mediaUrl || streamUrl,
                  };
                  void handleEnqueueDownload(task);
                }
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
                if (playback.streamUrl) {
                  const taskTitle =
                    playback.title +
                    (playback.episodeTitle ? ` - ${playback.episodeTitle}` : '');
                  const task: DownloadTask = {
                    id: `dl-${playback.infoHash || Date.now()}-${taskTitle}`.replace(
                      /[^a-zA-Z0-9-_]/g,
                      '_'
                    ),
                    parentId: playback.progress?.mediaUrl || '',
                    title: taskTitle,
                    posterUrl: '',
                    targetFilePath: '',
                    link: {
                      source: 'Player Stream',
                      name: taskTitle,
                      url: playback.streamUrl,
                      referer: '',
                      quality: 1080,
                    },
                    headers: {},
                    bytesDownloaded: 0,
                    totalBytes: 0,
                    downloadSpeed: 0,
                    etaSeconds: 0,
                    state: DownloadState.Queued,
                    providerName: 'Current Stream',
                    createdTime: Date.now(),
                    mediaUrl: playback.progress?.mediaUrl || playback.streamUrl,
                  };
                  void handleEnqueueDownload(task);
                }
              }}
              sourceSession={
                playback.sources
                  ? {
                      // Discovery is already finished on this path — the viewer
                      // picked from its results — so the panel opens straight
                      // onto the list rather than a progress bar.
                      phase: 'playing',
                      sources: playback.sources.list,
                      activeInfoHash: playback.sources.activeInfoHash,
                      searched: 0,
                      totalIndexers: 0,
                      searchDone: true,
                      attempts: [],
                      onPlayNow: () => {},
                      onSelectSource: playback.sources.onSelect,
                      onRefresh: () => {},
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
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'library' && (
                <ErrorBoundary>
                  <LibraryView
                    onSelectMedia={handleSelectMedia}
                    onSearch={handleSearchFromDetail}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'history' && (
                <ErrorBoundary>
                  <HistoryView
                    onSelectMedia={handleSelectMedia}
                    onPlayDirect={handleQuickPlay}
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
    </div>
  );
};

export default App;
