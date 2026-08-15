import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft,
  Loader2, Users, Gauge, Subtitles, AlertTriangle, RotateCcw, RotateCw,
  SkipBack, SkipForward, List, Settings2, MonitorPlay, Radio,
  HardDriveDownload, FolderDown, GripHorizontal, Maximize2, Minimize2, X,
} from 'lucide-react';
import type { TorrentStreamStats } from '../types/torrent';
import type { Episode } from '../types/api';
import { AspectRatioMode } from '../types/player';
import type { TorrentResult } from '../types/torrent';
import type { DownloadTask } from '../types/download';
import { DownloadState } from '../types/download';
import { HoverMenu } from './player/HoverMenu';
import { EpisodePanel } from './player/EpisodePanel';
import { SourcePanel } from './player/SourcePanel';
import { SourceResolveOverlay } from './player/SourceResolveOverlay';
import { SubtitlePanel } from './player/SubtitlePanel';
import { PlayerDownloadPanel } from './player/PlayerDownloadPanel';
import type { MediaProbe, ProbeFailure } from '../../electron/mediaTranscoder';
import type { SeriesContext } from './player/seriesContext';
import { UpNextCard } from './player/UpNextCard';
import { useTimelinePreview } from './player/useTimelinePreview';
import { useMiniFrame } from './player/useMiniFrame';
import { CopyErrorButton } from './CopyErrorButton';
import { ExternalPlayerFallback } from './player/ExternalPlayerFallback';

