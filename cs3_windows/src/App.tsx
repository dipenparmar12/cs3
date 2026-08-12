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
import { DetailView } from './views/DetailView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';

import type { SearchResponse, ExtractorLink } from './types/api';
import type { DownloadTask } from './types/download';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResponse[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [selectedMedia, setSelectedMedia] = useState<SearchResponse | null>(null);
  const [activePlayerSources, setActivePlayerSources] = useState<ExtractorLink[] | null>(null);
  const [activeEpisodeTitle, setActiveEpisodeTitle] = useState<string | undefined>();

  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);
  const [providersList, setProvidersList] = useState<string[]>(['CloudStream Builtin']);
  const [selectedProvider, setSelectedProvider] = useState<string>('All');

  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isBinaryModalOpen, setIsBinaryModalOpen] = useState(false);

  // Initialize Electron IPC listeners
  useEffect(() => {
    if (window.cloudstream) {
      window.cloudstream.getProvidersList().then(setProvidersList);
      window.cloudstream.getDownloadQueue().then(setDownloadQueue);
      window.cloudstream.onDownloadProgress((tasks) => {
        setDownloadQueue(tasks);
      });

      // Check downloader binaries
      window.cloudstream.checkBinaries().then((status) => {
        if (!status.aria2) {
          console.info('aria2 binary not initialized. Prompting 1-click downloader setup.');
        }
      });
    }

    // F12 Global hotkey for Provider Inspector
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setIsInspectorOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    setActiveTab('search');
    setIsSearching(true);

    if (window.cloudstream) {
      const results = await window.cloudstream.searchAll(query);
      setSearchResults(results);
    }
    setIsSearching(false);
  };

  const handleSelectMedia = (item: SearchResponse) => {
    setSelectedMedia(item);
  };

  const handlePlayMedia = (sources: ExtractorLink[], episodeTitle?: string) => {
    setActivePlayerSources(sources);
    setActiveEpisodeTitle(episodeTitle);
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
          {activePlayerSources && (
            <VideoPlayer
              sources={activePlayerSources}
              title={selectedMedia?.name || 'CloudStream Player'}
              episodeTitle={activeEpisodeTitle}
              onBack={() => setActivePlayerSources(null)}
            />
          )}

          {/* Media Details View Overlay */}
          {selectedMedia ? (
            <DetailView
              mediaItem={selectedMedia}
              onBack={() => setSelectedMedia(null)}
              onPlay={handlePlayMedia}
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
                />
              )}
              {activeTab === 'library' && <LibraryView onSelectMedia={handleSelectMedia} />}
              {activeTab === 'downloads' && (
                <DownloadCenter
                  tasks={downloadQueue}
                  onPause={handlePauseDownload}
                  onResume={handleResumeDownload}
                  onRemove={handleRemoveDownload}
                  onOpenBinarySetup={() => setIsBinaryModalOpen(true)}
                />
              )}
              {activeTab === 'extensions' && <ExtensionManagerUI />}
              {activeTab === 'settings' && (
                <SettingsView onOpenBinarySetup={() => setIsBinaryModalOpen(true)} />
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
        onSuccess={() => console.log('Binary setup completed!')}
      />
    </div>
  );
};

export default App;
