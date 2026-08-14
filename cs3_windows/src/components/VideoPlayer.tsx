import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft,
  Loader2, Users, Gauge, Subtitles, AlertTriangle, RotateCcw, RotateCw,
  SkipBack, SkipForward, List, Settings2, MonitorPlay, Radio, Download,
} from 'lucide-react';
import type { TorrentStreamStats } from '../types/torrent';
import type { Episode } from '../types/api';
import { AspectRatioMode } from '../types/player';
import type { TorrentResult } from '../types/torrent';
import { HoverMenu } from './player/HoverMenu';
import { EpisodePanel } from './player/EpisodePanel';
import { SourcePanel } from './player/SourcePanel';
import { SourceResolveOverlay } from './player/SourceResolveOverlay';
import { SubtitlePanel } from './player/SubtitlePanel';
import type { MediaProbe } from '../../electron/mediaTranscoder';
import type { SeriesContext } from './player/seriesContext';
import { UpNextCard } from './player/UpNextCard';
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
  /**
   * Set while the host is resolving a source for a requested episode. Source
   * resolution can take half a minute once failover is involved, and a player
   * that shows nothing during it reads as broken.
   */
  switchingTo?: Episode | null;
  /** Reported when resolving the requested episode failed, so the viewer is not stranded. */
  switchError?: string | null;
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
  /**
   * Live source-resolution state.
   *
   * Present when the host opened the player *before* a stream existed — the
   * instant-play path. The player then owns the wait: it shows discovery
   * progress, offers "play now" on partial results, and keeps the source list
   * available for switching once playback has started.
   */
  /** Identity for online subtitle search; without an IMDb id it is unavailable. */
  subtitleContext?: { imdbId?: string; season?: number; episode?: number };
  /** Downloads whatever is currently playing, without leaving the player. */
  onDownloadCurrent?: () => void;
  sourceSession?: {
    phase: PlaybackPhase;
    sources: TorrentResult[];
    activeInfoHash?: string;
    searched: number;
    totalIndexers: number;
    lastIndexerName?: string;
    searchDone: boolean;
    error?: string;
    attempts: Array<{ title: string; indexerName: string; error: string }>;
    onPlayNow: () => void;
    onSelectSource: (source: TorrentResult) => void;
    onRefresh: () => void;
    onDownloadSource?: (source: TorrentResult) => void;
  };
}

export type PlaybackPhase = 'searching' | 'starting' | 'playing' | 'error';

/** How often playback position is written. Frequent enough to be useful, rare
 *  enough not to write on every timeupdate tick (which fires ~4x/second). */
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

/**
 * How long the pointer may sit still inside the player before the controls go.
 *
 * Only genuine movement resets it — see `revealControls`. Leaving the player
 * hides them without waiting for this at all.
 */
const CONTROLS_IDLE_MS = 3_000;

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

/** How long before the end the up-next card appears, and how long it counts down. */
const UP_NEXT_LEAD_SECONDS = 40;

export interface AudioTrackInfo {
  id: string | number;
  label: string;
  language?: string;
  active: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  streamUrl, mimeType, title, episodeTitle, infoHash, subtitles, onBack,
  series, onSelectEpisode, switchingTo, switchError, progress, sourceSession,
  subtitleContext, onDownloadCurrent,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

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
  const [isHoveringControls, setIsHoveringControls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TorrentStreamStats | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false);
  /** Subtitles fetched from the online search, as blob-backed WebVTT tracks. */
  const [fetchedSubtitles, setFetchedSubtitles] = useState<
    Array<{ name: string; url: string }>
  >([]);
  /** Source the viewer just picked, so the row shows a spinner while it starts. */
  const [pendingSourceHash, setPendingSourceHash] = useState<string | null>(null);

  const [qualities, setQualities] = useState<Array<{ level: number; label: string; detail?: string }>>([]);
  const [quality, setQuality] = useState<number>(AUTO_QUALITY);

  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<string | number>('default');

