import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import type { TitleVideo } from '../../types/metadata';
import {
  buildTrailerQueue,
  current as currentOf,
  step,
  upNext,
  type TrailerQueue,
} from '../../utils/trailerQueue';
import { describeError } from '../../utils/errors';
import { formatTimecode } from '../../utils/format';
import {
  SEEK_COMMIT_MS,
  clampSeek,
  controlsFor,
  isLiveConversionUrl,
  playheadSeconds,
  recoveryPlan,
  seekBase,
  timeAtPointer,
} from '../../utils/trailerPlayback';

/**
 * Points a conversion URL at a timestamp, replacing any it already carries.
 *
 * A live fragmented MP4 has no index, so seeking is a re-request with `?t=`.
 */
function atTime(url: string, seconds: number): string {
  const [base] = url.split('?');
  return seconds > 0 ? `${base}?t=${Math.floor(seconds)}` : base;
}

/** Where the current entry has got to. One entry, one state. */
type Stage =
  | { phase: 'resolving' }
  | {
      phase: 'ready';
      url: string;
      isHls: boolean;
      duration?: number;
      subtitles?: Array<{ name: string; url: string }>;
      sessionId?: string;
    }
  | {
      phase: 'error';
      message: string;
      needsComponents?: boolean;
    };

const AUTOPLAY_SECONDS = 5;

