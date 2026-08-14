import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { MediaComponentsCard } from '../components/MediaComponentsCard';
import { SourceSettings } from '../components/SourceSettings';
import { NetworkSettings } from '../components/NetworkSettings';
import { AdultContentSetting } from '../components/AdultContentSetting';
import { SettingGroup, SettingRow } from '../components/settings/SettingRow';
import { DiagnosticsPanel } from '../components/settings/DiagnosticsPanel';

/**
 * Settings, organised so the first look is calm.
 *
 * The previous screen was six full-width cards stacked vertically, each with a
 * heading, an icon and a paragraph of explanation, all permanently visible.
 * Everything had the same visual weight, so nothing was findable and the two
 * controls most people ever touch — where downloads go, and whether the
 * connection is the problem — were somewhere in the middle of a wall of prose.
 *
 * Three changes, no options removed:
 *
 *  - **Tabs.** One area at a time. Playback and Sources are separate concerns
 *    and were never worth scrolling past each other.
 *  - **Uniform rows.** Label left, control right, so a section can be scanned
 *    instead of read.
 *  - **Explanations behind an ⓘ.** The prose is still there, and it is still
 *    accurate; it is just not shouted at someone who already knows what a
 *    download folder is.
 */

type TabId = 'general' | 'sources' | 'downloads' | 'network' | 'advanced';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <Sliders size={14} /> },
  { id: 'sources', label: 'Sources', icon: <Layers size={14} /> },
  { id: 'downloads', label: 'Downloads', icon: <Download size={14} /> },
  { id: 'network', label: 'Connection', icon: <Globe size={14} /> },
  { id: 'advanced', label: 'Advanced', icon: <Cpu size={14} /> },
];

interface SettingsViewProps {
  hasBinaries?: boolean;
  onOpenBinarySetup?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  hasBinaries = true,
  onOpenBinarySetup,
}) => {
  const [tab, setTab] = useState<TabId>('general');
  const [downloadDir, setDownloadDir] = useState('%USERPROFILE%\\Downloads\\CloudStream');
  const [useLiveStreams, setUseLiveStreams] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState<{
    value: number;
    min: number;
    max: number;
    def: number;
  } | null>(null);

  useEffect(() => {
    window.cloudstream
      ?.getSetting('use_live_streaming_sources', 'true')
      .then((value) => setUseLiveStreams(value !== 'false'));
    window.cloudstream?.getSearchConcurrency?.().then(setConcurrency);
  }, []);

  const flash = (message: string) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleToggleLiveStreams = async (enabled: boolean) => {
    setUseLiveStreams(enabled);
    await window.cloudstream?.setSetting('use_live_streaming_sources', enabled);
    flash(enabled ? 'Live streaming sources enabled.' : 'Demo fallback mode active.');
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

  return (
    <div className="settings">
      <header className="settings__head">
        <h2>Settings</h2>
        <p>Sources, downloads and connection. Everything has a sensible default.</p>
      </header>

      <nav className="settings__tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            className={`settings__tab${tab === entry.id ? ' settings__tab--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.icon}
            {entry.label}
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
          </SettingGroup>

          <AdultContentSetting />
        </>
      )}

      {tab === 'sources' && <SourceSettings />}

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

          <SettingGroup title="Download engines" icon={<Zap size={15} />}>
            <SettingRow
              label="aria2c and yt-dlp"
              note={hasBinaries ? 'Installed and ready' : 'Not installed yet'}
              hint={
                <>
                  Downloads run through portable copies of <strong>aria2c</strong> (multi-connection
                  downloader) and <strong>yt-dlp</strong> (used when a source needs extracting
                  first). They are fetched on demand and stored with the app — nothing is
                  installed system-wide.
                </>
              }
            >
              <button
                onClick={onOpenBinarySetup}
                className={`btn ${hasBinaries ? 'btn-secondary' : 'btn-primary'}`}
              >
                <Download size={15} />
                <span>{hasBinaries ? 'Reinstall' : 'Set up now'}</span>
              </button>
            </SettingRow>
          </SettingGroup>
        </>
      )}

      {tab === 'network' && <NetworkSettings />}

      {tab === 'advanced' && (
        <>
          <DiagnosticsPanel />

          <MediaComponentsCard />

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