  /**
   * Audio compatibility state.
   *
   * Chromium ships no AC-3, E-AC-3 or DTS decoder, and the failure is silent —
   * the container opens, video decodes, and the audio track is dropped with no
   * error. Measured on this build: an H.264 + AC-3 file decodes 65 KB of video
   * and exactly 0 bytes of audio. So the stream is probed up front and remuxed
   * through ffmpeg when its audio cannot be played.
   */
  const [audioProbe, setAudioProbe] = useState<MediaProbe | null>(null);
  /**
   * The probe, readable from the `error` listener.
   *
   * That listener is attached once per stream and would otherwise close over
   * whatever the probe was at attach time — which is always `null`, because the
   * probe finishes later than the element starts loading.
   */
  const audioProbeRef = useRef<MediaProbe | null>(null);
  const [transcode, setTranscode] = useState<{ url: string; token: string } | null>(null);
  const [transcodeOffset, setTranscodeOffset] = useState(0);
  const [audioNeedsComponents, setAudioNeedsComponents] = useState(false);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);

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

  const currentEpisode = currentIndex >= 0 ? orderedEpisodes[currentIndex] : null;

  // --- up next -------------------------------------------------------------

  const [upNextDismissed, setUpNextDismissed] = useState(false);

  // A new episode is a new decision; a dismissal must not carry over to it.
  useEffect(() => {
    setUpNextDismissed(false);
  }, [streamUrl]);

  const secondsLeft = duration > 0 ? Math.ceil(duration - currentTime) : Infinity;
  const showUpNext = Boolean(
    nextEpisode &&
      onSelectEpisode &&
      !upNextDismissed &&
      !error &&
      duration > 0 &&
      secondsLeft <= UP_NEXT_LEAD_SECONDS
  );

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
      // When the audio needed remuxing, the loopback URL is what plays; the
      // original is left untouched and is still what everything else refers to.
      video.src = transcode?.url ?? streamUrl;
    }

    video.volume = volume;
    video.muted = isMuted;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!(window as any).__audioContext) (window as any).__audioContext = new AudioCtx();
        if ((window as any).__audioContext?.state === 'suspended') {
          (window as any).__audioContext.resume();
        }
      }
    } catch {
      // Best effort AudioContext resume
    }

    video
      .play()
      .then(() => {
        video.volume = volume;
        video.muted = isMuted;
        setIsPlaying(true);
      })
      .catch(() => {
        // Autoplay can be refused; the user can press play. Not an error state.
        setIsPlaying(false);
      });

    return () => {
      hls?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [streamUrl, mimeType, volume, isMuted, transcode?.url]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = quality;
  }, [quality]);

  // --- audio tracks (multi-audio & audio volume sync) ---------------------

  const detectAudioTracks = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const tracks: AudioTrackInfo[] = [];

    // 1. HLS audio tracks
    const hls = hlsRef.current;
    if (hls && Array.isArray(hls.audioTracks) && hls.audioTracks.length > 0) {
      hls.audioTracks.forEach((t, idx) => {
        const lang = t.lang ? t.lang.toUpperCase() : '';
        tracks.push({
          id: idx,
          label: t.name || (lang ? `Audio (${lang})` : `Track ${idx + 1}`),
          language: t.lang,
          active: hls.audioTrack === idx,
        });
      });
      if (tracks.length > 0) {
        setAudioTracks(tracks);
        const current = hls.audioTrack;
        if (current >= 0 && tracks[current]) {
          setActiveAudioTrack(tracks[current].id);
        } else if (tracks[0]) {
          setActiveAudioTrack(tracks[0].id);
        }
        return;
      }
    }

    // 2. Native HTML5 audioTracks (Chromium / Electron)
    const nativeList = (video as any).audioTracks;
    if (nativeList && nativeList.length > 0) {
      let activeId: string | number = 0;
      for (let i = 0; i < nativeList.length; i++) {
        const t = nativeList[i];
        const trackId = t.id !== undefined && t.id !== '' ? t.id : i;
        const lang = t.language ? t.language.toUpperCase() : '';
        const label = t.label || (lang ? `Audio (${lang})` : `Audio Track ${i + 1}`);
        const isEnabled = Boolean(t.enabled);
        if (isEnabled) activeId = trackId;
        tracks.push({
          id: trackId,
          label,
          language: t.language,
          active: isEnabled,
        });
      }
      setAudioTracks(tracks);
      setActiveAudioTrack(activeId);
      return;
    }

    setAudioTracks([]);
  }, []);

  const selectAudioTrack = useCallback((trackId: string | number) => {
    const video = videoRef.current;
    if (!video) return;

    // 1. Native HTML5 audioTracks
    const nativeList = (video as any).audioTracks;
    if (nativeList && nativeList.length > 0) {
      for (let i = 0; i < nativeList.length; i++) {
        const t = nativeList[i];
        const currentId = t.id !== undefined && t.id !== '' ? t.id : i;
        const match = String(currentId) === String(trackId);
        t.enabled = match;
      }
    }

    // 2. HLS.js audioTrack
    const hls = hlsRef.current;
    if (hls && typeof trackId === 'number') {
      hls.audioTrack = trackId;
    }

    setActiveAudioTrack(trackId);
    setAudioTracks((prev) =>
      prev.map((t) => ({ ...t, active: String(t.id) === String(trackId) }))
    );
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onMediaReady = () => {
      // Re-assert volume & mute settings on video load to prevent muted autoplay
      video.volume = volume;
      video.muted = isMuted;
      detectAudioTracks();
    };

    video.addEventListener('loadedmetadata', onMediaReady);
    video.addEventListener('canplay', onMediaReady);
    video.addEventListener('play', onMediaReady);

    const nativeList = (video as any).audioTracks;
    if (nativeList) {
      try {
        nativeList.addEventListener?.('change', detectAudioTracks);
        nativeList.addEventListener?.('addtrack', detectAudioTracks);
        nativeList.addEventListener?.('removetrack', detectAudioTracks);
      } catch {
        // Ignored if EventTarget methods aren't available on non-standard object
      }
    }

    const hls = hlsRef.current;
    if (hls) {
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, detectAudioTracks);
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, detectAudioTracks);
    }

    return () => {
      video.removeEventListener('loadedmetadata', onMediaReady);
      video.removeEventListener('canplay', onMediaReady);
      video.removeEventListener('play', onMediaReady);
      if (nativeList) {
        try {
          nativeList.removeEventListener?.('change', detectAudioTracks);
          nativeList.removeEventListener?.('addtrack', detectAudioTracks);
          nativeList.removeEventListener?.('removetrack', detectAudioTracks);
        } catch {}
      }
    };
  }, [streamUrl, volume, isMuted, detectAudioTracks]);

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

  // Read inside listeners registered once, so they must not close over state.
  const offsetRef = useRef(0);
  const probedDurationRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    offsetRef.current = transcode ? transcodeOffset : 0;
  }, [transcode, transcodeOffset]);
  useEffect(() => {
    probedDurationRef.current = transcode ? audioProbe?.durationSeconds : undefined;
  }, [transcode, audioProbe]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => {
      // A remuxed stream always starts at zero regardless of where the viewer
      // seeked to, so the offset is what makes the scrubber tell the truth.
      setCurrentTime(offsetRef.current + video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(offsetRef.current + video.buffered.end(video.buffered.length - 1));
      }
    };
    const onMeta = () => {
      // ffmpeg reports the remaining duration from the seek point, not the
      // whole file; the probe knows the real length.
      const probed = probedDurationRef.current;
      setDuration(probed && probed > 0 ? probed : video.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    /**
     * Names the codec rather than guessing at it.
     *
     * The old message said "HEVC is common", which is a hint and not a
     * diagnosis — it was equally shown for a dead link, a truncated file and an
     * MPEG-2 stream. The probe already knows what the video actually is, so it
     * says so, and it distinguishes the case where a conversion is available
     * from the one where nothing can be done.
     */
    const onError = () => {
      const codec = audioProbeRef.current?.videoCodec;
      const convertible = Boolean(audioProbeRef.current?.needsVideoTranscode);
      if (codec && convertible) {
        setError(
          `This file is ${codec.toUpperCase()}, which this build cannot decode directly. ` +
            `Converting it now — if it does not start shortly, install the media components ` +
            `in Settings → Advanced, or try another source.`
        );
        return;
      }
      setError(
        codec
          ? `The player could not decode this ${codec.toUpperCase()} stream. Try another source.`
          : 'The player could not decode this file. It may be an unsupported codec, or the source may be dead — try another source.'
      );
    };

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
  // it is the one thing a viewer should never have to reach for. Dismissing the
  // up-next card is read as "not this time" and suppresses the roll-on, so
  // someone sitting through the credits is not yanked out of them.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !nextEpisode || !onSelectEpisode || upNextDismissed) return;
    const onEnded = () => onSelectEpisode(nextEpisode);
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [nextEpisode, onSelectEpisode, upNextDismissed]);

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

  /**
   * Seeks, accounting for a remuxed stream having no seekable range.
   *
   * A fragmented MP4 produced live by ffmpeg carries no index, so setting
   * `currentTime` on it does nothing. Seeking is performed by restarting the
   * remux at the target time and remembering the offset, which is what keeps
   * the scrubber honest — the element always believes it is at zero.
   */
  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const target = Math.max(0, time);

      if (transcode) {
        setTranscodeOffset(target);
        const wasPlaying = !video.paused;
        video.src = `${transcode.url}?t=${Math.floor(target)}`;
        video.load();
        if (wasPlaying) void video.play().catch(() => undefined);
        return;
      }
      video.currentTime = target;
    },
    [transcode]
  );

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo((transcode ? transcodeOffset : 0) + video.currentTime + delta);
    },
    [seekTo, transcode, transcodeOffset]
  );

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

  /**
   * Controls visibility.
   *
   * Expressed as a state machine polled on a timer rather than as a chain of
   * `setTimeout`s that each reveal and re-schedule. The old shape had a genuine
   * feedback loop in it: hiding the controls changes what sits under a
   * stationary cursor, Chromium synthesises a `mousemove` for that, the handler
   * read the synthetic event as activity and revealed them again, and three
   * seconds later it repeated — controls flashing on and off while the mouse
   * was not moving at all. Toggling `cursor: none` on idle produces the same
   * event, so the loop could also start itself.
   *
   * The rule that closes it: a `mousemove` with zero `movementX`/`movementY` is
   * never activity, no matter when it arrives. Real mouse movement always
   * reports a non-zero delta; every synthetic event reports zero. There is no
   * time window to tune and no way for hiding to cause revealing.
   */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const lastActivity = useRef<number>(Date.now());
  const pointerInside = useRef(false);

  /**
   * Conditions under which the controls must stay put. Held in a ref because
   * the hide timer is scheduled once and must read the value at fire time, not
   * the value captured when it was created.
   */
  const keepControls =
    panelOpen ||
    sourcePanelOpen ||
    subtitlePanelOpen ||
    !isPlaying ||
    Boolean(error) ||
    isHoveringControls;
  const keepControlsRef = useRef(keepControls);
  useEffect(() => {
    keepControlsRef.current = keepControls;
    // Becoming pinned mid-countdown must cancel the pending hide, not wait for
    // it to fire and be ignored.
    if (keepControls) setControlsVisible(true);
  }, [keepControls]);

  /** Real movement reports a non-zero delta; a synthetic event reports zero. */
  const isRealMove = (native: MouseEvent): boolean => {
    if (typeof native.movementX === 'number' && typeof native.movementY === 'number') {
      return native.movementX !== 0 || native.movementY !== 0;
    }
    // Some event sources omit `movement*`; fall back to a position change.
    const last = lastPointer.current;
    return !last || native.clientX !== last.x || native.clientY !== last.y;
  };

  const revealControls = useCallback((event?: React.MouseEvent | MouseEvent) => {
    if (event) {
      const native = ((event as React.MouseEvent).nativeEvent ?? event) as MouseEvent;
      const real = isRealMove(native);
      lastPointer.current = { x: native.clientX, y: native.clientY };
      if (!real) return;
    }
    lastActivity.current = Date.now();
    setControlsVisible(true);
  }, []);

  /**
   * The single place the controls are allowed to hide.
   *
   * Polled rather than scheduled, so there is exactly one decision-maker and no
   * pending timer can fire against state that has since changed. `keepControls`
   * is read through a ref for the same reason.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (keepControlsRef.current) return;
      // Leaving the player hides immediately: the pointer is somewhere else and
      // the chrome is just covering the picture.
      const idle = Date.now() - lastActivity.current > CONTROLS_IDLE_MS;
      if (!pointerInside.current || idle) setControlsVisible(false);
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  const handlePlayerEnter = useCallback(() => {
    pointerInside.current = true;
    lastActivity.current = Date.now();
    setControlsVisible(true);
  }, []);

  const handlePlayerLeave = useCallback(() => {
    pointerInside.current = false;
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

  /**
   * True while the session is still producing a stream.
   *
   * This overlay outranks the buffering one: with no picture behind it yet,
   * "buffering from peers" would be describing a swarm that has not been chosen.
   */
  const isResolving = Boolean(sourceSession && sourceSession.phase !== 'playing');

  // A switch that has landed clears the row spinner; comparing against the
  // session's active hash avoids leaving it spinning when the start failed.
  useEffect(() => {
    if (!sourceSession) return;
    if (sourceSession.phase === 'playing' || sourceSession.phase === 'error') {
      setPendingSourceHash(null);
    }
  }, [sourceSession?.phase, sourceSession?.activeInfoHash]);

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  /**
   * Probes the stream's audio and remuxes it when Chromium cannot decode it.
   *
   * Runs on every new stream. HLS is excluded: hls.js handles its own
   * demuxing and its segments are already in a browser-friendly codec set.
   */
  useEffect(() => {
    if (!streamUrl) return;
    const isHls = /\.m3u8(\?|$)/i.test(streamUrl) || mimeType === 'application/x-mpegURL';
    if (isHls) return;

    let cancelled = false;
    let openedToken: string | null = null;

    (async () => {
      const response = await window.cloudstream?.probeMedia(streamUrl);
      if (cancelled || !response) return;

      setAudioNeedsComponents(Boolean(response.needsComponents));
      if (!response.ok || !response.probe) return;

      setAudioProbe(response.probe);
      const preferred = response.probe.audio.find((a) => a.isDefault) ?? response.probe.audio[0];
      if (preferred) setSelectedAudioIndex(preferred.index);

      if (!response.probe.needsTranscode) return;

      /**
       * Video is only re-encoded when the probe says it cannot be decoded.
       *
       * The audio case copies the video and is nearly free; this one is not, so
       * the flag is passed through rather than transcoding both whenever either
       * needs it.
       */
      const session = await window.cloudstream?.openMediaTranscode(
        streamUrl,
        preferred?.index ?? 0,
        response.probe.needsVideoTranscode
      );
      if (cancelled || !session?.ok || !session.url) return;

      openedToken = session.url.split('/').pop() ?? null;
      setTranscodeOffset(0);
      setTranscode({ url: session.url, token: openedToken ?? '' });
    })();

    return () => {
      cancelled = true;
      // The ffmpeg process outlives the component otherwise.
      if (openedToken) void window.cloudstream?.closeMediaTranscode(openedToken);
    };
  }, [streamUrl, mimeType]);

  useEffect(() => {
    audioProbeRef.current = audioProbe;
  }, [audioProbe]);

  // A new stream invalidates everything learned about the previous one.
  useEffect(() => {
    setAudioProbe(null);
    setTranscode(null);
    setTranscodeOffset(0);
    setAudioNeedsComponents(false);
  }, [streamUrl]);

  /**
   * Switches audio track. On a remuxed stream this restarts ffmpeg mapping the
   * chosen track, because the element only ever receives the one stereo track
   * that was selected for it.
   */
  const selectProbedAudio = useCallback(
    async (index: number) => {
      setSelectedAudioIndex(index);
      if (!transcode) return;

      const video = videoRef.current;
      const at = transcodeOffset + (video?.currentTime ?? 0);
      const session = await window.cloudstream?.openMediaTranscode(
        streamUrl,
        index,
        audioProbe?.needsVideoTranscode ?? false
      );
      if (!session?.ok || !session.url) return;

      if (transcode.token) void window.cloudstream?.closeMediaTranscode(transcode.token);
      setTranscodeOffset(at);
      setTranscode({ url: session.url, token: session.url.split('/').pop() ?? '' });
    },
    [transcode, transcodeOffset, streamUrl, audioProbe]
  );

  /** Audio tracks as ffprobe reported them, labelled for the picker. */
  const probedAudioTracks = useMemo(
    () =>
      (audioProbe?.audio ?? []).map((track) => {
        const language = track.language && track.language !== 'und'
          ? track.language.toUpperCase()
          : null;
        const name = track.title || language || `Track ${track.index + 1}`;
        const facts = [
          track.codec.toUpperCase(),
          track.channels === 6 ? '5.1' : track.channels === 2 ? 'Stereo' : undefined,
          // Worth saying: it is why this track sounds different from the file.
          track.playable ? undefined : 'converted',
        ].filter(Boolean);
        return { index: track.index, label: name, detail: facts.join(' · ') };
      }),
    [audioProbe]
  );

  /** Subtitles shipped with the stream, plus any fetched from online search. */
  const allSubtitles = useMemo(() => {
    const combined = [...subtitles, ...fetchedSubtitles];
    const englishFirst = combined.sort((a, b) => {
      const aIsEnglish = /english|eng/i.test(a.name);
      const bIsEnglish = /english|eng/i.test(b.name);
      if (aIsEnglish && !bIsEnglish) return -1;
      if (!aIsEnglish && bIsEnglish) return 1;
      return 0;
    });
    return englishFirst;
  }, [subtitles, fetchedSubtitles]);

  /**
   * Applies the selected subtitle by driving `TextTrack.mode` directly.
   *
   * Setting the `default` attribute on a `<track>` only has an effect before
   * the element loads; changing it afterwards, which is what a React re-render
   * does, switches nothing. That made subtitle selection silently inert. The
   * mode property is the runtime control and has to be set on every track,
   * including the ones being turned off.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const apply = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const source = allSubtitles[i];
        track.mode = source && source.url === activeSubtitle ? 'showing' : 'disabled';
      }
    };

    apply();
    // A track added in the same render is not in `video.textTracks` yet.
    video.textTracks.addEventListener?.('addtrack', apply);
    return () => video.textTracks.removeEventListener?.('addtrack', apply);
  }, [activeSubtitle, allSubtitles]);

  // Blob URLs from the subtitle search are owned by this component; leaking
  // them would pin every subtitle a viewer auditioned for the session's life.
  useEffect(
    () => () => {
      for (const sub of fetchedSubtitles) URL.revokeObjectURL(sub.url);
    },
    [fetchedSubtitles]
  );

  // Close any open side-panel when the user clicks outside it on the player.
  const handlePlayerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!panelOpen && !sourcePanelOpen && !subtitlePanelOpen) return;
      const target = e.target as HTMLElement;
      // If the click is inside a .player-panel element, leave it open.
      if (target.closest('.player-panel')) return;
      // Also ignore clicks on the toolbar buttons that toggle the panels.
      if (target.closest('[data-panel-toggle]')) return;
      setPanelOpen(false);
      setSourcePanelOpen(false);
      setSubtitlePanelOpen(false);
    },
    [panelOpen, sourcePanelOpen, subtitlePanelOpen]
  );

  return (
    <div
      ref={containerRef}
      className={`player${controlsVisible || keepControls ? '' : ' player--idle'}`}
      onMouseMove={revealControls}
      onMouseEnter={handlePlayerEnter}
      onMouseLeave={handlePlayerLeave}
      onPointerDown={handlePlayerPointerDown}
    >
      <video
        ref={videoRef}
        className={`player__video player__video--${aspect}`}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        crossOrigin="anonymous"
      >
        {/* Selection is driven by TextTrack.mode in the effect above, not by
            `default` — see there for why. */}
        {allSubtitles.map((sub) => (
          <track key={sub.url} kind="subtitles" label={sub.name} src={sub.url} />
        ))}
      </video>

      {/* Resolving a source for another episode happens over the live player, so
          it needs its own overlay — the buffering one belongs to the stream that
          is still playing underneath. */}
      {switchingTo && (
        <div className="player__overlay">
          <Loader2 className="spin" size={36} />
          <p>
            Loading {switchingTo.season != null && switchingTo.episode != null
              ? `S${switchingTo.season} E${switchingTo.episode} — `
              : ''}
            {switchingTo.name}
          </p>
          <span className="muted">Searching sources and starting the best one…</span>
        </div>
      )}

      {switchError && !switchingTo && (
        <div className="player__overlay">
          <AlertTriangle size={36} />
          <p>{switchError}</p>
          <div className="player__overlay-actions">
            {series && (
              <button className="btn btn-primary" onClick={() => setPanelOpen(true)}>
                <List size={16} /> Pick another episode
              </button>
            )}
            <button className="btn" onClick={onBack}>Back</button>
          </div>
        </div>
      )}

      {isResolving && sourceSession && !switchingTo && (
        <SourceResolveOverlay
          phase={sourceSession.phase === 'playing' ? 'starting' : sourceSession.phase}
          sources={sourceSession.sources}
          searched={sourceSession.searched}
          totalIndexers={sourceSession.totalIndexers}
          lastIndexerName={sourceSession.lastIndexerName}
          searchDone={sourceSession.searchDone}
          error={sourceSession.error}
          title={title}
          episodeTitle={episodeTitle}
          attempts={sourceSession.attempts}
          onPlayNow={sourceSession.onPlayNow}
          onOpenSources={() => setSourcePanelOpen(true)}
          onRetry={sourceSession.onRefresh}
          onBack={onBack}
        />
      )}

      {(isBuffering || error) && !switchingTo && !switchError && !isResolving && (
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
              {stats?.isStalled && (
                <>
                  <span className="muted">
                    Nothing has arrived for {Math.round(stats.stalledMs / 1000)}s
                    {stats.peers === 0 ? ' and no peers have connected' : ''}. This swarm
                    is probably dead.
                  </span>
                  <button className="btn" onClick={onBack}>Choose another source</button>
                </>
              )}
              {stats && !stats.isStalled && stats.peers === 0 && (
                <span className="muted">
                  No peers yet. If this persists the swarm may be dead — try a source with more seeders.
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* Silence with no error is the worst possible failure mode: the volume
          control works, the video plays, and nothing says why. If the audio
          cannot be decoded and the components that would fix it are missing,
          say so on screen. */}
      {audioNeedsComponents && audioProbe?.needsTranscode && (
        <div className="player__audio-notice">
          <AlertTriangle size={14} />
          <span>
            This file&rsquo;s audio uses a format Windows cannot play here. Install
            the media components in Settings to enable it.
          </span>
        </div>
      )}

      <header
        className={`player__top${controlsVisible || keepControls ? '' : ' hidden'}`}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
      >
        <button className="icon-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="player__titles">
          <h2>{title}</h2>
          {(episodeTitle || currentEpisode) && (
            <p>
              {/* Where you are in the series belongs on screen, not one click
                  away in a panel — it is the first thing a viewer checks. */}
              {currentEpisode?.season != null && currentEpisode?.episode != null && (
                <span className="player__episode-badge">
                  S{currentEpisode.season} · E{currentEpisode.episode}
                </span>
              )}
              {episodeTitle ?? currentEpisode?.name}
              {series && orderedEpisodes.length > 0 && currentIndex >= 0 && (
                <span className="player__episode-count">
                  {currentIndex + 1} of {orderedEpisodes.length}
                </span>
              )}
            </p>
          )}
        </div>
        {stats && (
          <div className="player__stats">
            <span title="Peers"><Users size={14} /> {stats.peers}</span>
            <span title="Download speed"><Gauge size={14} /> {formatSpeed(stats.downloadSpeed)}</span>
          </div>
        )}
      </header>

      {showUpNext && nextEpisode && (
        <UpNextCard
          episode={nextEpisode}
          secondsRemaining={secondsLeft}
          countdownFrom={UP_NEXT_LEAD_SECONDS}
          isLoading={Boolean(switchingTo)}
          onPlayNow={() => onSelectEpisode?.(nextEpisode)}
          onDismiss={() => setUpNextDismissed(true)}
        />
      )}

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

      {sourceSession && (
        <SourcePanel
          open={sourcePanelOpen}
          sources={sourceSession.sources}
          activeInfoHash={sourceSession.activeInfoHash}
          searching={!sourceSession.searchDone}
          searched={sourceSession.searched}
          totalIndexers={sourceSession.totalIndexers}
          switchingTo={pendingSourceHash}
          error={sourceSession.phase === 'error' ? sourceSession.error : undefined}
          onClose={() => setSourcePanelOpen(false)}
          onSelect={(source) => {
            setPendingSourceHash(source.infoHash);
            sourceSession.onSelectSource(source);
            // Close on choose: the panel covers the video, and leaving it up
            // over the stream the viewer just asked for is what made picking a
            // source feel like nothing had happened.
            setSourcePanelOpen(false);
          }}
          onRefresh={sourceSession.onRefresh}
          onDownload={sourceSession.onDownloadSource}
        />
      )}

      <SubtitlePanel
        open={subtitlePanelOpen}
        imdbId={subtitleContext?.imdbId}
        // Lets the extension provider be asked for the subtitles it published
        // with the stream, which is the only set that exists for a title no
        // catalogue carries and so has no IMDb id to search by.
        mediaUrl={progress?.mediaUrl}
        season={subtitleContext?.season}
        episode={subtitleContext?.episode}
        embedded={subtitles}
        activeUrl={activeSubtitle}
        onClose={() => setSubtitlePanelOpen(false)}
        onSelect={(url, label) => {
          if (url && !allSubtitles.some((s) => s.url === url)) {
            setFetchedSubtitles((prev) => [...prev, { name: label, url }]);
          }
          setActiveSubtitle(url);
        }}
      />

      <footer
        className={`player__controls${controlsVisible || keepControls ? '' : ' hidden'}`}
        onMouseEnter={() => setIsHoveringControls(true)}
        onMouseLeave={() => setIsHoveringControls(false)}
      >
        <div
          ref={seekBarRef}
          className="player__seek"
          onMouseMove={onSeekHover}
          onMouseLeave={onSeekLeave}
          onClick={onSeekClick}
        >
          {/* The full timeline, so the ungathered part of the film is still
              represented on screen rather than simply absent. */}
          <div className="player__seek-track" />
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
              data-panel-toggle
              onClick={() => setPanelOpen((v) => !v)}
              aria-label="Episodes"
              title="Episodes (E)"
            >
              <List size={18} />
            </button>
          )}

          {sourceSession && (
            <button
              className="icon-button"
              data-panel-toggle
              onClick={() => setSourcePanelOpen((v) => !v)}
              aria-label="Sources"
              title="Change source"
            >
              <Radio size={18} />
              {sourceSession.sources.length > 0 && (
                <span className="icon-button__badge">{sourceSession.sources.length}</span>
              )}
            </button>
          )}

          {/* Subtitle search sits next to the track picker rather than inside
              it: finding a subtitle and choosing one are different actions, and
              a hover menu is the wrong shape for a search result list. */}
          <button
            className="icon-button"
            data-panel-toggle
            onClick={() => setSubtitlePanelOpen((v) => !v)}
            aria-label="Search subtitles"
            title="Search subtitles online"
          >
            <Subtitles size={18} />
          </button>

          {onDownloadCurrent && (
            <button
              className="icon-button"
              onClick={onDownloadCurrent}
              aria-label="Download"
              title="Download what is playing"
            >
              <Download size={18} />
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

          {allSubtitles.length > 0 && (
            <HoverMenu
              icon={<Subtitles size={16} />}
              label="Subtitles"
              value={activeSubtitle ?? ''}
              onChange={(next) => setActiveSubtitle(next === '' ? null : String(next))}
              triggerText={
                activeSubtitle
                  ? (allSubtitles.find((s) => s.url === activeSubtitle)?.name ?? 'On')
                  : 'Off'
              }
              options={[
                { value: '', label: 'Off' },
                ...allSubtitles.map((sub) => ({ value: sub.url, label: sub.name })),
              ]}
            />
          )}

          {/* Probed tracks take precedence over the element's own list: a
              `<video>` does not expose tracks it cannot decode at all, so the
              AC-3 Japanese dub simply would not appear without the probe. */}
          {probedAudioTracks.length > 1 ? (
            <HoverMenu
              icon={<Volume2 size={16} />}
              label="Audio"
              value={selectedAudioIndex}
              onChange={(val) => void selectProbedAudio(Number(val))}
              triggerText={
                probedAudioTracks.find((t) => t.index === selectedAudioIndex)?.label ?? 'Audio'
              }
              options={probedAudioTracks.map((track) => ({
                value: track.index,
                label: track.label,
                detail: track.detail,
              }))}
            />
          ) : (
            audioTracks.length > 1 && (
              <HoverMenu
                icon={<Volume2 size={16} />}
                label="Audio"
                value={activeAudioTrack}
                onChange={(val) => selectAudioTrack(val)}
                triggerText={
                  audioTracks.find((a) => String(a.id) === String(activeAudioTrack))?.label ?? 'Audio'
                }
                options={audioTracks.map((track) => ({
                  value: track.id,
                  label: track.label,
                  detail: track.language ? track.language.toUpperCase() : undefined,
                }))}
              />
            )
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
