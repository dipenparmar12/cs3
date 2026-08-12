import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipForward, ArrowLeft, Shield } from 'lucide-react';
import type { ExtractorLink, SubtitleFile } from '../types/api';
import { PlaybackBackend, AspectRatioMode } from '../types/player';

interface VideoPlayerProps {
  sources: ExtractorLink[];
  title: string;
  episodeTitle?: string;
  onBack: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  sources,
  title,
  episodeTitle,
  onBack,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [activeSource, setActiveSource] = useState<ExtractorLink>(sources[0] || {
    source: 'Default Stream',
    name: '1080p',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    referer: '',
    quality: 1080,
    isM3u8: true
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aspectRatio] = useState<AspectRatioMode>(AspectRatioMode.Fit);
  const [activeBackend, setActiveBackend] = useState<PlaybackBackend>(PlaybackBackend.Web);

  // Initialize HLS.js or native HTML5 video
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeSource) return;

    let hls: Hls | null = null;

    if (activeSource.isM3u8 && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });

      hls.loadSource(activeSource.url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => setIsPlaying(false));
        setIsPlaying(true);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.warn('HLS.js fatal error, switching to Native Backend fallback:', data);
          setActiveBackend(PlaybackBackend.Native);
        }
      });
    } else {
      video.src = activeSource.url;
      video.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [activeSource]);

  // Desktop Keyboard Shortcuts Engine
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          seekRelative(-5);
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          seekRelative(5);
          break;
        case 'arrowup':
          e.preventDefault();
          adjustVolume(0.05);
          break;
        case 'arrowdown':
          e.preventDefault();
          adjustVolume(-0.05);
          break;
        case '[':
          e.preventDefault();
          changeSpeed(-0.25);
          break;
        case ']':
          e.preventDefault();
          changeSpeed(0.25);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, volume, isMuted, duration]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  const seekRelative = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  };

  const adjustVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = Math.max(0, Math.min(1, volume + delta));
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const changeSpeed = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const newSpeed = Math.max(0.25, Math.min(3.0, playbackSpeed + delta));
    video.playbackRate = newSpeed;
    setPlaybackSpeed(newSpeed);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Only show Skip Intro during intro segment (10s to 120s)
  const showSkipIntro = currentTime >= 10 && currentTime <= 120;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Top Header Overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '1.25rem 2rem',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, transparent 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={onBack}
            className="btn btn-secondary btn-icon"
            style={{ borderRadius: '50%' }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{title}</h2>
            {episodeTitle && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{episodeTitle}</span>
            )}
          </div>
        </div>

        {/* Backend Indicator Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.35rem 0.75rem',
          borderRadius: 'var(--radius-full)',
          background: 'rgba(255,255,255,0.1)',
          fontSize: '0.72rem',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.15)'
        }}>
          <Shield size={14} style={{ color: 'var(--status-success)' }} />
          <span>{activeBackend}</span>
        </div>
      </div>

      {/* Main Video Element */}
      <video
        ref={videoRef}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
            setDuration(videoRef.current.duration || 0);
          }
        }}
        onClick={togglePlay}
        style={{
          width: '100%',
          height: '100%',
          objectFit: aspectRatio === AspectRatioMode.Crop ? 'cover' : aspectRatio === AspectRatioMode.Stretch ? 'fill' : 'contain'
        }}
      />

      {/* Conditional Skip Intro Overlay Button */}
      {showSkipIntro && (
        <button
          onClick={() => seekRelative(85)}
          style={{
            position: 'absolute',
            bottom: '90px',
            right: '30px',
            backgroundColor: 'rgba(0,0,0,0.85)',
            border: '1px solid var(--accent-primary)',
            color: '#fff',
            padding: '0.6rem 1.2rem',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            zIndex: 10,
            boxShadow: '0 4px 14px rgba(0,0,0,0.6)'
          }}
        >
          <SkipForward size={16} style={{ color: 'var(--accent-light)' }} />
          <span>Skip Intro (85s)</span>
        </button>
      )}

      {/* Bottom Controls Bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '1rem 2rem',
        background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        zIndex: 10
      }}>
        {/* Timeline Slider */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (videoRef.current) videoRef.current.currentTime = val;
            setCurrentTime(val);
          }}
          style={{
            width: '100%',
            accentColor: 'var(--accent-primary)',
            cursor: 'pointer'
          }}
        />

        {/* Controls Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button onClick={togglePlay} className="btn btn-secondary btn-icon">
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button onClick={toggleMute} className="btn btn-secondary btn-icon">
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Source Selector Dropdown */}
            <select
              value={activeSource.url}
              onChange={(e) => {
                const s = sources.find((x) => x.url === e.target.value);
                if (s) setActiveSource(s);
              }}
              style={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                padding: '0.4rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.8rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {sources.map((s, idx) => (
                <option key={idx} value={s.url}>
                  {s.name} ({s.quality}p) — {s.source}
                </option>
              ))}
            </select>

            <button onClick={toggleFullscreen} className="btn btn-secondary btn-icon">
              {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
