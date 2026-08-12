import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft,
  Loader2, Users, Gauge, Subtitles, AlertTriangle, RotateCcw, RotateCw,
  SkipBack, SkipForward, List, Settings2, MonitorPlay,
} from 'lucide-react';
import type { TorrentStreamStats } from '../types/torrent';
import type { Episode } from '../types/api';
import { AspectRatioMode } from '../types/player';
import { HoverMenu } from './player/HoverMenu';
import { EpisodePanel, type SeriesContext } from './player/EpisodePanel';
import { useTimelinePreview } from './player/useTimelinePreview';

interface VideoPlayerProps {
  streamUrl: string;
  mimeType: string;
  title: string;
  episodeTitle?: string;
  /** Present for torrent-backed streams; drives the buffer/peer readout. */
  infoHash?: string;
  subtitles: Array<{ name: string; url: string }>;
  onBack: () => void;
  /** Supplied when playing a series, enabling the episode panel and next/prev. */
  series?: SeriesContext;
  /** Asked to play another episode; the host resolves a source and restarts. */
  onSelectEpisode?: (episode: Episode) => void;
  /** Identity for recording watch progress, and where to resume from. */
  progress?: {
    mediaUrl: string;
    year?: number;
    posterUrl?: string;
    season?: number;
    episode?: number;
    /** Seconds to seek to on load, from a previous session. */
    resumeAt?: number;
  };
}

/** How often playback position is written. Frequent enough to be useful, rare
 *  enough not to write on every timeupdate tick (which fires ~4x/second). */
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SKIP_SECONDS = 10;