interface VideoPlayerProps {
  streamUrl: string;
  mimeType: string;
  title: string;
  originalTitle?: string;
  episodeTitle?: string;
  providerProvenance?: {
    provider?: string;
    repositoryName?: string;
    extensionName?: string;
    indexerName?: string;
  };
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
  /**
   * Opens the full Downloads screen, leaving this player running behind it.
   *
   * The in-player panel is deliberately a summary — enough to see that a
   * download is progressing and to pause it — and everything else (the whole
   * queue, completed items, where files landed) lives on the Downloads screen.
   * Without a way through, the only route there was to close the player.
   */
  onOpenDownloads?: () => void;
  /**
   * Rendered but not shown, because the viewer has stepped out to another
   * screen.
   *
   * Not the same as unmounting. The `<video>` element *is* the playback: take it
   * out of the tree and the stream stops, the position is lost, and returning
   * means starting the whole discovery-and-buffer sequence again. Hiding keeps
   * all of it, at the cost of having to disarm anything global — see the
   * keyboard handler, which would otherwise let a stray space bar on the
   * Downloads screen pause a film the viewer cannot see.
   */
  hidden?: boolean;
  /**
   * Shrunk to a floating window, still playing, while the rest of the app is used.
   *
   * The same element in the same place in the tree as the full-screen player —
   * only its geometry changes. That is not an implementation detail: the
   * `<video>` *is* the playback, so anything that unmounts and remounts it to
   * change size would drop the buffer, lose the position, and re-negotiate the
   * swarm. Minimising has to be free, or nobody will use it twice.
   */
  mini?: boolean;
  /** Shrinks the player without ending the session. */
  onMinimize?: () => void;
  /** Returns the mini player to full size. */
  onExpand?: () => void;
  sourceSession?: {
    phase: PlaybackPhase;
    sources: TorrentResult[];
    activeInfoHash?: string;
    searched: number;
    totalIndexers: number;
    lastIndexerName?: string;
    searchDone: boolean;
    /** True when the viewer stopped the search rather than it running out. */
    searchCancelled?: boolean;
    error?: string;
    attempts: Array<{ title: string; indexerName: string; error: string }>;
    onPlayNow: () => void;
    onSelectSource: (source: TorrentResult) => void;
    /**
     * Abandons a source that started but will not play.
     *
     * Only the renderer can detect this: discovery already fails over when a
     * stream will not *start*, but one that starts fine and then cannot be
     * decoded looks like success from the main process.
     */
    onSourceUnplayable?: (reason: string) => void;
    onRefresh: () => void;
    /** Stops waiting for the remaining providers, keeping what has arrived. */
    onCancelSearch?: () => void;
    onDownloadSource?: (source: TorrentResult) => void;
  };
  /** When provided, overrides the stored setting for showing aspect ratio control (default false) */
  showAspectRatioControl?: boolean;
  /** When provided, overrides the stored setting for showing playback speed control (default false) */
  showPlaybackSpeedControl?: boolean;
  /** When provided, overrides the stored setting for showing subtitles control (default true) */
  showSubtitlesControl?: boolean;
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
  streamUrl, mimeType, title, originalTitle, episodeTitle, providerProvenance,
  infoHash, subtitles, onBack, series, onSelectEpisode, switchingTo, switchError,
  progress, sourceSession, subtitleContext, onDownloadCurrent, onOpenDownloads,
  hidden = false, mini = false, onMinimize, onExpand, showAspectRatioControl,
  showPlaybackSpeedControl, showSubtitlesControl: showSubtitlesControlProp,
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
  const [showSpeedControl, setShowSpeedControl] = useState(showPlaybackSpeedControl ?? false);
  const [showAspectControl, setShowAspectControl] = useState(showAspectRatioControl ?? false);
  const [showSubtitlesControl, setShowSubtitlesControl] = useState(showSubtitlesControlProp ?? true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isHoveringControls, setIsHoveringControls] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<TorrentStreamStats | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false);
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const [downloadQueue, setDownloadQueue] = useState<DownloadTask[]>([]);

  const activeSource = useMemo(() => {
    if (!sourceSession) return null;
    return (
      sourceSession.sources.find((s) => s.infoHash === sourceSession.activeInfoHash) ??
      sourceSession.sources[0] ??
      null
    );
  }, [sourceSession]);

  const [resolvedProvenance, setResolvedProvenance] = useState<{
    provider?: string;
    repositoryName?: string;
    extensionName?: string;
  } | null>(null);

  const effectiveProvider =
    providerProvenance?.provider || activeSource?.providerName || activeSource?.indexerName;

  useEffect(() => {
    let active = true;
    const cs = window.cloudstream;
    if (!effectiveProvider || !cs?.getProviderProvenance) return;
    void (async () => {
      const res = await cs.getProviderProvenance(effectiveProvider);
      if (active && res?.ok && res.provenance) {
        setResolvedProvenance(res.provenance);
      }
    })();
    return () => {
      active = false;
    };
  }, [effectiveProvider]);

  useEffect(() => {
    let active = true;
    const loadPlayerControlsSettings = async () => {
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
          window.cloudstream.getSetting('default_aspect_ratio', ''),
          window.cloudstream.getSetting('default_playback_speed', ''),
          window.cloudstream.getSetting('player_subtitles_enabled_key', 'true'),
          window.cloudstream.getSetting('player_show_subtitles', 'true'),
        ]);
        if (active) {
          if (showPlaybackSpeedControl === undefined) {
            setShowSpeedControl(speedEnabled === 'true' || customSpeed === 'true');
          }
          if (showAspectRatioControl === undefined) {
            setShowAspectControl(resizeEnabled === 'true' || customAspect === 'true');
          }
          if (showSubtitlesControlProp === undefined) {
            setShowSubtitlesControl(subsEnabled !== 'false' && customSubs !== 'false');
          }
          if (savedAspect && Object.values(AspectRatioMode).includes(savedAspect as AspectRatioMode)) {
            setAspect(savedAspect as AspectRatioMode);
          }
          if (savedSpeed && !isNaN(Number(savedSpeed)) && Number(savedSpeed) > 0) {
            setSpeed(Number(savedSpeed));
          }
        }
      } catch {
        // Defaults to false
      }
    };
    void loadPlayerControlsSettings();
    return () => {
      active = false;
    };
  }, [showPlaybackSpeedControl, showAspectRatioControl, showSubtitlesControlProp]);

  useEffect(() => {
    let active = true;
    window.cloudstream?.getDownloadQueue?.().then((tasks) => {
      if (active && tasks) setDownloadQueue(tasks);
    });

    const unsub = window.cloudstream?.onDownloadProgress?.((tasks) => {
      if (active && tasks) setDownloadQueue(tasks);
    });

    return () => {
      active = false;
      if (unsub) unsub();
    };
  }, []);

  const currentDownload = useMemo(() => {
    const norm = (s?: string) => s?.toLowerCase().trim() || '';
    const normTitle = norm(title);
    return downloadQueue.find(
      (t) =>
        (normTitle && (norm(t.title) === normTitle || norm(t.title).startsWith(normTitle))) ||
        (t.mediaUrl && progress?.mediaUrl && t.mediaUrl === progress.mediaUrl) ||
        (t.link?.url && streamUrl && t.link.url === streamUrl) ||
        (infoHash && t.id.includes(infoHash))
    );
  }, [downloadQueue, title, progress?.mediaUrl, streamUrl, infoHash]);

  const handleDownloadCurrentMedia = useCallback(async () => {
    if (onDownloadCurrent) {
      onDownloadCurrent();
      return;
    }

    const activeSource =
      sourceSession?.sources?.find(
        (s) => s.infoHash === (sourceSession.activeInfoHash || infoHash)
      ) ?? sourceSession?.sources?.[0];

    if (activeSource && sourceSession?.onDownloadSource) {
      sourceSession.onDownloadSource(activeSource);
      return;
    }

    const downloadUrl =
      activeSource?.directUrl ||
      activeSource?.magnet ||
      activeSource?.torrentUrl ||
      streamUrl;
    if (!downloadUrl) return;

    const taskTitle = title + (episodeTitle ? ` - ${episodeTitle}` : '');
    const taskId = `dl-${infoHash || Date.now()}-${taskTitle}`.replace(
      /[^a-zA-Z0-9-_]/g,
      '_'
    );

    const task: DownloadTask = {
      id: taskId,
      parentId: progress?.mediaUrl || '',
      title: taskTitle,
      episodeNumber: subtitleContext?.episode,
      seasonNumber: subtitleContext?.season,
      posterUrl: '',
      targetFilePath: '',
      link: {
        source: activeSource?.indexerName || 'Player Stream',
        name: activeSource?.title || taskTitle,
        url: downloadUrl,
        referer:
          activeSource?.directHeaders?.Referer ||
          activeSource?.directHeaders?.referer ||
          '',
        quality: activeSource?.parsed?.resolution || 1080,
      },
      headers: activeSource?.directHeaders || {},
      bytesDownloaded: 0,
      totalBytes: activeSource?.sizeBytes || 0,
      downloadSpeed: 0,
      etaSeconds: 0,
      state: DownloadState.Queued,
      providerName: activeSource?.indexerName || 'Current Stream',
      createdTime: Date.now(),
      mediaUrl: progress?.mediaUrl || streamUrl,
      resolution: activeSource?.parsed?.resolution,
    };

    await window.cloudstream?.enqueueDownload?.(task);
    const queue = await window.cloudstream?.getDownloadQueue?.();
    if (queue) setDownloadQueue(queue);
  }, [
    onDownloadCurrent,
    sourceSession,
    infoHash,
    streamUrl,
    title,
    episodeTitle,
    progress?.mediaUrl,
    subtitleContext,
  ]);

  const activeDownloadsCount = useMemo(() => {
    return downloadQueue.filter(
      (t) =>
        t.state === DownloadState.Downloading ||
        t.state === DownloadState.Queued ||
        t.state === DownloadState.RefreshingSource ||
        t.state === DownloadState.Retrying
    ).length;
  }, [downloadQueue]);
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
  /**
   * Why the probe came back empty, when it did.
   *
   * Separates "this link is a 404" from "this format cannot be decoded". They
   * were being reported as one sentence offering both, and only one of them is
   * worth opening another player for.
   */
  const [probeFailure, setProbeFailure] = useState<ProbeFailure | null>(null);
  const probeFailureRef = useRef<ProbeFailure | null>(null);
  /**
   * Asks for the next source, at most once per stream.
   *
   * Held in a ref because the `error` listener is attached once per stream and
   * would otherwise close over a stale callback. Latched because a failing
   * element can fire `error` repeatedly, and each one would burn another
   * candidate off a list that is not long.
   */
  const skipRef = useRef<((reason: string) => void) | null>(null);
  const skippedFor = useRef<string | null>(null);
  /**
   * Forces a remux of the current URL, once, before giving up on it.
   *
   * A link that downloads at full speed is a good link — the reported case was
   * an 860 MB file that fetched perfectly and would not play, because H.264 in
   * Matroska is not something Chromium can demux. Abandoning it for a different
   * source throws away a working URL to go looking for another one that may
   * have exactly the same problem.
   *
   * So the ladder per source is: play it raw, and if that fails push it through
   * ffmpeg unconditionally, and only if *that* fails rule the source out. The
   * forced pass does not consult the probe — this runs precisely when the probe
   * has already been wrong about something.
   */
  const forceTranscodeRef = useRef<(() => void) | null>(null);
  const forcedFor = useRef<string | null>(null);
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

        // Record successful playback event in history
        window.cloudstream?.recordHistoryEvent?.({
          title,
          year: progress?.year,
          type: progress?.season !== undefined ? 'series' : 'movie',
          posterUrl: progress?.posterUrl,
          mediaUrl: progress?.mediaUrl || streamUrl,
          episodeTitle,
          season: progress?.season,
          episode: progress?.episode,
          action: 'playback_started',
          status: 'Played',
          durationSeconds: video.duration || undefined,
          source: {
            sourceName: title,
            quality: undefined,
            directUrl: streamUrl.startsWith('http') ? streamUrl : undefined,
          },
        });
      })
      .catch((err) => {
        setIsPlaying(false);
        // Autoplay may be blocked; user interaction will start it
        if (err?.name !== 'NotAllowedError') {
          window.cloudstream?.recordHistoryEvent?.({
            title,
            year: progress?.year,
            type: progress?.season !== undefined ? 'series' : 'movie',
            posterUrl: progress?.posterUrl,
            mediaUrl: progress?.mediaUrl || streamUrl,
            episodeTitle,
            season: progress?.season,
            episode: progress?.episode,
            action: 'playback_failed',
            status: 'Failed',
            failureReason: err?.message || 'Video element playback rejected',
          });
        }
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
      // The source answering 404 outranks anything guessed about codecs.
      const failure = probeFailureRef.current;
      if (failure) {
        // A dead source is not a conversion problem; remuxing a 404 is pointless.
        setError(failure.reason);
        skipRef.current?.(failure.reason);
        return;
      }
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
      const message = codec
        ? `The player could not decode this ${codec.toUpperCase()} stream.`
        : 'The player could not decode this file.';

      // Convert first, abandon second. See `forceTranscodeRef`.
      if (forcedFor.current !== streamUrl) {
        setError(`${message} Converting it and trying again…`);
        forceTranscodeRef.current?.();
        return;
      }

      setError(message);
      skipRef.current?.(message);
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
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await container.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch (err) {
      console.warn('Failed to toggle fullscreen:', err);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        setControlsVisible(true);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    // Still mounted, but the viewer is looking at another screen. Leaving this
    // bound would make typing in a search box seek the film.
    //
    // The mini player is disarmed for the same reason and it matters more
    // there: it is *visible*, so it looks like it has focus, and the whole
    // point of it is that the viewer is typing somewhere else. A space bar in
    // the search box must not pause the film.
    if (hidden || mini) return;

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
        case 'Escape':
          if (panelOpen || sourcePanelOpen || subtitlePanelOpen || downloadPanelOpen) {
            setPanelOpen(false);
            setSourcePanelOpen(false);
            setSubtitlePanelOpen(false);
            setDownloadPanelOpen(false);
          } else if (!document.fullscreenElement) {
            onBack();
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    togglePlay, seekBy, toggleFullscreen, onBack, series, nextEpisode, previousEpisode,
    onSelectEpisode, panelOpen, sourcePanelOpen, subtitlePanelOpen, downloadPanelOpen,
    hidden, mini,
  ]);

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
   *
   * In windowed (non-fullscreen) mode, controls are kept visible. In fullscreen
   * mode, controls auto-hide after inactivity and appear on mouse movement.
   */
  const keepControls =
    panelOpen ||
    sourcePanelOpen ||
    subtitlePanelOpen ||
    downloadPanelOpen ||
    !isPlaying ||
    Boolean(error) ||
    isHoveringControls ||
    (!isFullscreen && !mini);
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
      if (native.movementX !== 0 || native.movementY !== 0) return true;
    }
    // Some event sources omit `movement*`; fall back to a position change.
    const last = lastPointer.current;
    if (!last) return true;
    return native.clientX !== last.x || native.clientY !== last.y;
  };

  const revealControls = useCallback((event?: React.MouseEvent | MouseEvent) => {
    if (event) {
      const native = ((event as React.MouseEvent).nativeEvent ?? event) as MouseEvent;
      const real = isRealMove(native);
      lastPointer.current = { x: native.clientX, y: native.clientY };
      if (!real) return;
    }
    pointerInside.current = true;
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
    lastPointer.current = null;
    setIsHoveringControls(false);
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
      // A probe that produced nothing now says why, and the source's own HTTP
      // status is the difference between "expired link" and "odd codec".
      if (response.failure) setProbeFailure(response.failure);
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
        response.probe.needsVideoTranscode,
        // Container-only problems copy the audio; re-encoding a perfectly good
        // track to reach a different wrapper is work for nothing.
        response.probe.needsAudioTranscode
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

  useEffect(() => {
    probeFailureRef.current = probeFailure;
  }, [probeFailure]);

  /**
   * The forced conversion pass.
   *
   * Deliberately ignores the probe: it runs only after the probe's verdict has
   * already proved wrong. Video is copied unless the probe positively said it
   * could not be decoded — the common case is a container problem, where a copy
   * is nearly free, and re-encoding video on a guess would burn a CPU for
   * nothing.
   */
  useEffect(() => {
    forceTranscodeRef.current = () => {
      if (forcedFor.current === streamUrl) return;
      forcedFor.current = streamUrl;

      void (async () => {
        const previous = transcode?.token;
        const at = transcodeOffset + (videoRef.current?.currentTime ?? 0);

        // Fetch probe if not available yet (resolves race condition when video errors before probe finishes)
        let probe = audioProbeRef.current;
        if (!probe) {
          const res = await window.cloudstream?.probeMedia(streamUrl);
          if (res?.ok && res.probe) {
            probe = res.probe;
            setAudioProbe(probe);
          }
        }

        const urlLower = streamUrl.toLowerCase();
        const isHevc = Boolean(
          probe?.needsVideoTranscode ||
            probe?.videoCodec === 'hevc' ||
            probe?.videoCodec === 'h265' ||
            urlLower.includes('hevc') ||
            urlLower.includes('x265') ||
            urlLower.includes('10bit')
        );
        const isAudioTranscode = probe ? probe.needsAudioTranscode : true;

        const session = await window.cloudstream?.openMediaTranscode(
          streamUrl,
          selectedAudioIndex ?? 0,
          isHevc,
          isAudioTranscode
        );
        if (!session?.ok || !session.url) {
          // Conversion is unavailable; the source has had its chance.
          skipRef.current?.('This file could not be converted for playback.');
          return;
        }
        if (previous) void window.cloudstream?.closeMediaTranscode(previous);
        setError(null);
        setTranscodeOffset(at);
        setTranscode({ url: session.url, token: session.url.split('/').pop() ?? '' });
      })();
    };
  }, [streamUrl, transcode?.token, transcodeOffset, selectedAudioIndex]);

  useEffect(() => {
    const skip = sourceSession?.onSourceUnplayable;
    skipRef.current = skip
      ? (reason: string) => {
          if (skippedFor.current === streamUrl) return;
          skippedFor.current = streamUrl;
          skip(reason);
        }
      : null;
  }, [sourceSession?.onSourceUnplayable, streamUrl]);

  // A new stream invalidates everything learned about the previous one.
  useEffect(() => {
    setAudioProbe(null);
    setProbeFailure(null);
    forcedFor.current = null;
    skippedFor.current = null;
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
        audioProbe?.needsVideoTranscode ?? false,
        audioProbe?.needsAudioTranscode ?? true
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

  // Close any open side-panel when the user clicks outside it on the player, and reveal controls.
  const handlePlayerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      revealControls(e);
      if (!panelOpen && !sourcePanelOpen && !subtitlePanelOpen && !downloadPanelOpen) return;
      const target = e.target as HTMLElement;
      // If the click is inside a .player-panel element, leave it open.
      if (target.closest('.player-panel')) return;
      // Also ignore clicks on the toolbar buttons that toggle the panels.
      if (target.closest('[data-panel-toggle]')) return;
      setPanelOpen(false);
      setSourcePanelOpen(false);
      setSubtitlePanelOpen(false);
      setDownloadPanelOpen(false);
    },
    [panelOpen, sourcePanelOpen, subtitlePanelOpen, downloadPanelOpen, revealControls]
  );

  const miniFrame = useMiniFrame(mini);

  /**
   * Geometry for the floating window.
   *
   * Applied as inline style on the same element the full-screen player uses.
   * Swapping a class alone cannot express a position the user dragged to, and
   * rendering a second player would mean a second `<video>` — which is the one
   * thing this component must never do.
   */
  const miniStyle: React.CSSProperties | undefined = mini
    ? {
        left: miniFrame.frame.x,
        top: miniFrame.frame.y,
        width: miniFrame.frame.width,
        height: miniFrame.height,
      }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={
        `player${controlsVisible || keepControls ? '' : ' player--idle'}` +
        (mini ? ' player--mini' : '')
      }
      // `display: none` rather than unmounting: see the `hidden` prop. The
      // element keeps its buffer, its position and its decoder.
      style={hidden ? { display: 'none' } : miniStyle}
      aria-hidden={hidden || undefined}
      onMouseMove={revealControls}
      onMouseEnter={handlePlayerEnter}
      onMouseLeave={handlePlayerLeave}
      onPointerDown={handlePlayerPointerDown}
    >
      {/*
        The mini player's own chrome.

        A separate, much smaller control set rather than the full one scaled
        down: at 420px the real controls are unusable — a seek bar three hundred
        pixels wide with eleven buttons on it — and the things wanted from a
        window in the corner are only ever pause, expand, and close.
      */}
      {mini && (
        <>
          <div
            className="player-mini__grip"
            onPointerDown={miniFrame.startDrag}
            title="Drag to move"
            role="presentation"
          >
            <GripHorizontal size={13} />
            <span className="player-mini__title">{episodeTitle || title}</span>
          </div>

          <div className="player-mini__bar">
            <button onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            </button>
            <button
              onClick={() => setIsMuted((value) => !value)}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <div className="player-mini__spacer" />
            {onExpand && (
              <button onClick={onExpand} title="Back to the full player" aria-label="Expand player">
                <Maximize2 size={15} />
              </button>
            )}
            <button onClick={onBack} title="Stop and close" aria-label="Close player">
              <X size={15} />
            </button>
          </div>

          {/* Top-left rather than bottom-right: a window parked in the corner
              of the screen has its bottom-right corner against the edge. */}
          <div
            className="player-mini__resize"
            onPointerDown={miniFrame.startResize}
            title="Drag to resize"
            role="presentation"
          />
        </>
      )}
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
              {/* Failover is silent otherwise, and a viewer watching a dead
                  frame has no way to tell trying-the-next from given-up. */}
              {sourceSession && sourceSession.attempts.length > 0 && (
                <span className="muted">
                  Tried {sourceSession.attempts.length} of {sourceSession.sources.length} source
                  {sourceSession.sources.length === 1 ? '' : 's'}
                  {sourceSession.attempts.length < sourceSession.sources.length
                    ? ' — trying the next…'
                    : ''}
                </span>
              )}
              {/* Codecs and stream URL, because a playback failure is the least
                  reproducible thing in the app: the stream is transient and the
                  viewer has no way to describe it afterwards. */}
              <div className="player__error-actions">
                <button className="btn" onClick={onBack}>Choose another source</button>
                <CopyErrorButton
                  compact
                  context={{
                    title: episodeTitle ? `${title} — ${episodeTitle}` : title,
                    url: streamUrl,
                    source: audioProbe?.videoCodec
                      ? `video=${audioProbe.videoCodec}` +
                        (audioProbe.audio[0]?.codec ? ` audio=${audioProbe.audio[0].codec}` : '')
                      : undefined,
                    message: error ?? undefined,
                  }}
                />
              </div>
              {/*
                Offered only when the source is actually there. A dead link
                plays no better in VLC, and suggesting it would send the viewer
                to fetch a player that cannot help.
              */}
              {!probeFailure?.dead && <ExternalPlayerFallback streamUrl={streamUrl} compact />}
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
        {/*
          Minimise, next to Back and deliberately not folded into it.

          They are opposite intentions — "I am done with this" and "keep this
          running while I do something else" — and a viewer who wants the second
          and gets the first has lost their place and their buffer.
        */}
        {onMinimize && (
          <button
            className="icon-button"
            onClick={onMinimize}
            aria-label="Minimise the player"
            title="Keep playing in a small window while you browse"
          >
            <Minimize2 size={19} />
          </button>
        )}
        <div className="player__titles">
          <h2>{title}</h2>
          {(originalTitle || (activeSource?.title && activeSource.title !== title)) && (
            <span
              className="player__original-title"
              style={{
                fontSize: '0.74rem',
                color: 'rgba(255, 255, 255, 0.55)',
                fontStyle: 'italic',
                display: 'block',
                marginTop: '0.1rem',
                maxWidth: '520px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`Original release: ${originalTitle || activeSource?.title}`}
            >
              Refined from: "{originalTitle || activeSource?.title}"
            </span>
          )}
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
          {(effectiveProvider || resolvedProvenance?.repositoryName || activeSource?.parsed?.resolution) && (
            <div
              className="player__provenance-badge"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.7rem',
                color: 'rgba(255, 255, 255, 0.75)',
                marginTop: '0.2rem',
                flexWrap: 'wrap',
              }}
            >
              {effectiveProvider && (
                <span
                  style={{
                    padding: '0.08rem 0.35rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(59, 130, 246, 0.18)',
                    color: '#93c5fd',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    fontWeight: 600,
                  }}
                >
                  Provider: {effectiveProvider}
                </span>
              )}
              {resolvedProvenance?.repositoryName && (
                <span
                  style={{
                    padding: '0.08rem 0.35rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    color: 'rgba(255, 255, 255, 0.85)',
                  }}
                >
                  Repo: {resolvedProvenance.repositoryName}
                </span>
              )}
              {activeSource?.indexerName && activeSource.indexerName !== effectiveProvider && (
                <span
                  style={{
                    padding: '0.08rem 0.35rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    color: '#d8b4fe',
                  }}
                >
                  Indexer: {activeSource.indexerName}
                </span>
              )}
              {activeSource?.parsed?.resolution && (
                <span
                  style={{
                    padding: '0.08rem 0.3rem',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontWeight: 700,
                  }}
                >
                  {activeSource.parsed.resolution}p
                </span>
              )}
              {activeSource?.parsed?.videoCodec && (
                <span
                  style={{
                    padding: '0.08rem 0.3rem',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    textTransform: 'uppercase',
                  }}
                >
                  {activeSource.parsed.videoCodec}
                </span>
              )}
            </div>
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
          cancelled={sourceSession.searchCancelled}
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
          onCancelSearch={sourceSession.onCancelSearch}
          onDownload={sourceSession.onDownloadSource}
        />
      )}

      <SubtitlePanel
        open={subtitlePanelOpen}
        imdbId={subtitleContext?.imdbId}
        title={title}
        episodeTitle={episodeTitle}
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

      <PlayerDownloadPanel
        open={downloadPanelOpen}
        tasks={downloadQueue}
        onClose={() => setDownloadPanelOpen(false)}
        onPause={(id) => window.cloudstream?.pauseDownload(id)}
        onResume={(id) => window.cloudstream?.resumeDownload(id)}
        onRemove={(id) => window.cloudstream?.removeDownload(id)}
        onReveal={(filePath) => window.cloudstream?.revealInFolder(filePath)}
        onOpenDownloads={
          onOpenDownloads
            ? () => {
                setDownloadPanelOpen(false);
                onOpenDownloads();
              }
            : undefined
        }
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
              a hover menu is the wrong shape for a search result list.
              Optional control: enabled by default, can be hidden via Player Settings. */}
          {showSubtitlesControl && (
            <button
              className="icon-button"
              data-panel-toggle
              onClick={() => setSubtitlePanelOpen((v) => !v)}
              aria-label="Search subtitles"
              title="Search subtitles online"
            >
              <Subtitles size={18} />
            </button>
          )}

          {/* Button 1: Download Current Media Action Button */}
          <button
            className={`icon-button ${currentDownload ? 'active' : ''}`}
            onClick={handleDownloadCurrentMedia}
            aria-label="Download current media"
            title={
              currentDownload
                ? `Downloading current media (${currentDownload.state})`
                : 'Download current playing media'
            }
            disabled={Boolean(
              currentDownload && currentDownload.state === DownloadState.Completed
            )}
          >
            <HardDriveDownload size={18} />
          </button>

          {/* Active Download Status Badge for Currently Playing Media */}
          {currentDownload && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                padding: '0.2rem 0.6rem',
                borderRadius: '16px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#60a5fa',
              }}
            >
              <RotateCw
                size={12}
                className={
                  currentDownload.state === DownloadState.Downloading ||
                  currentDownload.state === DownloadState.RefreshingSource ||
                  currentDownload.state === DownloadState.Retrying
                    ? 'spin'
                    : ''
                }
              />
              <span>
                {currentDownload.state === DownloadState.Downloading
                  ? `${currentDownload.totalBytes > 0 ? `${Math.min(100, Math.floor((currentDownload.bytesDownloaded / currentDownload.totalBytes) * 100))}%` : 'Downloading'}`
                  : currentDownload.state === DownloadState.RefreshingSource
                  ? 'Refreshing...'
                  : currentDownload.state === DownloadState.Retrying
                  ? 'Retrying...'
                  : currentDownload.state}
              </span>
              {currentDownload.state === DownloadState.Downloading && (
                <button
                  style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', display: 'flex', padding: 0 }}
                  onClick={() => window.cloudstream?.pauseDownload(currentDownload.id)}
                  title="Pause Download"
                >
                  <Pause size={12} />
                </button>
              )}
              {(currentDownload.state === DownloadState.Paused || currentDownload.state === DownloadState.Failed) && (
                <button
                  style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', display: 'flex', padding: 0 }}
                  onClick={() => window.cloudstream?.resumeDownload(currentDownload.id)}
                  title="Resume / Retry Download"
                >
                  <Play size={12} />
                </button>
              )}
            </div>
          )}

          {/* Button 2: Downloads Manager Popover Panel Trigger */}
          <button
            className={`icon-button ${downloadPanelOpen ? 'active' : ''}`}
            data-panel-toggle
            onClick={() => setDownloadPanelOpen((v) => !v)}
            aria-label="Downloads Manager Panel"
            title={
              activeDownloadsCount > 0
                ? `Downloads Manager (${activeDownloadsCount} active)`
                : 'Downloads Manager Panel'
            }
            style={{ position: 'relative' }}
          >
            <FolderDown size={18} />
            {activeDownloadsCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  borderRadius: '10px',
                  padding: '1px 5px',
                  lineHeight: 1,
                }}
              >
                {activeDownloadsCount}
              </span>
            )}
          </button>

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

          {showSpeedControl && (
            <HoverMenu
              label="Speed"
              value={speed}
              onChange={setSpeed}
              options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
              triggerText={`${speed}×`}
            />
          )}

          {showAspectControl && (
            <HoverMenu
              label="Aspect ratio"
              value={aspect}
              onChange={setAspect}
              options={Object.values(AspectRatioMode).map((mode) => ({ value: mode, label: mode }))}
            />
          )}

          <button className="icon-button" onClick={toggleFullscreen} aria-label="Fullscreen">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </footer>
    </div>
  );
};
