import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft,
  Loader2, Users, Gauge, Subtitles, AlertTriangle,
} from 'lucide-react';
import type { TorrentStreamStats } from '../types/torrent';
import { AspectRatioMode } from '../types/player';

interface VideoPlayerProps {
  streamUrl: string;
  mimeType: string;
  title: string;
  episodeTitle?: string;
  /** Present for torrent-backed streams; drives the buffer/peer readout. */
  infoHash?: string;
  subtitles: Array<{ name: string; url: string }>;
  onBack: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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

  // --- source attachment ---------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setError(null);
    let hls: Hls | null = null;

    const isHls = /\.m3u8(\?|$)/i.test(streamUrl) || mimeType === 'application/x-mpegURL';

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
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
      video.removeAttribute('src');
      video.load();
    };
  }, [streamUrl, mimeType]);

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
        case 'ArrowRight': seekBy(10); break;
        case 'ArrowLeft': seekBy(-10); break;
        case 'l': seekBy(30); break;
        case 'j': seekBy(-30); break;
        case 'f': toggleFullscreen(); break;
        case 'm': setIsMuted((v) => !v); break;
        case 'Escape': if (!document.fullscreenElement) onBack(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleFullscreen, onBack]);

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

  // Playback cannot start until enough leading data exists; showing the real
  // reason beats an indefinite spinner over a black frame.
  const isBuffering = Boolean(stats && !stats.isPlayable && !stats.error);

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

      <footer className={`player__controls${controlsVisible ? '' : ' hidden'}`}>
        <div className="player__seek">
          {/* Two stacked bars: browser-buffered ahead of the playhead, and the
              torrent's downloaded fraction, which is what actually gates seeking. */}
          {stats && (
            <div className="player__seek-torrent" style={{ width: `${stats.progress * 100}%` }} />
          )}
          <div
            className="player__seek-buffer"
            style={{ width: duration ? `${(buffered / duration) * 100}%` : '0%' }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={(e) => {
              const video = videoRef.current;
              if (video) video.currentTime = Number(e.target.value);
            }}
            aria-label="Seek"
          />
        </div>

        <div className="player__buttons">
          <button className="icon-button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

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

          {subtitles.length > 0 && (
            <select
              className="player__select"
              value={activeSubtitle ?? ''}
              onChange={(e) => setActiveSubtitle(e.target.value || null)}
              aria-label="Subtitles"
            >
              <option value="">
                <Subtitles size={14} /> Off
              </option>
              {subtitles.map((sub) => (
                <option key={sub.url} value={sub.url}>{sub.name}</option>
              ))}
            </select>
          )}

          <select
            className="player__select"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            aria-label="Playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>

          <select
            className="player__select"
            value={aspect}
            onChange={(e) => setAspect(e.target.value as AspectRatioMode)}
            aria-label="Aspect ratio"
          >
            {Object.values(AspectRatioMode).map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>

          <button className="icon-button" onClick={toggleFullscreen} aria-label="Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </footer>
    </div>
  );
};
