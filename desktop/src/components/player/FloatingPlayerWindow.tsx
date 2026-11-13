import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowUpLeft,
  Captions,
  Pause,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { FloatingPlayerPayload } from '../../types/player';
import { formatTimecode } from '../../utils/format';
import { subtitleCssVariables } from '../../utils/subtitleStyle';
import { isEmergencyBlurEvent } from '../../utils/emergencyBlur';
import { isPointerTap } from './miniPlayerModel';

const SKIP_SECONDS = 10;
const FINE_SKIP_SECONDS = 3;
const LONG_SKIP_SECONDS = 30;
const VOLUME_STEP = 0.05;

type OsdState =
  | { kind: 'play'; paused: boolean }
  | { kind: 'seek'; delta: number; position: number; duration: number }
  | { kind: 'volume'; volume: number; muted: boolean }
  | { kind: 'speed'; speed: number }
  | { kind: 'text'; primary: string; secondary?: string };

function atTime(url: string, seconds: number): string {
  const [base] = url.split('?');
  return seconds > 0 ? `${base}?t=${Math.floor(seconds)}` : base;
}

/**
 * Detached Windows-level floating mini player window (`?floatingPlayer=1`).
 *
 * Runs as an independent frameless, always-on-top Electron `BrowserWindow` so
 * OS window focus stays with the player when clicked and every keyboard
 * shortcut (`Space`, `ArrowUp`/`ArrowDown`, `ArrowLeft`/`ArrowRight`, `M`,
 * `Escape`, `F`, wheel scroll) works directly inside the floating window.
 */
