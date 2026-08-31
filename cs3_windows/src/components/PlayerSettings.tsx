import React, { useEffect, useState } from 'react';
import { useFlash } from '../utils/useFlash';
import { Tv, Play, Cpu, Download, Loader2, PictureInPicture2 } from 'lucide-react';
import { SettingGroup, SettingRow } from './settings/SettingRow';
import { AspectRatioMode } from '../types/player';

/**
 * Settings ▸ Player.
 *
 * Controls optional player toolbar buttons (Aspect Ratio, Playback Speed, and Subtitles)
 * and default playback preferences.
 */
type NativePolicy = 'off' | 'auto' | 'aggressive';

type FloatingMode = 'mini' | 'floating' | 'pip' | 'background';
type BackgroundPlayback = 'continue' | 'audio-only' | 'pause';

/**
 * Plain-language names for the stored values.
 *
 * The stored keys are the engineering words (`pip`, `background`) because they
 * are what the code branches on; nothing a non-technical user reads should be
 * one of them. Kept as a table beside the `<option>` labels rather than derived
 * from them, so the row's summary and the menu cannot drift apart.
 */
const FLOATING_LABELS: Record<FloatingMode, string> = {
  mini: 'Small window in the app',
  floating: 'Floating above other apps',
  pip: 'Picture-in-Picture window',
  background: 'Audio only',
};

const BACKGROUND_LABELS: Record<BackgroundPlayback, string> = {
  continue: 'Keeps playing',
  'audio-only': 'Audio only',
  pause: 'Pauses',
};

