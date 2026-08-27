import React, { useEffect, useState, useCallback } from 'react';
import {
  Cpu,
  Download,
  Globe,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Zap,
  Wrench,
  AlertTriangle,
  Play,
  Trash2,
  Home,
} from 'lucide-react';
import { UnifiedComponentManager } from '../components/UnifiedComponentManager';
import { SourceSettings } from '../components/SourceSettings';
import { HomeSettings } from '../components/settings/HomeSettings';
import { SubtitleSettings } from '../components/settings/SubtitleSettings';
import { PlayerSettings } from '../components/PlayerSettings';
import { ProviderRankingPanel } from '../components/settings/ProviderRankingPanel';
import { NetworkSettings } from '../components/NetworkSettings';
import { AdultContentSetting } from '../components/AdultContentSetting';
import { SettingGroup, SettingRow } from '../components/settings/SettingRow';
import { useFlash } from '../utils/useFlash';
import { DiagnosticsPanel } from '../components/settings/DiagnosticsPanel';
import { ExtensionIssuesPanel } from '../components/settings/ExtensionIssuesPanel';

type TabId = 'general' | 'player' | 'components' | 'sources' | 'downloads' | 'network' | 'advanced';

interface SettingsViewProps {
  hasBinaries?: boolean;
  onOpenBinarySetup?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const [tab, setTab] = useState<TabId>('general');
  const [downloadDir, setDownloadDir] = useState('%USERPROFILE%\\Downloads\\CloudStream');
  /**
   * The delete-behaviour preference, resettable here.
   *
   * This is the only way back to being asked once "remember my choice" has been
   * ticked — a preference that can only be set from inside a dialog the user has
   * opted out of seeing is one they cannot undo.
   */
  const [deletePreference, setDeletePreference] = useState<'ask' | 'list-only' | 'list-and-file'>(
    'ask'
  );
  const [useLiveStreams, setUseLiveStreams] = useState(true);
  const { message: statusMessage, flash } = useFlash<string>(3000);
  const [missingComponentCount, setMissingComponentCount] = useState<number>(0);
  const [concurrency, setConcurrency] = useState<{
    value: number;
    min: number;
    max: number;
    def: number;
  } | null>(null);
  const [prefetchSources, setPrefetchSources] = useState(true);

  useEffect(() => {
    void window.cloudstream?.getSourcePrefetchSetting?.().then((response) => {
      if (response?.ok) setPrefetchSources(response.enabled);
    });
  }, []);

  const checkComponentStatus = useCallback(async () => {
    try {
      const res = await window.cloudstream?.getComponentStatus?.();
      if (res && typeof res.missingCount === 'number') {
        setMissingComponentCount(res.missingCount);
      }
    } catch {
      // Best effort
    }
  }, []);

  useEffect(() => {
    window.cloudstream
      ?.getSetting('use_live_streaming_sources', 'true')
      .then((value) => setUseLiveStreams(value !== 'false'));
    window.cloudstream?.getSearchConcurrency?.().then(setConcurrency);
    void checkComponentStatus();
  }, [checkComponentStatus]);


  const handleToggleLiveStreams = async (enabled: boolean) => {
    setUseLiveStreams(enabled);
    await window.cloudstream?.setSetting('use_live_streaming_sources', enabled);
    flash(enabled ? 'Live streaming sources enabled.' : 'Demo fallback mode active.');
  };

  useEffect(() => {
    void window.cloudstream?.getDeleteDownloadPreference().then((response) => {
      if (response?.ok) setDeletePreference(response.preference);
    });
  }, []);

  const handleChangeDeletePreference = async (
    preference: 'ask' | 'list-only' | 'list-and-file'
  ) => {
    setDeletePreference(preference);
    await window.cloudstream?.setDeleteDownloadPreference(preference);
    flash(
      preference === 'ask'
        ? 'You will be asked each time a download is deleted.'
        : preference === 'list-only'
          ? 'Deleting a download now removes it from the list and keeps the file.'
          : 'Deleting a download now removes it from the list and deletes the file.'
    );
  };

  const handleSelectDirectory = async () => {
    const path = await window.cloudstream?.selectDirectory();
    if (path) {
      setDownloadDir(path);
      flash('Download folder updated.');
    }
  };

