import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Captions,
  Cpu,
  Loader2,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { MpvSnapshot, MpvTrack } from '../../types/mpv';
import type { SourceCapabilityModel } from '../../types/media';

/**
 * The player surface for a stream the browser cannot decode.
 *
 * When `media:prepare` answers `NATIVE_MPV` there is no `<video>` element in the
 * picture at all — mpv has the stream, on the GPU, in its own window. What is
 * left in the app is everything a `<video>` would have given us for free and now
 * has to arrive over IPC: the timeline, the buffer, the track lists, and the
 * knowledge that playback ended so the next episode can start.
 *
 * That is why this renders from {@link MpvSnapshot} pushes rather than local
 * state. The engine is the authority on where playback is — it has the decoder's
 * own clock — and a UI keeping its own position would drift against it within a
 * minute and disagree with it after every seek.
 *
 * **Nothing here can start playback from a raw URL.** The `url` prop is whatever
 * `media:prepare` returned, which is the proxied loopback address of a source
 * that has already been inspected. Adding a path that opened an unclassified
 * link would reintroduce PRD-37's original race in a new engine.
 */

interface NativeEngineStageProps {
  /** The prepared playback URL — proxied, inspected, and never a raw provider link. */
  url: string;
  headers?: Record<string, string>;
  title: string;
  capability: SourceCapabilityModel;
  /** Resume point, applied at load so the first frame is already in place. */
  startSeconds?: number;
  initialVolume: number;
  initialMuted: boolean;
  /** Subtitles chosen in the app, attached to the engine as external tracks. */
  externalSubtitles?: Array<{ name: string; url: string; language?: string }>;
  /** Position reporting, so watch progress survives a stream we do not render. */
  onProgress?: (positionSeconds: number, durationSeconds: number) => void;
  onEnded?: () => void;
  /** "Play it here instead" — the ffmpeg ladder, forced. */
  onFallbackToBuiltIn?: () => void;
  onError?: (message: string) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** mpv gives a track a title, a language, both or neither. All four read badly raw. */
export function trackLabel(track: MpvTrack, index: number): string {
  const parts = [
    track.title,
    track.language && track.language !== 'und' ? track.language.toUpperCase() : null,
    track.channels ? `${track.channels}ch` : null,
    track.codec,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : `Track ${index + 1}`;
}

export const NativeEngineStage: React.FC<NativeEngineStageProps> = ({
  url,
  headers,
  title,
  capability,
  startSeconds,
  initialVolume,
  initialMuted,
  externalSubtitles,
  onProgress,
  onEnded,
  onFallbackToBuiltIn,
  onError,
}) => {
  const [snapshot, setSnapshot] = useState<MpvSnapshot | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /**
   * The seek being dragged, held locally.
   *
   * The one piece of state the engine is *not* the authority on: while a thumb
   * is under the finger, snapshots are still arriving from the old position and
   * rendering them would drag the handle back out from under the pointer.
   */
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const endedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = window.cloudstream?.onMpvUpdate((next) => setSnapshot(next));
    void window.cloudstream?.getMpvSnapshot().then((response) => {
      if (response?.ok && response.snapshot?.sessionId) setSnapshot(response.snapshot);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    endedRef.current = false;
    setOpenError(null);

    void (async () => {
      const result = await window.cloudstream?.openInNativeEngine({
        url,
        headers,
        title,
        startSeconds,
        volume: initialMuted ? 0 : Math.round(initialVolume * 100),
      });
      if (cancelled) return;
      if (!result?.ok) {
        const message = result?.error ?? 'The native playback engine could not be started.';
        setOpenError(message);
        onError?.(message);
        return;
      }
      /**
       * Subtitles are attached after the load rather than folded into it because
       * there can be several, and `sub-file` names one. The first is selected;
       * the rest sit in the menu.
       */
      for (const subtitle of externalSubtitles ?? []) {
        await window.cloudstream?.mpvAddSubtitle(subtitle.url, subtitle.name, subtitle.language);
      }
    })();

    return () => {
      cancelled = true;
      /**
       * Stopped, not quit. The process stays idle so the next episode loads in a
       * few hundred milliseconds instead of paying for a window and a GPU
       * context again — see `MpvEngine.open`.
       */
      void window.cloudstream?.mpvStop();
    };
    // Re-opening on a volume change would restart the film.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Progress and end-of-file, reported up so the library and next-episode logic
  // behave exactly as they do for a stream we render ourselves.
  useEffect(() => {
    if (!snapshot) return;

    if (snapshot.state === 'error' && snapshot.error) {
      setOpenError(snapshot.error);
      onError?.(snapshot.error);
      return;
    }

    if (snapshot.positionSeconds >= 0) {
      onProgress?.(snapshot.positionSeconds, snapshot.durationSeconds);
    }

    if (snapshot.state === 'ended' && !endedRef.current) {
      endedRef.current = true;
      onEnded?.();
    }
  }, [snapshot, onProgress, onEnded, onError]);

  const paused = snapshot?.paused ?? false;
  const duration = snapshot?.durationSeconds ?? 0;
  const position = scrubbing ?? snapshot?.positionSeconds ?? 0;
  const buffered = snapshot?.bufferedSeconds ?? 0;
  const loading = !snapshot || snapshot.state === 'loading' || snapshot.state === 'buffering';

  const togglePlay = useCallback(() => {
    void window.cloudstream?.mpvSetPaused(!paused);
  }, [paused]);

  const commitSeek = useCallback((seconds: number) => {
    setScrubbing(null);
    void window.cloudstream?.mpvSeek(seconds);
  }, []);

  const video = capability.metadata?.video;
  const decoderNote = useMemo(() => {
    if (!snapshot || !snapshot.videoCodec) return null;
    const bits = [
      snapshot.width && snapshot.height ? `${snapshot.width}×${snapshot.height}` : null,
      snapshot.videoCodec,
      snapshot.pixelFormat?.includes('10') ? '10-bit' : null,
      snapshot.colorTransfer === 'pq' || snapshot.colorTransfer === 'hlg' ? 'HDR' : null,
      snapshot.audioCodec || null,
      /**
       * The decoder actually chosen, not the setting. `auto-safe` falls back to
       * software without saying so, and that fallback is the first thing worth
       * knowing when someone reports that a 4K file stutters.
       */
      snapshot.hardwareDecoder && snapshot.hardwareDecoder !== 'no'
        ? `${snapshot.hardwareDecoder} (GPU)`
        : 'software decoding',
    ].filter(Boolean);
    return bits.join(' · ');
  }, [snapshot]);

  if (openError) {
    return (
      <div className="player__overlay native-stage__error">
        <AlertTriangle size={34} />
        <p>{openError}</p>
        <span className="muted">
          {capability.explanation}
        </span>
        {onFallbackToBuiltIn && (
          <button type="button" className="btn" onClick={onFallbackToBuiltIn}>
            <RotateCcw size={15} /> Convert and play here instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="native-stage">
      <div className="native-stage__surface">
        {loading ? (
          <>
            <Loader2 className="spin" size={36} />
            <p>Starting the native engine…</p>
          </>
        ) : (
          <>
            <Cpu size={34} />
            <p>Playing in the native engine window</p>
          </>
        )}
        <span className="muted native-stage__detail">
          {decoderNote ??
            (video
              ? `${video.codec.toUpperCase()} ${video.bitDepth > 8 ? `${video.bitDepth}-bit ` : ''}${video.width}×${video.height}`
              : capability.explanation)}
        </span>
        <span className="muted native-stage__why">
          {/**
           * Why the video is not in this window is the question a viewer will
           * actually have, so it is answered on the surface rather than in a
           * tooltip. Nothing re-encodes here, which is the whole benefit.
           */}
          This stream is decoded on the GPU, untouched — full resolution, HDR and
          the original audio layout are preserved. The controls below drive it.
        </span>
        {onFallbackToBuiltIn && (
          <button type="button" className="btn btn--ghost" onClick={onFallbackToBuiltIn}>
            <RotateCcw size={14} /> Convert and play in this window instead
          </button>
        )}
      </div>

      <div className="native-stage__controls">
        <button type="button" className="player__btn" onClick={togglePlay} title={paused ? 'Play' : 'Pause'}>
          {paused ? <Play size={18} /> : <Pause size={18} />}
        </button>

        <span className="native-stage__time">{formatTime(position)}</span>
        <div className="native-stage__seek">
          <progress
            className="native-stage__buffer"
            max={Math.max(duration, 1)}
            value={Math.min(buffered, duration || buffered)}
          />
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={position}
            onChange={(event) => setScrubbing(Number(event.target.value))}
            onMouseUp={(event) => commitSeek(Number((event.target as HTMLInputElement).value))}
            onTouchEnd={(event) => commitSeek(Number((event.target as HTMLInputElement).value))}
            aria-label="Seek"
          />
        </div>
        <span className="native-stage__time">{formatTime(duration)}</span>

        <button
          type="button"
          className="player__btn"
          onClick={() => void window.cloudstream?.mpvSetMuted(!(snapshot?.muted ?? false))}
          title={snapshot?.muted ? 'Unmute' : 'Mute'}
        >
          {snapshot?.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          className="native-stage__volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(snapshot?.volume ?? 100)}
          onChange={(event) => void window.cloudstream?.mpvSetVolume(Number(event.target.value))}
          aria-label="Volume"
        />

        {(snapshot?.audioTracks.length ?? 0) > 1 && (
          <select
            className="native-stage__select"
            value={snapshot?.selectedAudioId ?? ''}
            onChange={(event) =>
              void window.cloudstream?.mpvSetAudioTrack(Number(event.target.value))
            }
            aria-label="Audio track"
          >
            {snapshot?.audioTracks.map((track, index) => (
              <option key={track.id} value={track.id}>
                {trackLabel(track, index)}
              </option>
            ))}
          </select>
        )}

        {(snapshot?.subtitleTracks.length ?? 0) > 0 && (
          <select
            className="native-stage__select"
            value={snapshot?.selectedSubtitleId ?? ''}
            onChange={(event) =>
              void window.cloudstream?.mpvSetSubtitleTrack(
                event.target.value === '' ? null : Number(event.target.value)
              )
            }
            aria-label="Subtitles"
          >
            <option value="">
              <Captions size={12} /> Subtitles off
            </option>
            {snapshot?.subtitleTracks.map((track, index) => (
              <option key={track.id} value={track.id}>
                {trackLabel(track, index)}
                {track.external ? ' (added)' : ''}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="player__btn"
          onClick={() => void window.cloudstream?.mpvSetFullscreen(!(snapshot?.fullscreen ?? false))}
          title="Fullscreen"
        >
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
};
