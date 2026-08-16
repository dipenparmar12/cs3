import React, { useEffect, useState } from 'react';
import { Tv, Play } from 'lucide-react';
import { SettingGroup, SettingRow } from './settings/SettingRow';
import { AspectRatioMode } from '../types/player';

/**
 * Settings ▸ Player.
 *
 * Controls optional player toolbar buttons (Aspect Ratio, Playback Speed, and Subtitles)
 * and default playback preferences.
 */
export const PlayerSettings: React.FC = () => {
  const [showSpeedControl, setShowSpeedControl] = useState(false);
  const [showAspectControl, setShowAspectControl] = useState(false);
  const [showSubtitlesControl, setShowSubtitlesControl] = useState(true);
  const [defaultAspect, setDefaultAspect] = useState<string>(AspectRatioMode.Fit);
  const [defaultSpeed, setDefaultSpeed] = useState<string>('1');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const flash = (message: string) => {
    setStatusMessage(message);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      if (!window.cloudstream) return;
      try {
        const [
          speedEnabled,
          resizeEnabled,
          customSpeed,
          customAspect,
          savedAspect,
          savedSpeed,
          subsEnabled,
          customSubs,
        ] = await Promise.all([
          window.cloudstream.getSetting('playback_speed_enabled_key', 'false'),
          window.cloudstream.getSetting('player_resize_enabled_key', 'false'),
          window.cloudstream.getSetting('player_show_playback_speed', 'false'),
          window.cloudstream.getSetting('player_show_aspect_ratio', 'false'),
          window.cloudstream.getSetting('default_aspect_ratio', AspectRatioMode.Fit),
          window.cloudstream.getSetting('default_playback_speed', '1'),
          window.cloudstream.getSetting('player_subtitles_enabled_key', 'true'),
          window.cloudstream.getSetting('player_show_subtitles', 'true'),
        ]);
        if (active) {
          setShowSpeedControl(speedEnabled === 'true' || customSpeed === 'true');
          setShowAspectControl(resizeEnabled === 'true' || customAspect === 'true');
          setShowSubtitlesControl(subsEnabled !== 'false' && customSubs !== 'false');
          if (savedAspect) setDefaultAspect(savedAspect);
          if (savedSpeed) setDefaultSpeed(savedSpeed);
        }
      } catch {
        // Defaults
      }
    };
    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const handleToggleSpeed = async (enabled: boolean) => {
    setShowSpeedControl(enabled);
    if (window.cloudstream) {
      await Promise.all([
        window.cloudstream.setSetting('playback_speed_enabled_key', enabled),
        window.cloudstream.setSetting('player_show_playback_speed', enabled),
      ]);
    }
    flash(enabled ? 'Playback speed control enabled in player.' : 'Playback speed control hidden.');
  };

  const handleToggleAspect = async (enabled: boolean) => {
    setShowAspectControl(enabled);
    if (window.cloudstream) {
      await Promise.all([
        window.cloudstream.setSetting('player_resize_enabled_key', enabled),
        window.cloudstream.setSetting('player_show_aspect_ratio', enabled),
      ]);
    }
    flash(enabled ? 'Aspect ratio control enabled in player.' : 'Aspect ratio control hidden.');
  };

  const handleToggleSubtitles = async (enabled: boolean) => {
    setShowSubtitlesControl(enabled);
    if (window.cloudstream) {
      await Promise.all([
        window.cloudstream.setSetting('player_subtitles_enabled_key', enabled),
        window.cloudstream.setSetting('player_show_subtitles', enabled),
      ]);
    }
    flash(enabled ? 'Subtitles control enabled in player.' : 'Subtitles control hidden from player.');
  };

  const handleChangeDefaultAspect = async (val: string) => {
    setDefaultAspect(val);
    await window.cloudstream?.setSetting('default_aspect_ratio', val);
    flash(`Default aspect ratio set to ${val}.`);
  };

  const handleChangeDefaultSpeed = async (val: string) => {
    setDefaultSpeed(val);
    await window.cloudstream?.setSetting('default_playback_speed', val);
    flash(`Default playback speed set to ${val}×.`);
  };

  return (
    <div className="player-settings">
      {statusMessage && <div className="settings__flash">{statusMessage}</div>}

      <SettingGroup title="Optional Player Controls" icon={<Tv size={15} />}>
        <SettingRow
          label="Subtitles selector"
          note={showSubtitlesControl ? 'Visible' : 'Hidden'}
          hint={
            <>
              Adds a subtitle search and selector button to the bottom toolbar in the video player.
              Enabled by default; can be disabled to keep player controls clean and uncluttered.
            </>
          }
        >
          <label className="settings__switch">
            <input
              type="checkbox"
              checked={showSubtitlesControl}
              onChange={(e) => handleToggleSubtitles(e.target.checked)}
              aria-label="Toggle subtitles control"
            />
            <span>{showSubtitlesControl ? 'Enabled' : 'Disabled'}</span>
          </label>
        </SettingRow>

        <SettingRow
          label="Aspect ratio selector"
          note={showAspectControl ? 'Visible' : 'Hidden'}
          hint={
            <>
              Adds an aspect ratio mode menu (Fit, Crop, Stretch, 16:9, 4:3) to the bottom toolbar
              in the video player. Disabled by default to keep player controls clean and uncluttered.
            </>
          }
        >
          <label className="settings__switch">
            <input
              type="checkbox"
              checked={showAspectControl}
              onChange={(e) => handleToggleAspect(e.target.checked)}
              aria-label="Toggle aspect ratio control"
            />
            <span>{showAspectControl ? 'Enabled' : 'Disabled'}</span>
          </label>
        </SettingRow>

        <SettingRow
          label="Playback speed selector"
          note={showSpeedControl ? 'Visible' : 'Hidden'}
          hint={
            <>
              Adds a playback speed menu (0.5× to 2×) to the bottom toolbar in the video player.
              Disabled by default to keep player controls clean and uncluttered.
            </>
          }
        >
          <label className="settings__switch">
            <input
              type="checkbox"
              checked={showSpeedControl}
              onChange={(e) => handleToggleSpeed(e.target.checked)}
              aria-label="Toggle playback speed control"
            />
            <span>{showSpeedControl ? 'Enabled' : 'Disabled'}</span>
          </label>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Playback Defaults" icon={<Play size={15} />}>
        <SettingRow
          label="Default aspect ratio"
          note={defaultAspect}
          hint="The default video scaling / aspect ratio mode used when opening a video stream."
        >
          <select
            value={defaultAspect}
            onChange={(e) => handleChangeDefaultAspect(e.target.value)}
            aria-label="Default aspect ratio"
          >
            {Object.values(AspectRatioMode).map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Default playback speed"
          note={`${defaultSpeed}×`}
          hint="The initial speed when starting playback."
        >
          <select
            value={defaultSpeed}
            onChange={(e) => handleChangeDefaultSpeed(e.target.value)}
            aria-label="Default playback speed"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
              <option key={s} value={String(s)}>
                {s}×
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>

      <NativePlayerSettingsGroup flash={flash} />
    </div>
  );
};

const NativePlayerSettingsGroup: React.FC<{ flash: (msg: string) => void }> = ({ flash }) => {
  const [players, setPlayers] = useState<Array<{ id: string; name: string; path?: string }>>([]);
  const [downloads, setDownloads] = useState<
    Array<{ id: string; name: string; url: string; note: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [showNativeButton, setShowNativeButton] = useState(true);

  const loadPlayers = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await window.cloudstream?.listExternalPlayers?.(refresh);
      setPlayers(res?.players ?? []);
      setDownloads(res?.downloads ?? []);
      const btnEnabled = await window.cloudstream?.getSetting('player_show_native_player_btn', 'true');
      setShowNativeButton(btnEnabled !== 'false');
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPlayers(false);
  }, []);

  const handleToggleNativeButton = async (enabled: boolean) => {
    setShowNativeButton(enabled);
    await window.cloudstream?.setSetting('player_show_native_player_btn', enabled);
    flash(
      enabled
        ? 'Native Player button enabled in player toolbar.'
        : 'Native Player button hidden from player toolbar.'
    );
  };

  return (
    <SettingGroup title="Platform Native & External Players" icon={<Tv size={15} />}>
      <SettingRow
        label="Native player toolbar button"
        note={showNativeButton ? 'Visible' : 'Hidden'}
        hint={
          <>
            Shows a quick one-click button in the player controls to launch streams into platform native
            players (VLC, mpv, IINA, or OS Default). Recommended for 4K 10-bit HEVC, DTS:X, and TrueHD.
          </>
        }
      >
        <label className="settings__switch">
          <input
            type="checkbox"
            checked={showNativeButton}
            onChange={(e) => handleToggleNativeButton(e.target.checked)}
            aria-label="Toggle native player button"
          />
          <span>{showNativeButton ? 'Enabled' : 'Disabled'}</span>
        </label>
      </SettingRow>

      <SettingRow
        label="Detected native players"
        note={`${players.length} available`}
        hint="Desktop players detected on your system (Windows, macOS, Linux)."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {players.map((p) => (
              <span
                key={p.id}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  color: '#60a5fa',
                  fontWeight: 600,
                }}
              >
                {p.name}
              </span>
            ))}
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
            onClick={() => {
              void loadPlayers(true);
              flash('Rescanned installed native players.');
            }}
            disabled={loading}
          >
            {loading ? 'Scanning…' : 'Rescan Players'}
          </button>
        </div>
      </SettingRow>

      {downloads.length > 0 && (
        <SettingRow
          label="Recommended native players"
          note="Free / Open-Source"
          hint="Install any of these players for 100% native decoding of 4K 10-bit HEVC and surround audio codecs."
        >
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {downloads.map((d) => (
              <button
                key={d.id}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem' }}
                title={d.note}
                onClick={() => window.cloudstream?.openExternalLink?.(d.url)}
              >
                Get {d.name}
              </button>
            ))}
          </div>
        </SettingRow>
      )}
    </SettingGroup>
  );
};