  const handleImportBackup = async () => {
    const selectedFile = await window.cloudstream?.selectDirectory();
    if (!selectedFile) return;
    const success = await window.cloudstream?.importBackup(selectedFile);
    flash(success ? 'Android backup imported.' : 'Could not import that backup.');
  };

  const handleConcurrency = async (value: number) => {
    const applied = await window.cloudstream?.setSearchConcurrency?.(value);
    if (applied) setConcurrency(applied);
  };

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: React.ReactNode }> = [
    { id: 'general', label: 'General', icon: <Sliders size={14} /> },
    { id: 'player', label: 'Player', icon: <Play size={14} /> },
    {
      id: 'components',
      label: 'Components & Binaries',
      icon: <Cpu size={14} />,
      badge: missingComponentCount > 0 ? (
        <span
          style={{
            marginLeft: '0.4rem',
            padding: '0.1rem 0.45rem',
            borderRadius: '10px',
            fontSize: '0.7rem',
            fontWeight: 700,
            backgroundColor: 'rgba(245, 158, 11, 0.2)',
            color: '#f59e0b',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
          }}
        >
          <AlertTriangle size={10} /> {missingComponentCount} missing
        </span>
      ) : undefined,
    },
    { id: 'sources', label: 'Sources', icon: <Layers size={14} /> },
    { id: 'downloads', label: 'Downloads', icon: <Download size={14} /> },
    { id: 'network', label: 'Connection', icon: <Globe size={14} /> },
    { id: 'advanced', label: 'Advanced', icon: <Wrench size={14} /> },
  ];

  return (
    <div className="settings">
      <header className="settings__head">
        <h2>Settings</h2>
        <p>Components, repositories, storage, and networking. Everything has a sensible default.</p>
      </header>

      <nav className="settings__tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={`settings__tab${tab === entry.id ? ' settings__tab--on' : ''}`}
            onClick={() => {
              setTab(entry.id);
              if (entry.id === 'components') void checkComponentStatus();
            }}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.badge}
          </button>
        ))}
      </nav>

      {statusMessage && <div className="settings__flash">{statusMessage}</div>}

      {tab === 'general' && (
        <>
          <SettingGroup title="Search" icon={<Search size={15} />}>
            <SettingRow
              label="Providers searched at once"
              note={concurrency ? `${concurrency.value} in parallel` : undefined}
              hint={
                <>
                  A search asks every enabled extension provider at the same time and shows
                  results as each one answers. Raising this past your processor’s core count
                  mostly moves the queue rather than removing it; lowering it helps on a slow
                  connection, where many simultaneous scrapes compete for the same bandwidth.
                  Default is {concurrency?.def ?? 8}.
                </>
              }
            >
              {concurrency && (
                <div className="settings__slider">
                  <input
                    type="range"
                    min={concurrency.min}
                    max={concurrency.max}
                    step={1}
                    value={concurrency.value}
                    onChange={(event) => handleConcurrency(Number(event.target.value))}
                    aria-label="Providers searched at once"
                  />
                  <span>{concurrency.value}</span>
                </div>
              )}
            </SettingRow>

            {/*
              Opt-out rather than opt-in: the default is what makes Play feel
              instant, and it is the behaviour most people want. It is offered
              at all because opening a detail page is not a commitment to watch
              — someone on a metered connection should not have to discover
              this by watching their allowance go.
            */}
            <SettingRow
              label="Load sources while you read"
              note={prefetchSources ? 'On' : 'Off'}
              hint={
                <>
                  Starts looking for playable sources a moment after a title’s page opens, so
                  pressing Play usually starts immediately instead of beginning the search
                  then. Results are cached and reused until they expire, and pressing Play
                  during the search joins it rather than starting a second one — so this never
                  costs more than one search. Turning it off means every Play begins from cold.
                </>
              }
            >
              <label className="settings__switch">
                <input
                  type="checkbox"
                  checked={prefetchSources}
                  onChange={async (event) => {
                    const response = await window.cloudstream?.setSourcePrefetchSetting?.(
                      event.target.checked
                    );
                    if (response?.ok) setPrefetchSources(response.enabled);
                  }}
                />
                <span>{prefetchSources ? 'Enabled' : 'Disabled'}</span>
              </label>
            </SettingRow>
          </SettingGroup>

          {/* The home screen: where its catalogue comes from, and what shows on
              it. Grouped with Search under General because both are about what
              the app puts in front of you before you have asked for anything. */}
          <SettingGroup title="Home screen" icon={<Home size={15} />}>
            <HomeSettings />
          </SettingGroup>

          <AdultContentSetting />
        </>
      )}

      {tab === 'player' && (
        <>
          <PlayerSettings />
          {/* Sits under the player tab rather than with subtitle *sources*,
              because this is about reading them, not finding them. */}
          <SubtitleSettings />
        </>
      )}

      {tab === 'components' && <UnifiedComponentManager />}

      {tab === 'sources' && (
        <>
          <SourceSettings />
          {/* Which providers are worth asking, measured rather than assumed.
              Lives under Sources because that is what it is about, and next to
              the enable switches it explains. */}
          <ProviderRankingPanel />
        </>
      )}

      {tab === 'downloads' && (
        <>
          <SettingGroup title="Storage" icon={<HardDrive size={15} />}>
            <SettingRow
              label="Download folder"
              note={downloadDir}
              stacked
              hint="Where finished downloads are written. Existing downloads stay where they are; this only affects new ones."
            >
              <button onClick={handleSelectDirectory} className="btn btn-secondary">
                Change folder
              </button>
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="Removing downloads" icon={<Trash2 size={15} />}>
            <SettingRow
              label="When you delete a download"
              note={
                deletePreference === 'ask'
                  ? 'Ask every time'
                  : deletePreference === 'list-only'
                    ? 'Remove from list, keep the file'
                    : 'Remove from list and delete the file'
              }
              hint={
                <>
                  Removing a download from the list and deleting the file it produced are
                  different actions, and the second cannot be undone — so by default you are
                  asked which one you meant. If you ticked "remember my choice" in that prompt,
                  this is where you turn it back on.
                </>
              }
            >
              <select
                value={deletePreference}
                onChange={(e) =>
                  handleChangeDeletePreference(
                    e.target.value as 'ask' | 'list-only' | 'list-and-file'
                  )
                }
                aria-label="Delete behaviour"
              >
                <option value="ask">Ask every time</option>
                <option value="list-only">Remove from list only</option>
                <option value="list-and-file">Remove from list and delete file</option>
              </select>
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="Download engines" icon={<Zap size={15} />}>
            <SettingRow
              label="aria2c and yt-dlp"
              note="Managed in Components & Binaries"
              hint={
                <>
                  Downloads run through portable copies of <strong>aria2c</strong> (multi-connection
                  downloader) and <strong>yt-dlp</strong> (used when a source needs extracting
                  first). They are managed in the <strong>Components & Binaries</strong> tab.
                </>
              }
            >
              <button
                onClick={() => setTab('components')}
                className="btn btn-secondary"
              >
                <Cpu size={15} />
                <span>Manage Components</span>
              </button>
            </SettingRow>
          </SettingGroup>
        </>
      )}

      {tab === 'network' && <NetworkSettings />}

      {tab === 'advanced' && (
        <>
          {/*
            The tally first, then the transcript.
            One says how many distinct things are wrong; the other says what
            happened most recently. Reading them the other way round is what
            makes 5,407 log lines feel like 5,407 problems.
          */}
          <ExtensionIssuesPanel />
          <DiagnosticsPanel />

          <SettingGroup title="Migration" icon={<RefreshCw size={15} />}>
            <SettingRow
              label="Import an Android backup"
              hint="Reads a CloudStream Android .txt backup and restores watch history, bookmarks and settings from it. Existing entries with the same key are overwritten; device-specific values such as tokens and cache paths are skipped."
            >
              <button onClick={handleImportBackup} className="btn btn-secondary">
                Choose file…
              </button>
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="Developer" icon={<ShieldAlert size={15} />}>
            <SettingRow
              label="Live streaming sources"
              note={useLiveStreams ? 'Live' : 'Demo fallback'}
              hint="Off replaces real source discovery with offline demo streams, for developing without hitting third-party sites. Leave this on unless you are working on the app itself."
            >
              <label className="settings__switch">
                <input
                  type="checkbox"
                  checked={useLiveStreams}
                  onChange={(event) => handleToggleLiveStreams(event.target.checked)}
                />
                <span>{useLiveStreams ? 'On' : 'Off'}</span>
              </label>
            </SettingRow>
          </SettingGroup>
        </>
      )}
    </div>
  );
};
