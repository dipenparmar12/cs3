import React, { useEffect, useRef, useState } from 'react';
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
import { DetailView, type PlaybackRequest } from './views/DetailView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';

import type { Episode, SearchResponse } from './types/api';
import type { DownloadTask } from './types/download';

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
    };
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setActiveTab('search');
    setIsSearching(true);
    setSearchError(null);

    if (window.cloudstream) {
      const response = await window.cloudstream.searchAll(query);
      setSearchResults(response.results);
      if (!response.ok && response.error) setSearchError(response.error);
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
   * Switches episode from inside the player.
   *
   * Resolution runs through the detail view (which owns source lookup) and can
   * take tens of seconds once failover is involved, so the player is told what
   * is being loaded and told again if it fails.
   */
  const handleSwitchEpisode = async (episode: Episode) => {
    const request = playback;
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
    // The teardown effect above stops the stream once `playback` clears.
    setPlayback(null);
    setSwitchingTo(null);
    setSwitchError(null);
  };

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
          onOpenInspector={() => setIsInspectorOpen(true)}
          providers={providersList}
          selectedProvider={selectedProvider}
          setSelectedProvider={setSelectedProvider}
        />

        <main className="view-viewport">
          {/* Active Fullscreen Video Player Overlay */}
          {playback && (
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
          )}

          {/* Media Details View Overlay */}
          {selectedMedia ? (
            <DetailView
              mediaItem={selectedMedia}
              onBack={() => setSelectedMedia(null)}
              onPlay={setPlayback}
              onEnqueueDownload={handleEnqueueDownload}
            />
          ) : (
            <>
              {activeTab === 'home' && <HomeView onSelectMedia={handleSelectMedia} />}
              {activeTab === 'search' && (
                <SearchView
                  query={searchQuery}
                  results={searchResults}
                  onSelectMedia={handleSelectMedia}
                  isLoading={isSearching}
                  error={searchError}
                />
              )}
              {activeTab === 'library' && <LibraryView onSelectMedia={handleSelectMedia} />}
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
              {activeTab === 'extensions' && <ExtensionManagerUI />}
              {activeTab === 'settings' && (
                <SettingsView
                  hasBinaries={hasBinaries}
                  onOpenBinarySetup={() => setIsBinaryModalOpen(true)}
                />
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
