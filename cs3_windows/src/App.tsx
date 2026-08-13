import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import type { ActiveTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { VideoPlayer } from './components/VideoPlayer';
import { DownloadCenter } from './components/DownloadCenter';
import { ProviderInspector } from './components/ProviderInspector';
import { ExtensionManagerUI } from './components/ExtensionManagerUI';
import { BinarySetupModal } from './components/BinarySetupModal';
import { HomeView } from './views/HomeView';
import { SearchView } from './views/SearchView';
import {
  DetailView,
  type PlaybackRequest,
  type PlaybackSessionRequest,
} from './views/DetailView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';

import { ErrorBoundary } from './components/ErrorBoundary';

import type { Episode, SearchOptions, SearchResponse } from './types/api';
import type { DownloadTask } from './types/download';
import type { TorrentResult } from './types/torrent';
import type { PlaybackSnapshot } from '../electron/playbackSession';

/** One live playback session: its id, what asked for it, and its latest state. */
interface ActiveSession {
  id: string;
  context: PlaybackSessionRequest;
  snapshot: PlaybackSnapshot;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  // `startSession` is handed down into the detail view and must not close over
  // `session`, or it would go stale between episode switches.
  const sessionRef = useRef<ActiveSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);
  const [providersList, setProvidersList] = useState<string[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('All');

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

    // Subscribed once, filtered by session id: the player is driven entirely by
    // these snapshots from the moment it opens until the session ends.
    const disposePlayback = window.cloudstream?.onPlaybackUpdate((snapshot) => {
      setSession((current) =>
        current && current.id === snapshot.sessionId ? { ...current, snapshot } : current
      );
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
    };
  }, []);

  const handleSearch = async (query: string, options?: SearchOptions) => {
    setSearchQuery(query);
    setSelectedMedia(null); // Instantly dismiss open DetailView overlay
    setSearchResults([]);   // Instantly clear old search results
    setActiveTab('search');
    setIsSearching(true);
    setSearchError(null);

    if (window.cloudstream) {
      try {
        const response = await window.cloudstream.searchAll(query, options);
        setSearchResults(Array.isArray(response?.results) ? response.results : []);
        if (!response.ok && response.error) setSearchError(response.error);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : String(err));
      }
    }
    setIsSearching(false);
  };

  const handleSelectMedia = (item: SearchResponse) => {
    setSelectedMedia(item);
  };

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

  const handleRefreshSources = useCallback(() => {
    if (!sessionRef.current) return;
    window.cloudstream?.playbackRefreshSources(sessionRef.current.id);
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
      />

      {/* Main App View Area */}
      <div className="main-content">
        <Navbar
          onSearch={handleSearch}
          isSearching={isSearching}
          onOpenInspector={() => setIsInspectorOpen(true)}
          providers={providersList}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
        />

        <main className="view-viewport">
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
              series={session.context.series}
              progress={session.context.progress}
              switchingTo={switchingTo}
              switchError={switchError}
              subtitleContext={session.context.subtitleContext}
              onDownloadCurrent={
                // Downloads the release that is actually playing, which is not
                // necessarily the top-ranked one after failover.
                session.context.onDownloadSource && session.snapshot.activeInfoHash
                  ? () => {
                      const active = session.snapshot.sources.find(
                        (s) => s.infoHash === session.snapshot.activeInfoHash
                      );
                      if (active) session.context.onDownloadSource?.(active);
                    }
                  : undefined
              }
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
                error: session.snapshot.error,
                attempts: session.snapshot.attempts,
                onPlayNow: handlePlayNow,
                onSelectSource: handleSelectSource,
                onRefresh: handleRefreshSources,
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
              series={playback.series}
              progress={playback.progress}
              switchingTo={switchingTo}
              switchError={switchError}
              onSelectEpisode={
                playback.onRequestEpisode
                  ? (episode) => handleSwitchEpisode(episode)
                  : undefined
              }
            />
          ) : null}

          {/* Media Details View Overlay */}
          {selectedMedia ? (
            <DetailView
              mediaItem={selectedMedia}
              onBack={() => setSelectedMedia(null)}
              onPlay={setPlayback}
              onStartSession={startSession}
              onEnqueueDownload={handleEnqueueDownload}
            />
          ) : (
            <>
              {activeTab === 'home' && (
                <ErrorBoundary>
                  <HomeView onSelectMedia={handleSelectMedia} onPlayDirectly={handleQuickPlay} />
                </ErrorBoundary>
              )}
              {activeTab === 'search' && (
                <ErrorBoundary>
                  <SearchView
                    query={searchQuery}
                    results={searchResults}
                    onSelectMedia={handleSelectMedia}
                    onPlayDirectly={handleQuickPlay}
                    isLoading={isSearching}
                    error={searchError}
                  />
                </ErrorBoundary>
              )}
              {activeTab === 'library' && (
                <ErrorBoundary>
                  <LibraryView onSelectMedia={handleSelectMedia} />
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
                />
              )}
              {activeTab === 'extensions' && (
                <ErrorBoundary fallbackTitle="Error loading Extensions Manager">
                  <ExtensionManagerUI />
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
