import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Captions, Cpu, Loader2, Maximize, RotateCcw, Volume2 } from 'lucide-react';
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
  /**
   * Transport state, reported up because the player's own control bar is the
   * only transport for this engine and it has no `<video>` to learn from.
   *
   * Without this the play/pause button reads the element's events, which never
   * fire here — so it showed "Play" over a film that was playing, and the first
   * press paused it. The engine is the authority; the button renders what the
   * engine says.
   */
  onPausedChange?: (paused: boolean) => void;
  onEnded?: () => void;
  /** "Play it here instead" — the ffmpeg ladder, forced. */
  onFallbackToBuiltIn?: () => void;
  onError?: (message: string) => void;
}

/** mpv gives a track a title, a language, both or neither. All four read badly raw. */
function trackLabel(track: MpvTrack, index: number): string {
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
  onPausedChange,
  onEnded,
  onFallbackToBuiltIn,
  onError,
}) => {
  const [snapshot, setSnapshot] = useState<MpvSnapshot | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
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

    /**
     * Every snapshot, not one in five seconds.
     *
     * The player's own seek bar is what renders this position now that the
     * stage no longer draws its own, and a five-second throttle made the
     * playhead jump in visible steps while the film ran smoothly beside it.
     * `time-pos` is observed rather than polled, so this is roughly one update
     * a second and costs two `setState` calls.
     */
    if (snapshot.positionSeconds > 0) {
      onProgress?.(snapshot.positionSeconds, snapshot.durationSeconds);
    }

    /**
     * Anything that is not `playing` reads as paused to the control bar.
     * Buffering is deliberately *not* folded into the player's `isBuffering`:
     * that flag drives an overlay that says "Buffering from peers…", which is a
     * torrent's story and a lie about an HTTP stream. The stage says so itself.
     */
    onPausedChange?.(snapshot.paused || snapshot.state !== 'playing');

    if (snapshot.state === 'ended' && !endedRef.current) {
      endedRef.current = true;
      onEnded?.();
    }
  }, [snapshot, onProgress, onPausedChange, onEnded, onError]);

  const loading = !snapshot || snapshot.state === 'loading' || snapshot.state === 'buffering';

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

  /**
   * A failed engine renders nothing, and that is the fix rather than an
   * omission.
   *
   * This used to draw its own full-bleed `.player__overlay` *and* report the
   * same failure through `onError`, so `VideoPlayer` drew one too: two
   * translucent black panels stacked, each dimming the other, with two
   * different sentences about a single failure showing through each other. The
   * player owns the error surface now — one message, and every action that
   * might actually help beside it.
   */
  if (openError) return null;

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
          the original audio layout are preserved. The player controls below drive it.
        </span>

        {/*
          Only what the player's own control bar cannot do.

          There used to be a full transport row along the bottom of this stage —
          play, seek, volume, mute, tracks, fullscreen — and it was a duplicate
          of the player's, which already routes every one of those to mpv (see
          `togglePlay`, `seekTo` and the volume effect in `VideoPlayer`). Worse,
          it was *unusable*: `.player__controls` is `z-index: 5` and pinned to
          the bottom, this stage is `z-index: 3`, so the whole row sat underneath
          it, swallowing nothing and receiving no clicks — the reported
          "controls that cannot be clicked". Its overflow is also what produced
          the horizontal scrollbar with nothing to scroll to.

          What is genuinely mpv-only is track selection and fullscreening mpv's
          own window, so that is all that is left, and it sits in the surface
          where nothing covers it.
        */}
        {!loading && (
          <div className="native-stage__tracks">
            {(snapshot?.audioTracks.length ?? 0) > 1 && (
              <label className="native-stage__field">
                <Volume2 size={13} />
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
              </label>
            )}

            {(snapshot?.subtitleTracks.length ?? 0) > 0 && (
              <label className="native-stage__field">
                <Captions size={13} />
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
                  <option value="">Subtitles off</option>
                  {snapshot?.subtitleTracks.map((track, index) => (
                    <option key={track.id} value={track.id}>
                      {trackLabel(track, index)}
                      {track.external ? ' (added)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                void window.cloudstream?.mpvSetFullscreen(!(snapshot?.fullscreen ?? false))
              }
              title="Fullscreen the engine's own window"
            >
              <Maximize size={14} /> Fullscreen
            </button>

            {onFallbackToBuiltIn && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onFallbackToBuiltIn}
                title="Convert this stream and play it inside the app window instead"
              >
                <RotateCcw size={14} /> Play in this window
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