export const FloatingPlayerWindow: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const osdTimerRef = useRef<number | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);

  const [payload, setPayload] = useState<FloatingPlayerPayload | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackOffset, setPlaybackOffset] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [activeSubtitleUrl, setActiveSubtitleUrl] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [osd, setOsd] = useState<OsdState | null>(null);
  const [loading, setLoading] = useState(true);

  const playbackOffsetRef = useRef(0);
  playbackOffsetRef.current = playbackOffset;

  const durationRef = useRef(0);
  durationRef.current = duration;

  const activeSubtitleUrlRef = useRef<string | null>(null);
  activeSubtitleUrlRef.current = activeSubtitleUrl;

  const payloadRef = useRef<FloatingPlayerPayload | null>(null);
  payloadRef.current = payload;

  const showOsd = useCallback((next: OsdState) => {
    setOsd(next);
    if (osdTimerRef.current) window.clearTimeout(osdTimerRef.current);
    osdTimerRef.current = window.setTimeout(() => setOsd(null), 1100);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) window.clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 2200);
  }, []);

  const reportNow = useCallback((ended = false) => {
    const video = videoRef.current;
    if (!video || !payloadRef.current) return;
    const position = playbackOffsetRef.current + (video.currentTime || 0);
    const total =
      durationRef.current > 0
        ? durationRef.current
        : Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : payloadRef.current.duration;
    window.cloudstream?.reportFloatingPlayerState({
      currentTime: position,
      duration: total,
      paused: video.paused,
      volume: video.volume,
      muted: video.muted,
      speed: video.playbackRate || 1,
      ended,
      activeSubtitleUrl: activeSubtitleUrlRef.current,
    });
  }, []);

  useEffect(() => {
    const api = window.cloudstream;
    if (!api) return;
    const offPayload = api.onFloatingPlayerPayload((next) => {
      setPayload(next);
      setDuration(next.duration);
      setVolume(next.volume);
      setMuted(next.muted);
      setSpeed(next.speed || 1);
      setActiveSubtitleUrl(next.activeSubtitleUrl);
      setIsPlaying(!next.paused);
      revealControls();
    });
    const offOnTop = api.onFloatingPlayerOnTopChanged((onTop) => {
      setAlwaysOnTop(onTop);
    });
    void api.floatingPlayerReady();
    return () => {
      offPayload();
      offOnTop();
    };
  }, [revealControls]);

  // Attach the stream whenever `payload.playbackUrl` changes.
  const playbackUrl = payload?.playbackUrl ?? '';
  const strategy = payload?.strategy ?? 'DIRECT';
  const isConverted = payload?.isConverted ?? false;

  useEffect(() => {
    const video = videoRef.current;
    const current = payloadRef.current;
    if (!video || !current || !playbackUrl) return;

    let cancelled = false;
    setLoading(true);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const startOffset = isConverted ? Math.max(0, Math.floor(current.currentTime)) : 0;
    setPlaybackOffset(startOffset);
    setCurrentTime(current.currentTime);
    setDuration(current.duration);

    video.volume = Math.max(0, Math.min(1, current.volume));
    video.muted = current.muted;
    video.playbackRate = current.speed || 1;

    const targetUrl = isConverted ? atTime(playbackUrl, startOffset) : playbackUrl;

    if (strategy === 'HLS_NATIVE' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        startPosition: current.currentTime > 0 ? current.currentTime : -1,
      });
      hlsRef.current = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        video.playbackRate = current.speed || 1;
        if (!current.paused) {
          void video.play().catch(() => {});
        }
      });
    } else {
      video.src = targetUrl;
      const applyInitialTime = () => {
        if (cancelled) return;
        if (!isConverted && current.currentTime > 0 && Number.isFinite(video.duration)) {
          video.currentTime = Math.min(current.currentTime, Math.max(0, video.duration - 0.5));
        }
        video.playbackRate = current.speed || 1;
        if (!current.paused) {
          void video.play().catch(() => {});
        }
      };
      if (video.readyState >= 1) {
        applyInitialTime();
      } else {
        video.addEventListener('loadedmetadata', applyInitialTime, { once: true });
      }
    }

    containerRef.current?.focus({ preventScroll: true });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [playbackUrl, strategy, isConverted]);

  const subtitles = payload?.subtitles;

  // Sync `<track>` modes with `activeSubtitleUrl`.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitles) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const sub = subtitles[i];
      tracks[i].mode = sub && sub.url === activeSubtitleUrl ? 'showing' : 'disabled';
    }
  }, [activeSubtitleUrl, subtitles]);

  // Sync state to main window periodically while playing.
  useEffect(() => {
    if (!payload) return;
    const id = window.setInterval(() => reportNow(false), 500);
    return () => window.clearInterval(id);
  }, [payload, reportNow]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
      showOsd({ kind: 'play', paused: false });
    } else {
      video.pause();
      showOsd({ kind: 'play', paused: true });
    }
    revealControls();
  }, [revealControls, showOsd]);

  const seekTo = useCallback(
    (targetSeconds: number) => {
      const video = videoRef.current;
      const currentPayload = payloadRef.current;
      if (!video || !currentPayload) return;
      const total = durationRef.current || currentPayload.duration || 0;
      const clamped = total > 0 ? Math.max(0, Math.min(total - 0.25, targetSeconds)) : Math.max(0, targetSeconds);

      if (currentPayload.isConverted) {
        const startAt = Math.floor(clamped);
        setPlaybackOffset(startAt);
        setCurrentTime(clamped);
        const wasPaused = video.paused;
        video.src = atTime(currentPayload.playbackUrl, startAt);
        if (!wasPaused) void video.play().catch(() => {});
      } else {
        video.currentTime = clamped;
        setCurrentTime(clamped);
      }
      window.setTimeout(() => reportNow(false), 50);
      return clamped;
    },
    [reportNow]
  );

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return 0;
      const pos = playbackOffsetRef.current + (video.currentTime || 0);
      const next = seekTo(pos + delta) ?? pos;
      showOsd({ kind: 'seek', delta, position: next, duration: durationRef.current });
      revealControls();
      return next;
    },
    [revealControls, seekTo, showOsd]
  );

  const setVolumeLevel = useCallback(
    (next: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(1, Math.round(next * 100) / 100));
      video.volume = clamped;
      const nextMuted = clamped === 0;
      video.muted = nextMuted;
      setVolume(clamped);
      setMuted(nextMuted);
      showOsd({ kind: 'volume', volume: clamped, muted: nextMuted });
      revealControls();
      reportNow(false);
    },
    [reportNow, revealControls, showOsd]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
    showOsd({ kind: 'volume', volume: video.volume, muted: nextMuted });
    revealControls();
    reportNow(false);
  }, [reportNow, revealControls, showOsd]);

  const cycleSubtitles = useCallback(() => {
    const subs = payloadRef.current?.subtitles ?? [];
    if (subs.length === 0) {
      showOsd({ kind: 'text', primary: 'No subtitles available' });
      return;
    }
    const idx = subs.findIndex((s) => s.url === activeSubtitleUrlRef.current);
    const next = idx + 1 < subs.length ? subs[idx + 1] : null;
    setActiveSubtitleUrl(next ? next.url : null);
    showOsd({ kind: 'text', primary: 'Subtitles', secondary: next ? next.name : 'Off' });
    revealControls();
  }, [revealControls, showOsd]);

  const expandToMain = useCallback(() => {
    reportNow(false);
    window.cloudstream?.sendFloatingPlayerAction('expand');
  }, [reportNow]);

  const closeFloating = useCallback(() => {
    reportNow(false);
    window.cloudstream?.sendFloatingPlayerAction('close');
  }, [reportNow]);

  // Keyboard shortcuts across the entire detached Windows-level window.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (target instanceof HTMLInputElement && target.type !== 'range') return;

      if (isEmergencyBlurEvent(e)) {
        e.preventDefault();
        videoRef.current?.pause();
        reportNow(false);
        window.cloudstream?.sendFloatingPlayerAction('protect');
        return;
      }

      // Prevent sliders or focused buttons from hijacking arrow/space keys.
      if (target instanceof HTMLInputElement && target.type === 'range') {
        target.blur();
      } else if (target instanceof HTMLButtonElement && (e.key === ' ' || e.key.startsWith('Arrow'))) {
        target.blur();
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const step = e.shiftKey ? FINE_SKIP_SECONDS : SKIP_SECONDS;
          seekBy(-step);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const step = e.shiftKey ? FINE_SKIP_SECONDS : SKIP_SECONDS;
          seekBy(step);
          break;
        }
        case 'j':
        case 'J':
          e.preventDefault();
          seekBy(-LONG_SKIP_SECONDS);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          seekBy(LONG_SKIP_SECONDS);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolumeLevel((videoRef.current?.muted ? 0 : (videoRef.current?.volume ?? volume)) + VOLUME_STEP);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolumeLevel((videoRef.current?.muted ? 0 : (videoRef.current?.volume ?? volume)) - VOLUME_STEP);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case '[': {
          e.preventDefault();
          const video = videoRef.current;
          if (video) {
            const next = Math.max(0.25, Math.round((video.playbackRate - 0.1) * 100) / 100);
            video.playbackRate = next;
            setSpeed(next);
            showOsd({ kind: 'speed', speed: next });
            revealControls();
          }
          break;
        }
        case ']': {
          e.preventDefault();
          const video = videoRef.current;
          if (video) {
            const next = Math.min(3, Math.round((video.playbackRate + 0.1) * 100) / 100);
            video.playbackRate = next;
            setSpeed(next);
            showOsd({ kind: 'speed', speed: next });
            revealControls();
          }
          break;
        }
        case 'c':
        case 'C':
        case 'v':
        case 'V':
          e.preventDefault();
          cycleSubtitles();
          break;
        case 'f':
        case 'F':
        case 'Escape':
          e.preventDefault();
          expandToMain();
          break;
        case 'Home':
          e.preventDefault();
          seekTo(0);
          showOsd({ kind: 'seek', delta: 0, position: 0, duration: durationRef.current });
          revealControls();
          break;
        case 'End':
          e.preventDefault();
          if (durationRef.current > 0) {
            const endPos = Math.max(0, durationRef.current - 5);
            seekTo(endPos);
            showOsd({ kind: 'seek', delta: 0, position: endPos, duration: durationRef.current });
            revealControls();
          }
          break;
        default:
          if (/^[0-9]$/.test(e.key) && durationRef.current > 0) {
            e.preventDefault();
            const pos = (Number(e.key) / 10) * durationRef.current;
            seekTo(pos);
            showOsd({ kind: 'seek', delta: 0, position: pos, duration: durationRef.current });
            revealControls();
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    cycleSubtitles,
    expandToMain,
    reportNow,
    revealControls,
    seekBy,
    seekTo,
    setVolumeLevel,
    showOsd,
    toggleMute,
    togglePlay,
    volume,
  ]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      const action = payloadRef.current?.wheelAction ?? 'volume';
      if (action === 'seek') {
        const forward = e.deltaY < 0;
        const absDelta = Math.abs(e.deltaY);
        const mult = absDelta > 100 ? Math.min(6, Math.floor(absDelta / 50)) : 1;
        seekBy((forward ? SKIP_SECONDS : -SKIP_SECONDS) * mult);
      } else {
        const absDelta = Math.abs(e.deltaY);
        const step = absDelta < 25 ? 0.02 : absDelta < 60 ? 0.03 : absDelta > 150 ? 0.15 : 0.05;
        const delta = e.deltaY < 0 ? step : -step;
        const current = muted ? 0 : volume;
        setVolumeLevel(current + delta);
      }
    },
    [muted, seekBy, setVolumeLevel, volume]
  );

  const subtitleVars = useMemo(() => {
    if (!payload) return undefined;
    return subtitleCssVariables({
      scale: payload.subtitleScale,
      color: payload.subtitleColor,
      background: payload.subtitleBackground,
      weight: payload.subtitleWeight,
      position: payload.subtitlePosition,
    }) as React.CSSProperties;
  }, [payload]);

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={`floating-player-win${controlsVisible ? ' floating-player-win--controls' : ''}`}
      style={subtitleVars}
      onMouseMove={revealControls}
      onMouseLeave={() => setControlsVisible(false)}
      onWheel={handleWheel}
      onPointerDown={(e) => {
        pointerDownRef.current = { x: e.clientX, y: e.clientY };
        containerRef.current?.focus({ preventScroll: true });
      }}
      onPointerUp={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.floating-player-win__top, .floating-player-win__bottom')) return;
        const down = pointerDownRef.current;
        if (!down || !isPointerTap(down.x, down.y, e.clientX, e.clientY)) return;
        if (e.button !== 0) return;
        if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = window.setTimeout(() => {
          togglePlay();
        }, 190);
      }}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('.floating-player-win__top, .floating-player-win__bottom')) return;
        if (clickTimerRef.current) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        expandToMain();
      }}
    >
      <video
        ref={videoRef}
        className={`player__video player__video--${payload?.aspect || 'Fit'}`}
        playsInline
        crossOrigin="anonymous"
        onPlay={() => {
          setIsPlaying(true);
          setLoading(false);
          reportNow(false);
        }}
        onPause={() => {
          setIsPlaying(false);
          reportNow(false);
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrentTime(playbackOffsetRef.current + (v.currentTime || 0));
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onEnded={() => reportNow(true)}
      >
        {(payload?.subtitles ?? []).map((sub) => (
          <track key={sub.url} kind="subtitles" label={sub.name} src={sub.url} />
        ))}
      </video>

      {loading && (
        <div className="floating-player-win__loading" aria-hidden="true">
          <div className="floating-player-win__spinner" />
        </div>
      )}

      {osd && (
        <div className="player__osd floating-player-win__osd" role="status" aria-live="polite">
          {osd.kind === 'play' && (
            <>
              {osd.paused ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              <span className="player__osd-primary">{osd.paused ? 'Paused' : 'Playing'}</span>
            </>
          )}
          {osd.kind === 'seek' && (
            <>
              <span className="player__osd-primary">
                {osd.delta !== 0 ? `${osd.delta > 0 ? '+' : ''}${osd.delta}s` : formatTimecode(osd.position)}
              </span>
              {osd.duration > 0 && (
                <span className="player__osd-secondary">
                  {formatTimecode(osd.position)} / {formatTimecode(osd.duration)}
                </span>
              )}
            </>
          )}
          {osd.kind === 'volume' && (
            <>
              {osd.muted || osd.volume === 0 ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
              <span className="player__osd-primary">
                {osd.muted || osd.volume === 0 ? 'Muted' : `${Math.round(osd.volume * 100)}%`}
              </span>
              <span className="player__osd-level" aria-hidden>
                <span style={{ width: `${osd.muted ? 0 : Math.round(osd.volume * 100)}%` }} />
              </span>
            </>
          )}
          {osd.kind === 'speed' && (
            <span className="player__osd-primary">{osd.speed}x</span>
          )}
          {osd.kind === 'text' && (
            <>
              <span className="player__osd-primary">{osd.primary}</span>
              {osd.secondary && <span className="player__osd-secondary">{osd.secondary}</span>}
            </>
          )}
        </div>
      )}

      <div className="floating-player-win__top">
        <div className="floating-player-win__drag">
          <span className="floating-player-win__title">
            {payload?.episodeTitle ? `${payload.title} · ${payload.episodeTitle}` : payload?.title ?? 'CloudStream'}
          </span>
        </div>
        <div className="floating-player-win__top-actions">
          <button
            type="button"
            className={`player-mini__btn${alwaysOnTop ? ' icon-button--on' : ''}`}
            onClick={() => void window.cloudstream?.setFloatingPlayerOnTop(!alwaysOnTop)}
            title={alwaysOnTop ? 'Unpin from top' : 'Keep above other windows'}
            aria-label={alwaysOnTop ? 'Unpin floating window' : 'Keep floating window above other apps'}
          >
            {alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            type="button"
            className="player-mini__btn"
            onClick={expandToMain}
            title="Return to full player (F / Esc)"
            aria-label="Return to full player"
          >
            <ArrowUpLeft size={14} />
          </button>
          <button
            type="button"
            className="player-mini__btn player-mini__btn--close"
            onClick={closeFloating}
            title="Close floating window"
            aria-label="Close floating window"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="floating-player-win__bottom">
        <div className="floating-player-win__progress">
          <div className="player-mini__progress-fill" style={{ width: `${progressPercent}%` }} />
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.5}
            value={Math.min(currentTime, Math.max(1, duration))}
            aria-label="Seek timeline"
            onChange={(e) => seekTo(Number(e.target.value))}
          />
        </div>
        <div className="floating-player-win__controls">
          {payload?.hasPrevEpisode && (
            <button
              type="button"
              onClick={() => window.cloudstream?.sendFloatingPlayerAction('prev')}
              title="Previous episode"
              aria-label="Previous episode"
            >
              <SkipBack size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => seekBy(-SKIP_SECONDS)}
            title={`Back ${SKIP_SECONDS}s (←)`}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            type="button"
            onClick={() => seekBy(SKIP_SECONDS)}
            title={`Forward ${SKIP_SECONDS}s (→)`}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
          >
            <RotateCw size={14} />
          </button>
          {payload?.hasNextEpisode && (
            <button
              type="button"
              onClick={() => window.cloudstream?.sendFloatingPlayerAction('next')}
              title="Next episode"
              aria-label="Next episode"
            >
              <SkipForward size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={toggleMute}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted || volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <input
            type="range"
            className="player-mini__volume"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => setVolumeLevel(Number(e.target.value))}
          />
          <span className="player-mini__time">
            {formatTimecode(currentTime)}
            {duration > 0 ? ` / ${formatTimecode(duration)}` : ''}
          </span>
          <span className="player-mini__spacer" />
          {speed !== 1 && <span className="floating-player-win__badge">{speed}x</span>}
          {(payload?.subtitles.length ?? 0) > 0 && (
            <button
              type="button"
              className={activeSubtitleUrl ? 'icon-button--on' : undefined}
              onClick={cycleSubtitles}
              title="Cycle subtitles (C / V)"
              aria-label="Cycle subtitles"
            >
              <Captions size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
