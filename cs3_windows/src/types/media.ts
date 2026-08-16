/**
 * The Universal Media Compatibility contract (PRD-37, PRD-38).
 *
 * Imported by both `electron/` and `src/`, like the other files here. The
 * renderer needs these types because the probe gate lives in the player: the
 * `<video>` element must not be handed a URL until the main process has said
 * what is inside it, and "what is inside it" is this shape.
 *
 * The distinction these types exist to make is the one the old code never made:
 * **downloadable is not directly playable**. A 25 GB HEVC 10-bit MKV fetches at
 * 50 MB/s and will not decode a single frame, and every symptom of that —
 * silent audio, a 3-second stall, "could not decode this file" — was previously
 * diagnosed by guessing at the URL string.
 */

/** How a stream is delivered, which decides who demuxes it. */
export type MediaTransport =
  /** A single addressable file: MP4, MKV, TS, whatever the CDN serves. */
  | 'progressive'
  /** An `.m3u8` playlist. hls.js owns these; it demuxes and decrypts itself. */
  | 'hls'
  /** An `.mpd` manifest. Remuxed by ffmpeg — see `decisionEngine`. */
  | 'dash';

export interface VideoStreamMetadata {
  index: number;
  /** ffprobe's name: `hevc`, `h264`, `vp9`, `av1`, `mpeg2video`… */
  codec: string;
  codecLongName?: string;
  /** `Main 10`, `High`, `Main`. Distinct from bit depth, and both matter. */
  profile?: string;
  level?: number;
  /** 8, 10 or 12 — derived from `pixelFormat`, which is where ffprobe puts it. */
  bitDepth: number;
  pixelFormat?: string;
  width: number;
  height: number;
  frameRate: number;
  bitrate?: number;
  colorSpace?: string;
  colorTransfer?: string;
  /** PQ or HLG transfer. Tone-mapping is out of scope; this is for reporting. */
  isHdr: boolean;
  isInterlaced: boolean;
}

export interface AudioStreamMetadata {
  /**
   * Ordinal **within the audio streams**, because that is what `-map 0:a:N`
   * takes. Not `stream.index`, which counts video and subtitles too — mapping
   * with that number silently selects the wrong track on any file whose video
   * stream is not last.
   */
  index: number;
  codec: string;
  codecLongName?: string;
  profile?: string;
  channels: number;
  channelLayout?: string;
  sampleRate?: number;
  bitrate?: number;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  /** False when Chromium has no decoder — AC-3, E-AC-3, DTS, TrueHD. */
  playable: boolean;
}

export interface SubtitleStreamMetadata {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  isDefault: boolean;
  isForced: boolean;
  /**
   * PGS/DVB/VOBSUB. There is no text to extract from these — they are pictures
   * — so they are listed and left alone rather than converted into an empty
   * WebVTT file that looks like a broken subtitle track.
   */
  isBitmap: boolean;
}

export interface MediaMetadata {
  /** e.g. `matroska,webm`, `mov,mp4,m4a,3gp,3g2,mj2`, `hls`, `dash`. */
  formatName: string;
  formatLongName?: string;
  durationSeconds?: number;
  bitrate?: number;
  sizeBytes?: number;
  video: VideoStreamMetadata | null;
  audio: AudioStreamMetadata[];
  subtitles: SubtitleStreamMetadata[];
}

export type PlaybackStrategyType =
  /** Native playback, untouched. Zero CPU. */
  | 'DIRECT'
  /** Codecs are fine, the wrapper is not. Both streams copied. ~27x realtime. */
  | 'REMUX_CONTAINER'
  /** Video copied, audio re-encoded to stereo AAC. ~60x realtime. */
  | 'AUDIO_TRANSCODE'
  /** Video re-encoded, audio copied. The expensive one. */
  | 'VIDEO_TRANSCODE'
  /** Both re-encoded. */
  | 'FULL_TRANSCODE'
  /** hls.js takes it: it demuxes TS and decrypts AES-128 itself. */
  | 'HLS_NATIVE'
  /** A DASH manifest, remuxed by ffmpeg into fragmented MP4. */
  | 'DASH_REMUX'
  /**
   * Encrypted: handed to the renderer's EME pipeline untouched.
   *
   * FFmpeg holds no decryption keys, so probing or remuxing a Widevine or
   * ClearKey stream produces garbage rather than a diagnosis. This strategy is
   * how the engine says "not mine" instead of failing three times on the way.
   */
  | 'EME_NATIVE';

