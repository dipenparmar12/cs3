/**
 * The native playback engine's contract, imported by both `electron/` and `src/`.
 *
 * These types exist because the `<video>` element is not the only player in the
 * app any more. A stream routed to mpv produces no `timeupdate`, no `buffered`
 * ranges and no `audioTracks` list, so the player UI has to render from a
 * snapshot pushed over IPC instead — the same inversion `playback:*` already
 * uses, and for the same reason: the thing that knows the state is not the thing
 * drawing the controls.
 */

/** One audio or subtitle track as mpv reports it. */
export interface MpvTrack {
  /**
   * mpv's own track id, which is **1-based and per type** — not the ffprobe
   * stream index the transformation plan uses. Passing an ffprobe ordinal here
   * selects the wrong dub on any file with more than one audio track, so the two
   * numbering schemes are deliberately never mixed.
   */
  id: number;
  /** `audio` or `sub`. Video tracks are filtered out before this is built. */
  type: string;
  title?: string;
  language?: string;
  codec?: string;
  channels?: number;
  isDefault: boolean;
  isForced: boolean;
  selected: boolean;
  /** True for a subtitle file we attached, false for one the container carried. */
  external: boolean;
}

/**
 * Everything the player UI needs to draw itself, pushed on every change.
 *
 * A snapshot rather than a diff: the renderer can be opened, closed and reopened
 * mid-playback (the mini player, a navigation away and back), and a UI rebuilt
 * from accumulated deltas would have to replay a history it never saw.
 */
export interface MpvSnapshot {
  sessionId: string;
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  url: string;
  title: string;

  positionSeconds: number;
  durationSeconds: number;
  /** Absolute position the demuxer cache reaches, not a delta from the playhead. */
  bufferedSeconds: number;

  paused: boolean;
  volume: number;
  muted: boolean;
  speed: number;
  fullscreen: boolean;

  width: number;
  height: number;
  pixelFormat?: string;
  /** `pq` or `hlg` for HDR content. mpv reports this as the `gamma` param. */
  colorTransfer?: string;
  videoCodec: string;
  audioCodec: string;
  /**
   * The decoder mpv actually selected — `d3d11va`, `nvdec`, `vulkan`, or `no`.
   *
   * Distinct from "hardware decoding is enabled", which is a setting. This is a
   * measurement, and it is the first thing worth knowing when someone reports
   * that a 4K file stutters.
   */
  hardwareDecoder: string;
  frameRate: number;
  droppedFrames: number;

  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;

  error: string | null;
  startupLatencyMs: number;
}

export interface MpvOpenRequest {
  /** The proxied loopback URL, so the provider's `Referer` is already applied. */
  url: string;
  title?: string;
  /**
   * Headers for a link the proxy never saw. Normally empty: `ContentService`
   * wraps every provider link before it reaches here.
   */
  headers?: Record<string, string>;
  /** Resume point, applied at load so the first frame is already in the right place. */
  startSeconds?: number;
  volume?: number;
  fullscreen?: boolean;
  /** mpv track id, not an ffprobe ordinal. See {@link MpvTrack.id}. */
  audioTrackId?: number;
  subtitleUrl?: string;
  /**
   * A native window handle to render into, passed straight to `--wid`.
   *
   * Unused today — the engine renders into its own window. It is here because
   * embedding is the one change that would otherwise reach into every layer of
   * this contract at once.
   */
  windowHandle?: string;
}

export interface MpvCommandResult {
  ok: boolean;
  error?: string;
  data?: unknown;
  sessionId?: string;
}

export interface MpvEngineStatus {
  /** False when mpv is not installed. The UI offers to fetch it. */
  available: boolean;
  running: boolean;
  path: string | null;
  version: string | null;
  /** `d3d11va`, `nvdec`, `vulkan`, `dxva2`… — reported, not chosen from. */
  hardwareDecoders: string[];
  /** Which video output the running process settled on. Null when not running. */
  videoOutput: string | null;
  sessionId: string;
}