export const PlayerSettings: React.FC = () => {
  const [showSpeedControl, setShowSpeedControl] = useState(false);
  const [showAspectControl, setShowAspectControl] = useState(false);
  const [showSubtitlesControl, setShowSubtitlesControl] = useState(true);
  const [defaultAspect, setDefaultAspect] = useState<string>(AspectRatioMode.Fit);
  const [defaultSpeed, setDefaultSpeed] = useState<string>('1');
  const { message: statusMessage, flash: setStatusMessage } = useFlash<string>(3000);

  const [floatingMode, setFloatingMode] = useState<FloatingMode>('mini');
  const [backgroundPlayback, setBackgroundPlayback] = useState<BackgroundPlayback>('continue');
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  useEffect(() => {
    void window.cloudstream?.getPlayerPreferences().then((stored) => {
      if (!stored?.ok) return;
      setFloatingMode(stored.preferences.floatingMode ?? 'mini');
      setBackgroundPlayback(stored.preferences.backgroundPlayback ?? 'continue');
      setAlwaysOnTop(stored.preferences.alwaysOnTop === true);
    });
  }, []);

  /**
   * Written through the same `player:setPreferences` the player itself uses,
   * which merges rather than replacing — so saving a floating mode here does
   * not erase the volume the player wrote a second ago.
   */
  const saveFloating = async (patch: {
    floatingMode?: FloatingMode;
    backgroundPlayback?: BackgroundPlayback;
    alwaysOnTop?: boolean;
  }) => {
    if (patch.floatingMode !== undefined) setFloatingMode(patch.floatingMode);
    if (patch.backgroundPlayback !== undefined) setBackgroundPlayback(patch.backgroundPlayback);
    if (patch.alwaysOnTop !== undefined) setAlwaysOnTop(patch.alwaysOnTop);
    await window.cloudstream?.setPlayerPreferences(patch);
    setStatusMessage('Saved. It applies the next time you minimise the player.');
  };

  /**
   * `null` while the answer is unknown, which is different from "not installed".
   *
   * Rendering "Not installed" during the round trip puts an install button in
   * front of someone who already has the engine, and they click it.
   */
  const [nativeAvailable, setNativeAvailable] = useState<boolean | null>(null);
  const [nativeVersion, setNativeVersion] = useState<string | null>(null);
  const [nativeDecoders, setNativeDecoders] = useState<string[]>([]);
  const [nativePolicy, setNativePolicy] = useState<NativePolicy>('auto');
  const [installingNative, setInstallingNative] = useState(false);
  const [nativeProgress, setNativeProgress] = useState<string | null>(null);

  const flash = (message: string) => {
    setStatusMessage(message);
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

    const loadNative = async () => {
      const [status, policy] = await Promise.all([
        window.cloudstream?.getMpvStatus(),
        window.cloudstream?.getNativeEnginePolicy(),
      ]);
      if (!active) return;
      if (status?.ok) {
        setNativeAvailable(status.status.available);
        setNativeVersion(status.status.version);
        setNativeDecoders(status.status.hardwareDecoders);
      } else {
        setNativeAvailable(false);
      }
      if (policy?.ok) setNativePolicy(policy.policy);
    };
    void loadNative();

    return () => {
      active = false;
    };
  }, []);

  const handleChangeNativePolicy = async (policy: NativePolicy) => {
    setNativePolicy(policy);
    await window.cloudstream?.setNativeEnginePolicy(policy);
    flash(
      policy === 'off'
        ? 'The native engine is off: everything plays in the built-in player.'
        : policy === 'aggressive'
          ? 'The native engine will take every stream the browser cannot play.'
          : 'The native engine will take the streams the built-in player handles badly.'
    );
  };

  const handleInstallNative = async () => {
    setInstallingNative(true);
    setNativeProgress('Starting…');
    /**
     * Progress arrives on the shared binary channel, so it is filtered by
     * component: the ffmpeg install can be running at the same time from the
     * components screen, and showing its percentage here would be a lie.
     */
    const stop = window.cloudstream?.onBinarySetupProgress?.((update) => {
      if (update.component === 'mpv') setNativeProgress(update.status);
    });
    try {
      const result = await window.cloudstream?.setupMpv();
      if (result?.ok) {
        setNativeAvailable(true);
        setNativeVersion(result.status?.version ?? null);
        setNativeDecoders(result.status?.hardwareDecoders ?? []);
        flash('The native playback engine is installed and ready.');
      } else {
        flash(result?.error ?? 'The native playback engine could not be installed.');
      }
    } finally {
      stop?.();
      setInstallingNative(false);
      setNativeProgress(null);
    }
  };

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

      <SettingGroup title="Watching while you do other things" icon={<PictureInPicture2 size={15} />}>
        <SettingRow
          label="When you minimise the player"
          note={FLOATING_LABELS[floatingMode]}
          hint={
            <>
              <strong>Small window in the app</strong> keeps the film in a corner of CloudStream —
              simple, and it disappears behind whatever you switch to.{' '}
              <strong>Floating above other apps</strong> pins the whole CloudStream window on top,
              which works for every kind of stream including 4K files played by the native engine.{' '}
              <strong>Picture-in-Picture</strong> is the browser-style detached window with the
              system's own controls; it is only available for streams playing inside the app, so a
              file handed to the native engine or to VLC falls back to the small window.{' '}
              <strong>Audio only</strong> hides the picture entirely.
            </>
          }
        >
          <select
            value={floatingMode}
            onChange={(e) => void saveFloating({ floatingMode: e.target.value as FloatingMode })}
            aria-label="Minimised player style"
          >
            <option value="mini">Small window in the app</option>
            <option value="floating">Floating above other apps</option>
            <option value="pip">Picture-in-Picture window</option>
            <option value="background">Audio only, no picture</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Keep CloudStream above other windows"
          note={alwaysOnTop ? 'On while minimised' : 'Off'}
          hint={
            <>
              Applies while the player is minimised, and is switched off again the moment you close
              it — a window that stayed pinned after the film ended would be very hard to work out
              how to un-pin. This is the only option that works for every stream, because it changes
              where the window sits rather than moving the picture anywhere.
            </>
          }
        >
          <label className="settings__switch">
            <input
              type="checkbox"
              checked={alwaysOnTop}
              onChange={(e) => void saveFloating({ alwaysOnTop: e.target.checked })}
              aria-label="Keep the window on top"
            />
            <span>{alwaysOnTop ? 'Enabled' : 'Disabled'}</span>
          </label>
        </SettingRow>

        <SettingRow
          label="When the picture is hidden"
          note={BACKGROUND_LABELS[backgroundPlayback]}
          hint={
            <>
              <strong>Keep playing</strong> is what happens today.{' '}
              <strong>Audio only</strong> additionally stops the video being decoded when the
              native engine is playing, which is real work saved on a 4K file; for streams playing
              inside the app there is nothing extra to stop, so it behaves the same as keep
              playing. <strong>Pause</strong> stops the film and starts it again when you come
              back — but only if it was CloudStream that paused it, so a film you paused yourself
              stays paused.
            </>
          }
        >
          <select
            value={backgroundPlayback}
            onChange={(e) =>
              void saveFloating({ backgroundPlayback: e.target.value as BackgroundPlayback })
            }
            aria-label="Background playback"
          >
            <option value="continue">Keep playing</option>
            <option value="audio-only">Audio only</option>
            <option value="pause">Pause until I come back</option>
          </select>
        </SettingRow>
      </SettingGroup>

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

      <SettingGroup title="Native Playback Engine" icon={<Cpu size={15} />}>
        {/**
         * The setting exists because the trade-off is real in both directions,
         * not because there was no defensible default.
         *
         * Routing a stream to mpv buys hardware decoding, full resolution, HDR
         * and the original channel layout — and costs the in-app player: the
         * video renders in the engine's own window, driven from here. That is
         * clearly worth it for a 4K HEVC release the app would otherwise
         * downscale to 1080p at 100% CPU. It is clearly not worth it for a
         * 720p H.264 web-rip that plays perfectly in place. `auto` draws that
         * line; the other two let someone who disagrees say so.
         */}
        <SettingRow
          label="Use the native engine"
          note={
            nativeAvailable === null
              ? 'Checking…'
              : nativeAvailable
                ? nativeVersion ?? 'Installed'
                : 'Not installed'
          }
          hint={
            <>
              Streams the browser cannot decode — 4K and HEVC, 10-bit, HDR, VC-1, MPEG-2,
              DTS-HD and TrueHD — are otherwise re-encoded by FFmpeg, which costs a whole
              CPU core, drops HDR and flattens surround sound to stereo. The native engine
              (mpv) decodes them on the GPU untouched instead, in its own window, driven by
              the controls in the player.
              <br />
              <br />
              <strong>Automatic</strong> hands over what the built-in player would have
              re-encoded or downmixed: 4K, HEVC, 10-bit and HDR video, and any soundtrack with
              more than two channels — which is most 1080p WEB-DL releases, where E-AC-3 5.1
              would otherwise be flattened to stereo.
              <br />
              <strong>Always</strong> also hands over the cases that lose nothing, such as a
              stereo container remux, at the cost of leaving the in-app window more often.
              <br />
              <strong>Never</strong> keeps everything in the built-in player and its FFmpeg
              conversion path, exactly as before this engine existed.
            </>
          }
        >
          <select
            value={nativePolicy}
            onChange={(event) => handleChangeNativePolicy(event.target.value as NativePolicy)}
            aria-label="Native engine policy"
            disabled={nativeAvailable === false}
          >
            <option value="auto">Automatic (recommended)</option>
            <option value="aggressive">Always, when the browser cannot play it</option>
            <option value="off">Never</option>
          </select>
        </SettingRow>

        {nativeAvailable === false && (
          <SettingRow
            label="Install the native engine"
            note={nativeProgress ?? '~32 MB download'}
            hint={
              <>
                Fetches a portable build of mpv into this app's own folder. Nothing is
                installed system-wide and no existing mpv configuration is used or changed.
                This is deliberately not part of "install all components": someone who only
                watches H.264 web releases never needs it.
              </>
            }
          >
            <button
              type="button"
              className="btn"
              onClick={handleInstallNative}
              disabled={installingNative}
            >
              {installingNative ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              {installingNative ? 'Installing…' : 'Install'}
            </button>
          </SettingRow>
        )}

        {nativeAvailable && nativeDecoders.length > 0 && (
          <SettingRow
            label="Hardware decoders available"
            hint={
              <>
                What this build can offer, as reported by mpv. Which one is actually used is
                chosen per stream and shown in the player while it is running — a decoder
                that fails to open falls back to software silently, so the two are not the
                same claim.
              </>
            }
          >
            <span className="setting-row__note">{nativeDecoders.join(', ')}</span>
          </SettingRow>
        )}
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