export const TrailerPopup: React.FC<{
  /** Everything the gallery drew, so the queue matches what is on screen. */
  videos: TitleVideo[];
  /** The card that was pressed. */
  startId: string;
  /** The film or series, for the dialog's second line. */
  titleName?: string;
  onClose: () => void;
  /**
   * Shrunk to a corner and still playing, so the rest of the app can be used
   * — the same idea as the main player's mini mode. The `<video>` element is
   * never remounted between the two layouts (same element types, only class
   * names change), which is what keeps the trailer playing through the switch.
   */
  mini?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
}> = ({ videos, startId, titleName, onClose, mini = false, onMinimize, onExpand }) => {
  const [queue, setQueue] = useState<TrailerQueue>(() => buildTrailerQueue(videos, startId));
  const video = currentOf(queue);
  const next = useMemo(() => upNext(queue), [queue]);
  const previous = useMemo(() => step(queue, -1), [queue]);

  const [stage, setStage] = useState<Stage>({ phase: 'resolving' });
  const [attempt, setAttempt] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  /** Counts down after `ended`; null whenever nothing is queued up. */
  const [countdown, setCountdown] = useState<number | null>(null);

  // Playback & UI state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Read inside element listeners and timers, so they hold refs, not state.
   * `offsetRef` is where the current live conversion started; `pendingSeekRef`
   * a target the stream has not been restarted at yet.
   */
  const offsetRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTimeRef = useRef(0);
  /** Frames were presented for this entry; recoveries spent on it. */
  const hasPlayedRef = useRef(false);
  const recoveriesRef = useRef(0);

  const [elementDuration, setElementDuration] = useState(0);

  const duration =
    (stage.phase === 'ready' && stage.duration) ||
    video?.durationSeconds ||
    elementDuration ||
    0;

  const go = useCallback((delta: number) => {
    if (activeSessionIdRef.current) {
      void window.cloudstream?.closePlaybackStream(activeSessionIdRef.current);
      activeSessionIdRef.current = null;
    }
    setQueue((held) => step(held, delta) ?? held);
    setCountdown(null);
    setAttempt(0);
    setCurrentTime(0);
    setIsPlaying(false);
    offsetRef.current = 0;
    pendingSeekRef.current = null;
    currentTimeRef.current = 0;
    hasPlayedRef.current = false;
    recoveriesRef.current = 0;
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
  }, []);

  // Escape closes or exits fullscreen
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isInput) return;

      if (event.key === 'Escape') {
        if (document.fullscreenElement) {
          void document.exitFullscreen?.().catch(() => undefined);
          return;
        }
        // Minimised, the trailer is background: Escape belongs to whatever
        // the viewer is doing now, not to a corner they are not looking at.
        if (mini) return;
        event.stopPropagation();
        // Escape shrinks rather than ends when shrinking is possible: it is
        // the "get out of my way" key, and stopping a trailer halfway is a
        // second decision.
        if (onMinimize) onMinimize();
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onMinimize, mini]);

  // Read viewer's stored volume preferences
  useEffect(() => {
    void (async () => {
      const response = await window.cloudstream?.getPlayerPreferences?.();
      const element = videoRef.current;
      if (!response?.ok || !element) return;
      const vol = Math.min(1, Math.max(0, response.preferences.volume));
      element.volume = vol;
      element.muted = response.preferences.muted;
      setVolume(vol);
      setMuted(response.preferences.muted);
    })();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeSessionIdRef.current) {
        void window.cloudstream?.closePlaybackStream(activeSessionIdRef.current);
        activeSessionIdRef.current = null;
      }
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    };
  }, []);

  // Fullscreen state listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  /** Resolve, then prepare direct stream. */
  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    let opened = '';

    setStage({ phase: 'resolving' });
    setCountdown(null);
    setCurrentTime(0);
    setIsPlaying(false);
    offsetRef.current = 0;
    pendingSeekRef.current = null;
    currentTimeRef.current = 0;
    hasPlayedRef.current = false;
    recoveriesRef.current = 0;
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);

    void (async () => {
      const api = window.cloudstream;
      try {
        const resolved = await api?.resolvePromoVideo?.(video.url);
        if (cancelled) return;
        if (!resolved?.ok || !resolved.streamUrl) {
          setStage({
            phase: 'error',
            message: resolved?.needsComponents
              ? 'Direct streaming needs yt-dlp. Settings → Components can install it.'
              : (resolved?.error ?? 'That trailer could not be opened in the player.'),
            needsComponents: resolved?.needsComponents,
          });
          return;
        }

        const prepared = await api?.preparePlaybackStream({
          url: resolved.streamUrl,
          isM3u8: resolved.isM3u8,
          isDash: resolved.isDash,
        });
        if (cancelled) {
          const sid = prepared?.sessionId || resolved.sessionId;
          if (sid) void api?.closePlaybackStream(sid);
          return;
        }
        if (!prepared?.ok || !prepared.playbackUrl) {
          setStage({
            phase: 'error',
            message: prepared?.error ?? 'This trailer could not be prepared for playback.',
            needsComponents: prepared?.needsComponents,
          });
          return;
        }

        opened = prepared.sessionId || resolved.sessionId || '';
        activeSessionIdRef.current = opened || null;

        const strategy = prepared.capability.requiredStrategy;
        if (strategy === 'NATIVE_MPV') {
          setStage({
            phase: 'error',
            message: 'This video needs the native player, which trailers do not use.',
          });
          return;
        }

        setStage({
          phase: 'ready',
          url: prepared.playbackUrl,
          isHls: strategy === 'HLS_NATIVE' || prepared.capability.transport === 'hls',
          duration: resolved.durationSeconds || video.durationSeconds,
          subtitles: resolved.subtitles,
          sessionId: opened,
        });
      } catch (error) {
        if (!cancelled) {
          setStage({ phase: 'error', message: describeError(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (opened) {
        void window.cloudstream?.closePlaybackStream(opened);
        if (activeSessionIdRef.current === opened) {
          activeSessionIdRef.current = null;
        }
      }
    };
  }, [video, attempt]);

  /** Attach video source. */
  useEffect(() => {
    const element = videoRef.current;
    if (!element || stage.phase !== 'ready') return;

    let hls: Hls | null = null;
    if (stage.isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(stage.url);
      hls.attachMedia(element);
    } else {
      element.src = stage.url;
    }
    void element.play().catch(() => {
      /* Autoplay can be refused by browser policy. */
    });

    return () => {
      hls?.destroy();
      if (!hls) {
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [stage]);

  // Synchronize text tracks mode with subtitlesEnabled
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !element.textTracks) return;
    for (let i = 0; i < element.textTracks.length; i++) {
      element.textTracks[i].mode = subtitlesEnabled ? 'showing' : 'hidden';
    }
  }, [subtitlesEnabled, stage]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    if (autoplay && next) setCountdown(AUTOPLAY_SECONDS);
  }, [autoplay, next]);

  // Autoplay countdown timer
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      go(1);
      return;
    }
    const timer = setTimeout(
      () => setCountdown((left) => (left === null ? null : left - 1)),
      1000
    );
    return () => clearTimeout(timer);
  }, [countdown, go]);

  // Time update from video element
  const handleTimeUpdate = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    const isConv = stage.phase === 'ready' && isLiveConversionUrl(stage.url);
    const now = playheadSeconds(element.currentTime, offsetRef.current, isConv);
    currentTimeRef.current = now;

    if (pendingSeekRef.current === null && !isScrubbing) {
      setCurrentTime(now);
    }
    if (element.currentTime > 0) {
      hasPlayedRef.current = true;
    }

    // If near duration on fragmented live pipe, advance cleanly
    if (duration > 0 && now >= duration - 0.5 && !element.paused) {
      handleEnded();
    }
  }, [stage, duration, handleEnded, isScrubbing]);

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) {
      void element.play().catch(() => undefined);
    } else {
      element.pause();
    }
  }, []);

  const commitSeek = useCallback(
    (targetSeconds: number) => {
      const element = videoRef.current;
      if (!element || stage.phase !== 'ready') return;
      const target = clampSeek(targetSeconds, duration);
      offsetRef.current = target;
      setCurrentTime(target);
      currentTimeRef.current = target;

      const isConv = isLiveConversionUrl(stage.url);
      if (stage.isHls) {
        element.currentTime = target;
      } else if (isConv) {
        const wasPlaying = !element.paused;
        element.src = atTime(stage.url, target);
        element.load();
        if (wasPlaying) void element.play().catch(() => undefined);
      } else {
        element.currentTime = target;
      }

      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => {
        pendingSeekRef.current = null;
      }, 350);
    },
    [stage, duration]
  );

  const seekBy = useCallback(
    (delta: number) => {
      const base = seekBase(pendingSeekRef.current, currentTimeRef.current);
      const target = clampSeek(base + delta, duration);
      pendingSeekRef.current = target;
      setCurrentTime(target);
      currentTimeRef.current = target;

      if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
      seekTimerRef.current = setTimeout(() => {
        commitSeek(target);
      }, SEEK_COMMIT_MS);
    },
    [duration, commitSeek]
  );

  const handleVideoError = useCallback(() => {
    const plan = recoveryPlan({
      hasPlayed: hasPlayedRef.current,
      recoveries: recoveriesRef.current,
      position: currentTimeRef.current,
      duration,
    });

    if (plan.action === 'ended') {
      handleEnded();
      return;
    }

    if (plan.action === 'restart') {
      recoveriesRef.current += 1;
      const element = videoRef.current;
      if (element && stage.phase === 'ready') {
        const isConv = isLiveConversionUrl(stage.url);
        if (isConv) {
          offsetRef.current = plan.at;
          element.src = atTime(stage.url, plan.at);
          element.load();
          void element.play().catch(() => undefined);
          return;
        } else {
          element.currentTime = plan.at;
          element.load();
          void element.play().catch(() => undefined);
          return;
        }
      }
    }

    setStage({
      phase: 'error',
      message: 'This trailer could not be played in the player.',
    });
  }, [duration, handleEnded, stage]);

  const handleVolumeChange = useCallback((newVol: number) => {
    const element = videoRef.current;
    if (!element) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    element.volume = clamped;
    element.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    const nextMuted = !element.muted;
    element.muted = nextMuted;
    setMuted(nextMuted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;
    if (!document.fullscreenElement) {
      void stageEl.requestFullscreen?.().catch(() => undefined);
    } else {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isInput) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-5);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(5);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleVolumeChange(volume + 0.1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleVolumeChange(volume - 0.1);
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, seekBy, handleVolumeChange, volume, toggleMute, toggleFullscreen]);

  // Controls auto-hide
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  }, [isPlaying]);

  // Scrubber dragging
  const handleScrubberMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const ctrl = controlsFor(stage.phase);
      if (!ctrl.transport || !scrubberRef.current || duration <= 0) return;
      setIsScrubbing(true);

      const computeTime = (clientX: number) => {
        if (!scrubberRef.current || duration <= 0) return 0;
        const rect = scrubberRef.current.getBoundingClientRect();
        return timeAtPointer(clientX, rect.left, rect.width, duration);
      };

      const initialTarget = computeTime(e.clientX);
      pendingSeekRef.current = initialTarget;
      setCurrentTime(initialTarget);
      currentTimeRef.current = initialTarget;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const nextTarget = computeTime(moveEvent.clientX);
        pendingSeekRef.current = nextTarget;
        setCurrentTime(nextTarget);
        currentTimeRef.current = nextTarget;
      };

      const onMouseUp = () => {
        setIsScrubbing(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        const finalTarget = pendingSeekRef.current ?? currentTimeRef.current;
        commitSeek(finalTarget);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [stage.phase, duration, commitSeek]
  );

  if (!video) return null;

  const position =
    queue.videos.length > 1 ? `${queue.index + 1} of ${queue.videos.length}` : null;
  const context = [titleName, position].filter(Boolean).join(' · ');
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const showOverlayControls = showControls || !isPlaying || isScrubbing;
  const ctrl = controlsFor(stage.phase);

  return (
    <div
      className={mini ? 'trailer-mini-host' : 'modal-backdrop trailer-popup__backdrop'}
      role="presentation"
      onClick={mini ? undefined : onMinimize ?? onClose}
    >
      <div
        className={`trailer-popup${mini ? ' trailer-popup--mini' : ''}`}
        role={mini ? 'complementary' : 'dialog'}
        aria-modal={mini ? undefined : true}
        aria-label={`${video.label}${titleName ? ` — ${titleName}` : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="trailer-popup__head">
          <div className="trailer-popup__titles">
            <strong className="trailer-popup__label" title={video.title}>
              {video.label}
            </strong>
            {context && <span className="trailer-popup__context">{context}</span>}
          </div>
          <div className="trailer-popup__actions-group">
            {mini && onExpand && (
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={onExpand}
                title="Expand"
                aria-label="Expand trailer"
              >
                <Maximize2 size={14} />
              </button>
            )}
            {!mini && onMinimize && (
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={onMinimize}
                title="Minimise — keep playing while you browse (Esc)"
                aria-label="Minimise trailer"
              >
                <PictureInPicture2 size={14} />
              </button>
            )}
            {!mini && (
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => void window.cloudstream?.openExternalLink?.(video.url)}
              title={`Open video in external browser (${video.url})`}
              aria-label={`Open video in external browser: ${video.url}`}
            >
              <ExternalLink size={14} />
            </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={onClose}
              title="Close"
              aria-label="Close trailer"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div
          ref={stageRef}
          className="trailer-popup__stage"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => isPlaying && setShowControls(false)}
        >
          <video
            ref={videoRef}
            className="trailer-popup__video"
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setElementDuration(d);
            }}
            onEnded={handleEnded}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
            onError={handleVideoError}
          >
            {stage.phase === 'ready' &&
              stage.subtitles?.map((sub, i) => (
                <track
                  key={sub.url}
                  kind="subtitles"
                  label={sub.name}
                  src={sub.url}
                  default={i === 0 && /en|eng|english/i.test(sub.name)}
                />
              ))}
          </video>

          {/* Fullscreen top HUD */}
          {isFullscreen && (
            <div
              className={`trailer-popup__fullscreen-head ${
                showOverlayControls ? '' : 'trailer-popup__controls--hidden'
              }`}
            >
              <div className="trailer-popup__titles">
                <strong className="trailer-popup__label" title={video.title}>
                  {video.label}
                </strong>
                {context && <span className="trailer-popup__context">{context}</span>}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={toggleFullscreen}
                title="Exit Fullscreen (F)"
                aria-label="Exit Fullscreen"
              >
                <Minimize2 size={16} />
              </button>
            </div>
          )}

          {/* Center Play button when paused */}
          {stage.phase === 'ready' && !isPlaying && countdown === null && (
            <button
              type="button"
              className="trailer-popup__center-play"
              onClick={togglePlay}
              aria-label="Play"
            >
              <Play size={28} fill="currentColor" />
            </button>
          )}

          {/* Custom Player Controls - mounted across all phases */}
          <div
            className={`trailer-popup__controls ${
              showOverlayControls ? '' : 'trailer-popup__controls--hidden'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Scrubber bar */}
            <div
              ref={scrubberRef}
              className={`trailer-popup__scrubber ${
                !ctrl.transport ? 'trailer-popup__scrubber--disabled' : ''
              }`}
              onMouseDown={handleScrubberMouseDown}
              role="slider"
              aria-label="Seek timeline"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
            >
              <div className="trailer-popup__scrubber-track">
                <div
                  className="trailer-popup__scrubber-fill"
                  style={{ width: `${progressPercent}%` }}
                />
                <div
                  className="trailer-popup__scrubber-handle"
                  style={{ left: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Controls bar */}
            <div className="trailer-popup__bar">
              <div className="trailer-popup__bar-group">
                <button
                  type="button"
                  className="trailer-popup__btn"
                  onClick={togglePlay}
                  disabled={!ctrl.transport}
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                </button>

                <button
                  type="button"
                  className="trailer-popup__btn"
                  onClick={() => seekBy(-10)}
                  disabled={!ctrl.transport}
                  title="Skip back 10s (Left Arrow)"
                  aria-label="Skip back 10 seconds"
                >
                  <RotateCcw size={15} />
                </button>

                <button
                  type="button"
                  className="trailer-popup__btn"
                  onClick={() => seekBy(10)}
                  disabled={!ctrl.transport}
                  title="Skip forward 10s (Right Arrow)"
                  aria-label="Skip forward 10 seconds"
                >
                  <RotateCw size={15} />
                </button>

                <button
                  type="button"
                  className="trailer-popup__btn"
                  onClick={toggleMute}
                  title={muted ? 'Unmute (M)' : 'Mute (M)'}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
                </button>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="trailer-popup__volume-slider"
                  aria-label="Volume"
                />

                <span className="trailer-popup__time">
                  {formatTimecode(currentTime)} / {duration > 0 ? formatTimecode(duration) : '--:--'}
                </span>
              </div>

              <div className="trailer-popup__bar-group">
                {Boolean(stage.phase === 'ready' && stage.subtitles && stage.subtitles.length > 0) && (
                  <button
                    type="button"
                    className={`trailer-popup__btn ${
                      subtitlesEnabled ? 'trailer-popup__btn--active' : ''
                    }`}
                    onClick={() => setSubtitlesEnabled((prev) => !prev)}
                    title="Subtitles"
                    aria-label="Toggle subtitles"
                  >
                    <Subtitles size={16} />
                  </button>
                )}

                <button
                  type="button"
                  className="trailer-popup__btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                  aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              </div>
            </div>
          </div>

          {stage.phase === 'resolving' && (
            <div className="trailer-popup__overlay" role="status">
              <Loader2 size={20} className="spin" />
              <span>Getting the trailer…</span>
            </div>
          )}

          {stage.phase === 'error' && (
            <div className="trailer-popup__overlay trailer-popup__overlay--error" role="alert">
              <AlertTriangle size={24} />
              <span>{stage.message}</span>
              <div className="trailer-popup__error-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void window.cloudstream?.openExternalLink?.(video.url)}
                  title={`Open ${video.url} in external browser`}
                >
                  <ExternalLink size={15} />
                  <span>Open in external browser</span>
                </button>
                {!stage.needsComponents && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setAttempt((count) => count + 1)}
                    title="Retry loading this trailer"
                  >
                    <RotateCcw size={13} />
                    <span>Try again</span>
                  </button>
                )}
              </div>
              <span className="trailer-popup__error-url" title={video.url}>
                {video.url}
              </span>
            </div>
          )}

          {countdown !== null && next && (
            <div className="trailer-popup__overlay trailer-popup__overlay--next" role="status">
              <span className="trailer-popup__next-heading">Up next</span>
              <strong className="trailer-popup__next-label">{next.label}</strong>
              <div className="trailer-popup__next-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => go(1)}>
                  <Play size={13} /> Play now
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCountdown(null)}
                >
                  Cancel
                </button>
              </div>
              <span className="trailer-popup__countdown">Starting in {countdown}s</span>
            </div>
          )}
        </div>

        <footer className="trailer-popup__foot">
          <div className="trailer-popup__steps">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => go(-1)}
              disabled={!previous}
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => go(1)}
              disabled={!next}
            >
              Next <ChevronRight size={14} />
            </button>
          </div>

          <label className="trailer-popup__autoplay">
            <input
              type="checkbox"
              checked={autoplay}
              onChange={(event) => {
                setAutoplay(event.target.checked);
                if (!event.target.checked) setCountdown(null);
              }}
            />
            <span>{next ? `Autoplay — up next: ${next.label}` : 'Autoplay'}</span>
          </label>
        </footer>
      </div>
    </div>
  );
};