export interface TransformationPlan {
  videoAction: 'copy' | 'transcode' | 'downscale' | 'none';
  targetVideoCodec?: 'h264';
  targetPixelFormat?: 'yuv420p';
  /**
   * Set only when `videoAction` is `downscale`. The software-encoder guard:
   * libx264 encodes 4K at 0.5x realtime, which stalls after the first buffer.
   */
  targetHeight?: number;
  hardwareAccelerator?: 'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'cpu';

  audioAction: 'copy' | 'transcode' | 'none';
  targetAudioCodec?: 'aac';
  /** Ordinal among audio streams; `-1` when the file has no audio. */
  selectedAudioIndex: number;

  containerAction: 'passthrough' | 'mp4_fragmented';

  subtitleAction: 'extract_webvtt' | 'ignore';
}

export type DrmType = 'none' | 'aes-128' | 'sample-aes' | 'clearkey' | 'widevine' | 'playready';

export interface DrmConfiguration {
  type: DrmType;
  /** ClearKey: KID → key, both base64url as EME wants them. */
  clearKeys?: Record<string, string>;
  licenseUrl?: string;
  licenseHeaders?: Record<string, string>;
}

export interface SourceCapabilityModel {
  /** The loopback URL everything downstream was measured against. */
  resolvedUrl: string;
  transport: MediaTransport;

  supportsRangeRequests: boolean;

  inspectionStatus: 'inspected' | 'failed' | 'skipped';
  /** Present when `inspectionStatus === 'inspected'`. */
  metadata: MediaMetadata | null;
  /** Why inspection produced nothing, when it produced nothing. */
  failure: ProbeFailure | null;

  directPlayable: boolean;
  requiredStrategy: PlaybackStrategyType;
  transformationPlan: TransformationPlan;

  drm: DrmConfiguration;
  /** When true FFmpeg is bypassed entirely: it holds no decryption keys. */
  requiresEmeDecryption: boolean;

  /** Plain-language account of the decision, for the player and the clipboard. */
  explanation: string;
  probeLatencyMs: number;
}

/** Why a probe produced nothing. */
export interface ProbeFailure {
  status?: number;
  reason: string;
  /** True when the source is gone rather than merely undecodable. */
  dead: boolean;
}

/** What the renderer measured about its own decoders. Believed over any table. */
export interface RendererCapabilities {
  /** ffprobe codec name → whether `canPlayType` returned anything but "". */
  video: Record<string, boolean>;
}

/** Facts about this machine that change the plan rather than the diagnosis. */
export interface HostEncodeCapability {
  /** False when only libx264 is available, which is what triggers the guard. */
  hardware: boolean;
  accelerator: 'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'cpu';
  logicalCores: number;
}

export interface EmbeddedSubtitleTrack {
  index: number;
  label: string;
  language?: string;
  /** Loopback WebVTT URL. Extraction runs on first fetch, not on inspection. */
  url: string;
}

export interface PlaybackStreamRequest {
  /** The provider's URL, before proxying. */
  url: string;
  /** Headers the provider supplied — usually a `Referer` a browser cannot send. */
  headers?: Record<string, string>;
  isM3u8?: boolean;
  /** Skips the cached capability record. Used by the failover ladder. */
  refresh?: boolean;
  /**
   * Ignore the inspection and re-encode unconditionally.
   *
   * The last rung of the ladder: the inspection said this would play and it did
   * not, so its verdict has been disproved and re-encoding is the only thing
   * left that is guaranteed to produce something decodable.
   */
  force?: boolean;
  /** Attributed in telemetry; the provider is what a failure belongs to. */
  provider?: string;
}

export interface PlaybackStreamResponse {
  ok: boolean;
  error?: string;
  /** True when ffmpeg/ffprobe are missing, which the UI offers to fix. */
  needsComponents?: boolean;
  /** What the `<video>` element (or hls.js) should be given. */
  playbackUrl: string;
  /** Token for `closePlaybackStream` / `switchAudioTrack`; empty for DIRECT. */
  sessionId: string;
  capability: SourceCapabilityModel;
  subtitles: EmbeddedSubtitleTrack[];
}

export interface PlaybackDiagnosticEvent {
  timestamp: string;
  sessionId: string;
  sourceUrl: string;
  provider?: string;

  container: string;
  videoCodec: string;
  videoProfile?: string;
  videoBitDepth: number;
  resolution: string;
  audioCodec: string;
  audioChannels: number;

  directPlayable: boolean;
  selectedStrategy: PlaybackStrategyType;
  hardwareAccelerator: string;

  probeLatencyMs: number;
  startupLatencyMs?: number;

  errorStage?: 'probe' | 'proxy' | 'ffmpeg' | 'renderer';
  errorMessage?: string;
  ffmpegExitCode?: number;
}
