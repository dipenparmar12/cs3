import React, { useEffect, useState } from 'react';
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

import type { SearchResponse } from './types/api';
import type { DownloadTask } from './types/download';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedMedia, setSelectedMedia] = useState<SearchResponse | null>(null);
  const [playback, setPlayback] = useState<PlaybackRequest | null>(null);

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

  const handleClosePlayer = async () => {
    // Streaming torrents keep sockets and disk cache alive; tearing the stream
    // down on exit is what stops a session leaking peers in the background.
    if (playback?.infoHash && window.cloudstream) {
      await window.cloudstream.stopStream(playback.infoHash, true);
    }
    setPlayback(null);
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
