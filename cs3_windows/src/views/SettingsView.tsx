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
  Scale,
  List,
  Archive,
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
import {
  SettingsLevelProvider,
  type SettingsLevel,
} from '../components/settings/SettingsLevelContext';
import { useFlash } from '../utils/useFlash';
import { DiagnosticsPanel } from '../components/settings/DiagnosticsPanel';
import { ExtensionIssuesPanel } from '../components/settings/ExtensionIssuesPanel';
import { AboutPanel } from '../components/settings/AboutPanel';
import { BackupPanel } from '../components/settings/BackupPanel';

/**
 * `all` is a view, not a category.
 *
 * Every other tab answers one question and hides the rest, which is right for
 * changing a setting you already know the name of and wrong for the two other
 * things people do here: finding a setting they half-remember, and checking
 * what the app is currently configured to do. Both need one page. `all` renders
 * exactly the same groups the tabs do, in tab order, with a heading before each
 * — no second copy of any control, so the two views cannot disagree.
 */
type TabId =
  | 'all'
  | 'general'
  | 'player'
  | 'components'
  | 'sources'
  | 'downloads'
  | 'network'
  | 'advanced';

interface SettingsViewProps {
  hasBinaries?: boolean;
  onOpenBinarySetup?: () => void;
  /** Which pane to open on, for a deep link from the application menu. */
  initialTab?: TabId;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab }) => {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'general');

  /**
   * Simple by default, and remembered.
   *
   * The default matters more than the mechanism. Someone opening this screen
   * for the first time is being asked, implicitly, which of forty rows they are
   * supposed to have an opinion about — and the honest answer for most people
   * is about eight. Starting at Simple makes that the question; starting at
   * Everything makes it their problem.
   *
   * Stored in `localStorage` rather than the datastore because it is a property
   * of how this person reads a screen, not of how the app behaves, and it has
   * no business travelling in a backup to a machine somebody else uses.
   */
  const [level, setLevel] = useState<SettingsLevel>(() => {
    try {
      return localStorage.getItem('cs3.settings.level') === 'everything'
        ? 'everything'
        : 'simple';
    } catch {
      // Private windows and blocked site data both throw here.
      return 'simple';
    }
  });

  const changeLevel = (next: SettingsLevel) => {
    setLevel(next);
    try {
      localStorage.setItem('cs3.settings.level', next);
    } catch {
      // A preference that cannot be stored still applies for this session.
    }
  };
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
  const [torrentMirrors, setTorrentMirrors] = useState(true);
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
    window.cloudstream
      ?.getSetting('torrent_http_metadata_cache', 'true')
      .then((value) => setTorrentMirrors(value !== 'false'));
    window.cloudstream?.getSearchConcurrency?.().then(setConcurrency);
    void checkComponentStatus();
  }, [checkComponentStatus]);


  const handleToggleLiveStreams = async (enabled: boolean) => {
    setUseLiveStreams(enabled);
    await window.cloudstream?.setSetting('use_live_streaming_sources', enabled);
    flash(enabled ? 'Live streaming sources enabled.' : 'Demo fallback mode active.');
  };

  const handleToggleTorrentMirrors = async (enabled: boolean) => {
    setTorrentMirrors(enabled);
    // The engine reads this key per magnet rather than at construction, so
    // there is nothing to restart and the confirmation can say so.
    await window.cloudstream?.setSetting('torrent_http_metadata_cache', enabled);
    flash(
      enabled
        ? 'Torrent details may be fetched from public mirrors.'
        : 'Torrent details will come from the swarm only.'
    );
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

  /** True on that tab, and on the everything view. */
  const shows = (id: TabId) => tab === id || tab === 'all';
  /** The heading that separates sections when they are all on one page. */
  const sectionTitle = (id: TabId, label: string) =>
    tab === 'all' ? <h3 className="settings__section" id={`settings-${id}`}>{label}</h3> : null;

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode; badge?: React.ReactNode }> = [
    { id: 'all', label: 'All settings', icon: <List size={14} /> },
    { id: 'general', label: 'General', icon: <Sliders size={14} /> },
    { id: 'player', label: 'Playback', icon: <Play size={14} /> },
    {
      id: 'components',
      // "Components & Binaries" names two implementation words and no outcome.
      // What this tab is actually for is checking the app has what it needs to
      // play and download, and installing it if not.
      label: 'Setup & repair',
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
    { id: 'sources', label: 'Where films come from', icon: <Layers size={14} /> },
    { id: 'downloads', label: 'Downloads', icon: <Download size={14} /> },
    { id: 'network', label: 'Connection', icon: <Globe size={14} /> },
    { id: 'advanced', label: 'Advanced & diagnostics', icon: <Wrench size={14} /> },
  ];

  return (
    <SettingsLevelProvider level={level}>
    <div className="settings">
      <header className="settings__head">
        <h2>Settings</h2>
        <p>
          Everything here has a sensible default — you can watch films without changing any of it.
        </p>
        {/*
          The level switch, at the top and stating what it is holding back.
          A filtered list that does not say it is filtered is the same bug as a
          scoped search that does not say it is scoped: the user cannot tell a
          setting they cannot find from one that does not exist.
        */}
        <div className="settings__level" role="group" aria-label="How much to show">
          <button
            type="button"
            className={`settings__level-btn${level === 'simple' ? ' settings__level-btn--on' : ''}`}
            aria-pressed={level === 'simple'}
            onClick={() => changeLevel('simple')}
          >
            Just the essentials
          </button>
          <button
            type="button"
            className={`settings__level-btn${
              level === 'everything' ? ' settings__level-btn--on' : ''
            }`}
            aria-pressed={level === 'everything'}
            onClick={() => changeLevel('everything')}
          >
            Everything
          </button>
          <span className="settings__level-note">
            {level === 'simple'
              ? 'Technical options are hidden. Nothing is switched off — they still apply.'
              : 'Showing every option, including ones that need some knowledge of how the app works.'}
          </span>
        </div>
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

      {shows('general') && (
        <>
          {sectionTitle('general', 'General')}
          <SettingGroup title="Search" icon={<Search size={15} />}>
            <SettingRow
              label="Providers searched at once"
          level="advanced"
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

      {shows('player') && (
        <>
          {sectionTitle('player', 'Player')}
          <PlayerSettings />
          {/* Sits under the player tab rather than with subtitle *sources*,
              because this is about reading them, not finding them. */}
          <SubtitleSettings />
        </>
      )}

      {shows('components') && (
        <>
          {sectionTitle('components', 'Components & Binaries')}
          <UnifiedComponentManager />
        </>
      )}

      {shows('sources') && (
        <>
          {sectionTitle('sources', 'Sources')}
          <SourceSettings />
          {/* Which providers are worth asking, measured rather than assumed.
              Lives under Sources because that is what it is about, and next to
              the enable switches it explains. */}
          <ProviderRankingPanel />
        </>
      )}

      {shows('downloads') && (
        <>
          {sectionTitle('downloads', 'Downloads')}
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
          level="advanced"
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

      {shows('network') && (
        <>
          {sectionTitle('network', 'Connection')}
          <NetworkSettings />

          {/*
            This is here rather than buried in a config file because it is the
            one torrent behaviour that talks to a third party by name. The
            module that implements it argues — correctly — that the marginal
            exposure is small next to the DHT broadcast and the dozen tracker
            announces pressing Play already makes. That argument is only worth
            anything if the person it is being made to can act on it, and until
            now the key had no writer anywhere in the app.
          */}
          <SettingGroup title="Torrents" icon={<Globe size={15} />}>
            <SettingRow
              label="Fetch torrent details from public mirrors"
          level="advanced"
              note={torrentMirrors ? 'On' : 'DHT and trackers only'}
              hint="Asks itorrents.org and btcache.me for a magnet's file list over HTTPS while the swarm is still being found, which usually saves five to thirty seconds before playback can start. It sends them the infohash — the same identifier the DHT and every tracker already receive when you press Play. Turn it off to keep torrent activity to the BitTorrent network alone; startup is slower and nothing else changes."
            >
              <label className="settings__switch">
                <input
                  type="checkbox"
                  checked={torrentMirrors}
                  onChange={(event) => handleToggleTorrentMirrors(event.target.checked)}
                />
                <span>{torrentMirrors ? 'On' : 'Off'}</span>
              </label>
            </SettingRow>
          </SettingGroup>
        </>
      )}

      {shows('advanced') && (
        <>
          {sectionTitle('advanced', 'Advanced')}
          {/*
            The tally first, then the transcript.
            One says how many distinct things are wrong; the other says what
            happened most recently. Reading them the other way round is what
            makes 5,407 log lines feel like 5,407 problems.
          */}
          {/*
            Both are transcripts of the app's own internals — class names, HTTP
            statuses, sidecar stack frames — and they are the largest single
            source of jargon on this screen. They stay one click away under
            Everything rather than being removed, because they are also the
            first thing to ask for when something goes wrong.
          */}
          {level === 'everything' && (
            <>
              <ExtensionIssuesPanel />
              <DiagnosticsPanel />
            </>
          )}

          <SettingGroup title="Migration" icon={<RefreshCw size={15} />} level="advanced">
            <SettingRow
              label="Import an Android backup"
              hint="Reads a CloudStream Android .txt backup and restores watch history, bookmarks and settings from it. Existing entries with the same key are overwritten; device-specific values such as tokens and cache paths are skipped."
            >
              <button onClick={handleImportBackup} className="btn btn-secondary">
                Choose file…
              </button>
            </SettingRow>
          </SettingGroup>

          <SettingGroup title="Developer" icon={<ShieldAlert size={15} />} level="advanced">
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

          {/*
            Your data, in one file, and the way back from one. Above the
            Android-format import below it, which is a different job: that moves
            settings between the phone app and this one.
          */}
          <SettingGroup title="Back up and restore" icon={<Archive size={15} />}>
            <BackupPanel />
          </SettingGroup>

          {/*
            Reachable from a packaged build, where the repository's LICENSE and
            THIRD-PARTY-NOTICES.md are not. GPL-3.0 §6 asks that whoever has the
            binary can find the source; a notice nobody can open does not do it.
          */}
          <SettingGroup title="About and licences" icon={<Scale size={15} />}>
            <div id="settings-about">
              <AboutPanel />
            </div>
          </SettingGroup>
        </>
      )}
    </div>
    </SettingsLevelProvider>
  );
};