/** Sentinel for HLS automatic level selection, which hls.js represents as -1. */
const AUTO_QUALITY = -1;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return '0 KB/s';
  const mb = bytesPerSecond / 1e6;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1e3).toFixed(0)} KB/s`;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  streamUrl, mimeType, title, episodeTitle, infoHash, subtitles, onBack,
  series, onSelectEpisode, progress,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimer = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspect, setAspect] = useState<AspectRatioMode>(AspectRatioMode.Fit);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TorrentStreamStats | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [qualities, setQualities] = useState<Array<{ level: number; label: string; detail?: string }>>([]);
  const [quality, setQuality] = useState<number>(AUTO_QUALITY);

  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // --- episode navigation --------------------------------------------------

  const orderedEpisodes = useMemo(() => {
    if (!series) return [];
    return [...series.episodes].sort(
      (a, b) =>
        (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0)
    );
  }, [series]);

  const currentIndex = useMemo(
    () => orderedEpisodes.findIndex((e) => e.url === series?.currentEpisodeUrl),
    [orderedEpisodes, series?.currentEpisodeUrl]
  );

  const previousEpisode = currentIndex > 0 ? orderedEpisodes[currentIndex - 1] : null;
  const nextEpisode =
    currentIndex >= 0 && currentIndex < orderedEpisodes.length - 1
      ? orderedEpisodes[currentIndex + 1]
      : null;

  // --- source attachment ---------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setError(null);
    setQualities([]);
    setQuality(AUTO_QUALITY);
    let hls: Hls | null = null;

    const isHls = /\.m3u8(\?|$)/i.test(streamUrl) || mimeType === 'application/x-mpegURL';

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      // Renditions are only known once the manifest is parsed, so the quality
      // menu is populated here rather than guessed from the URL.
      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        setQualities(
          data.levels.map((level, index) => ({
            level: index,
            label: level.height ? `${level.height}p` : `Level ${index + 1}`,
            detail: level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : undefined,
          }))
        );
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) setError(`Playback error: ${data.details}`);
      });
    } else {
      video.src = streamUrl;
    }

    video.play().catch(() => {
      // Autoplay can be refused; the user can press play. Not an error state.
      setIsPlaying(false);
    });

    return () => {
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [streamUrl, mimeType]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = quality;
  }, [quality]);

  // --- torrent stats -------------------------------------------------------

  useEffect(() => {
    if (!infoHash || !window.cloudstream) return;

    let active = true;
    const poll = async () => {
      const next = await window.cloudstream?.getStreamStats(infoHash);
      if (active && next) setStats(next);
    };

    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [infoHash]);

  // --- timeline previews ---------------------------------------------------

  const { preview, requestPreview, clearPreview } = useTimelinePreview({
    streamUrl,
    mimeType,
    duration,
    availableFraction: stats ? stats.progress : 1,
    enabled: !error,
  });

  // --- video element events ------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onMeta = () => setDuration(video.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () =>
      setError(
        'The browser could not decode this file. It may use a codec Chromium does not support (HEVC is common) — try another source.'
      );

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', onTime);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('progress', onTime);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
    };
  }, []);

  // Rolling on to the next episode is the expected behaviour for a series, and
  // it is the one thing a viewer should never have to reach for.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !nextEpisode || !onSelectEpisode) return;
    const onEnded = () => onSelectEpisode(nextEpisode);
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [nextEpisode, onSelectEpisode]);

  // --- watch progress ------------------------------------------------------

  // Held in a ref so the save interval reads current values without being torn
  // down and rebuilt four times a second by timeupdate.
  const progressSnapshot = useRef({ currentTime: 0, duration: 0 });
  progressSnapshot.current = { currentTime, duration };

  useEffect(() => {
    if (!progress || !window.cloudstream) return;

    const save = () => {
      const { currentTime: at, duration: total } = progressSnapshot.current;
      if (total <= 0 || at <= 0) return;
      window.cloudstream?.recordWatchProgress({
        title,
        year: progress.year,
        mediaUrl: progress.mediaUrl,
        posterUrl: progress.posterUrl,
        episodeTitle,
        season: progress.season,
        episode: progress.episode,
        positionSeconds: at,
        durationSeconds: total,
      });
    };

    const timer = window.setInterval(save, PROGRESS_SAVE_INTERVAL_MS);
    // Closing the player is the moment the position matters most, and the
    // interval will not have fired since the last few seconds of playback.
    return () => {
      window.clearInterval(timer);
      save();
    };
  }, [progress, title, episodeTitle]);

  // Resume from where the last session stopped, once the media knows how long
  // it is. Seeking before metadata loads is silently ignored by the element.
  const resumedRef = useRef<string | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    const resumeAt = progress?.resumeAt;
    if (!video || !resumeAt || duration <= 0) return;
    if (resumedRef.current === streamUrl) return;

    resumedRef.current = streamUrl;
    if (resumeAt < duration - 10) video.currentTime = resumeAt;
  }, [progress?.resumeAt, duration, streamUrl]);

  // --- controls ------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, video.currentTime + delta);
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, time);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      await container.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': seekBy(SKIP_SECONDS); break;
        case 'ArrowLeft': seekBy(-SKIP_SECONDS); break;
        case 'l': seekBy(30); break;
        case 'j': seekBy(-30); break;
        case 'f': toggleFullscreen(); break;
        case 'm': setIsMuted((v) => !v); break;
        case 'e': if (series) setPanelOpen((v) => !v); break;
        case 'n': if (nextEpisode && onSelectEpisode) onSelectEpisode(nextEpisode); break;
        case 'p': if (previousEpisode && onSelectEpisode) onSelectEpisode(previousEpisode); break;
        case 'Escape': if (!document.fullscreenElement) onBack(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleFullscreen, onBack, series, nextEpisode, previousEpisode, onSelectEpisode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
    video.playbackRate = speed;
  }, [volume, isMuted, speed]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  // --- seek bar interaction ------------------------------------------------

  const timeFromPointer = useCallback(
    (clientX: number): number | null => {
      const bar = seekBarRef.current;
      if (!bar || !duration) return null;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const onSeekHover = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const time = timeFromPointer(e.clientX);
      if (time === null) return;
      const rect = seekBarRef.current!.getBoundingClientRect();
      setHoverTime(time);
      setHoverX(e.clientX - rect.left);
      requestPreview(time);
    },
    [timeFromPointer, requestPreview]
  );

  const onSeekLeave = useCallback(() => {
    setHoverTime(null);
    clearPreview();
  }, [clearPreview]);

  const onSeekClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const time = timeFromPointer(e.clientX);
      if (time !== null) seekTo(time);
    },
    [timeFromPointer, seekTo]
  );

  // Playback cannot start until enough leading data exists; showing the real
  // reason beats an indefinite spinner over a black frame.
  const isBuffering = Boolean(stats && !stats.isPlayable && !stats.error);

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`player${controlsVisible ? '' : ' player--idle'}`}
      onMouseMove={revealControls}
    >
      <video
        ref={videoRef}
        className={`player__video player__video--${aspect}`}
        playsInline
        onClick={togglePlay}
        crossOrigin="anonymous"
      >
        {subtitles.map((sub) => (
          <track
            key={sub.url}
            kind="subtitles"
            label={sub.name}
            src={sub.url}
            default={activeSubtitle === sub.url}
          />
        ))}
      </video>

      {(isBuffering || error) && (
        <div className="player__overlay">
          {error ? (
            <>
              <AlertTriangle size={36} />
              <p>{error}</p>
              <button className="btn" onClick={onBack}>Choose another source</button>
            </>
          ) : (
            <>
              <Loader2 className="spin" size={36} />
              <p>Buffering from peers…</p>
              {stats && (
                <span className="muted">
                  {formatSpeed(stats.downloadSpeed)} · {stats.peers} peer
                  {stats.peers === 1 ? '' : 's'} · {(stats.progress * 100).toFixed(1)}%
                </span>
              )}
              {stats && stats.peers === 0 && (
                <span className="muted">
                  No peers yet. If this persists the swarm may be dead — try a source with more seeders.
                </span>
              )}
            </>
          )}
        </div>
      )}

      <header className={`player__top${controlsVisible ? '' : ' hidden'}`}>
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="player__titles">
          <h2>{title}</h2>
          {episodeTitle && <p>{episodeTitle}</p>}
        </div>
        {stats && (
          <div className="player__stats">
            <span title="Peers"><Users size={14} /> {stats.peers}</span>
            <span title="Download speed"><Gauge size={14} /> {formatSpeed(stats.downloadSpeed)}</span>
          </div>
        )}
      </header>

      {series && (
        <EpisodePanel
          series={series}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          onSelectEpisode={(episode) => {
            setPanelOpen(false);
            onSelectEpisode?.(episode);
          }}
        />
      )}

      <footer className={`player__controls${controlsVisible ? '' : ' hidden'}`}>
        <div
          ref={seekBarRef}
          className="player__seek"
          onMouseMove={onSeekHover}
          onMouseLeave={onSeekLeave}
          onClick={onSeekClick}
        >
          {/* Two stacked bars: browser-buffered ahead of the playhead, and the
              torrent's downloaded fraction, which is what actually gates seeking. */}
          {stats && (
            <div className="player__seek-torrent" style={{ width: `${stats.progress * 100}%` }} />
          )}
          <div
            className="player__seek-buffer"
            style={{ width: duration ? `${(buffered / duration) * 100}%` : '0%' }}
          />
          <div className="player__seek-played" style={{ width: `${progressPercent}%` }} />
          <div className="player__seek-handle" style={{ left: `${progressPercent}%` }} />

          {hoverTime !== null && (
            <div
              className="player__preview"
              style={{ left: `${hoverX}px` }}
              // The tooltip sits under the cursor and must not eat the click
              // that would otherwise seek.
              aria-hidden="true"
            >
              {preview.image ? (
                <img src={preview.image} alt="" />
              ) : (
                <div className="player__preview-placeholder">
                  {preview.loading ? <Loader2 className="spin" size={18} /> : <MonitorPlay size={18} />}
                </div>
              )}
              <span>{formatTime(hoverTime)}</span>
            </div>
          )}

          <input
            className="player__seek-input"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
          />
        </div>

        <div className="player__buttons">
          {series && (
            <button
              className="icon-button"
              onClick={() => previousEpisode && onSelectEpisode?.(previousEpisode)}
              disabled={!previousEpisode}
              aria-label="Previous episode"
              title="Previous episode (P)"
            >
              <SkipBack size={18} />
            </button>
          )}

          <button
            className="icon-button"
            onClick={() => seekBy(-SKIP_SECONDS)}
            aria-label={`Back ${SKIP_SECONDS} seconds`}
            title={`Back ${SKIP_SECONDS}s (←)`}
          >
            <RotateCcw size={18} />
            <span className="icon-button__badge">{SKIP_SECONDS}</span>
          </button>

          <button className="icon-button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            className="icon-button"
            onClick={() => seekBy(SKIP_SECONDS)}
            aria-label={`Forward ${SKIP_SECONDS} seconds`}
            title={`Forward ${SKIP_SECONDS}s (→)`}
          >
            <RotateCw size={18} />
            <span className="icon-button__badge">{SKIP_SECONDS}</span>
          </button>

          {series && (
            <button
              className="icon-button"
              onClick={() => nextEpisode && onSelectEpisode?.(nextEpisode)}
              disabled={!nextEpisode}
              aria-label="Next episode"
              title="Next episode (N)"
            >
              <SkipForward size={18} />
            </button>
          )}

          <span className="player__time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <button className="icon-button" onClick={() => setIsMuted((v) => !v)} aria-label="Mute">
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            className="player__volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setIsMuted(false);
            }}
            aria-label="Volume"
          />

          <div className="player__spacer" />

          {series && (
            <button
              className="icon-button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-label="Episodes"
              title="Episodes (E)"
            >
              <List size={18} />
            </button>
          )}

          {qualities.length > 1 && (
            <HoverMenu
              icon={<Settings2 size={16} />}
              label="Quality"
              value={quality}
              onChange={setQuality}
              options={[
                { value: AUTO_QUALITY, label: 'Auto' },
                ...qualities.map((q) => ({ value: q.level, label: q.label, detail: q.detail })),
              ]}
            />
          )}

          {subtitles.length > 0 && (
            <HoverMenu
              icon={<Subtitles size={16} />}
              label="Subtitles"
              value={activeSubtitle ?? ''}
              onChange={(next) => setActiveSubtitle(next === '' ? null : String(next))}
              triggerText={
                activeSubtitle
                  ? (subtitles.find((s) => s.url === activeSubtitle)?.name ?? 'On')
                  : 'Off'
              }
              options={[
                { value: '', label: 'Off' },
                ...subtitles.map((sub) => ({ value: sub.url, label: sub.name })),
              ]}
            />
          )}

          <HoverMenu
            label="Speed"
            value={speed}
            onChange={setSpeed}
            options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
            triggerText={`${speed}×`}
          />

          <HoverMenu
            label="Aspect ratio"
            value={aspect}
            onChange={setAspect}
            options={Object.values(AspectRatioMode).map((mode) => ({ value: mode, label: mode }))}
          />

          <button className="icon-button" onClick={toggleFullscreen} aria-label="Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </footer>
    </div>
  );
};
