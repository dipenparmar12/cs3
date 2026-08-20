import type {
  AudioStreamMetadata,
  DrmConfiguration,
  MediaMetadata,
  MediaTransport,
  SubtitleStreamMetadata,
  VideoStreamMetadata,
} from '../../src/types/media';
import { isPlayableAudioCodec } from './decisionEngine.ts';
import { runTool } from './runTool.ts';
import { getLogger } from '../logging/logger.ts';

/**
 * Reads what is actually inside a stream, before anything tries to play it.
 *
 * This is the gate INV-RACE-1 describes. Everything downstream — the strategy,
 * the ffmpeg arguments, the track list, the error message — is derived from this
 * one measurement, and nothing derives anything from the URL string. The
 * previous implementation guessed from filenames (`x265`, `10bit`, `2160p`) and
 * was wrong in both directions: releases mislabelled by whoever named them, and
 * bare `?id=…` Drive links carrying 10-bit HEVC with nothing in the URL to match.
 *
 * Cost: one ffprobe against the loopback proxy, bounded by `-probesize` so a 25
 * GB remote file is inspected from its first couple of megabytes rather than
 * downloaded. Measured 250 ms–3 s depending on how far the CDN is.
 */

/** A slow answer is worse than no answer, but a hasty one restarts the ladder. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * How much of the file ffprobe may read before deciding.
 *
 * 8 MB rather than the 5 the earlier version used, for one measured reason: a
 * Matroska file written with its cues at the end and four audio tracks can put
 * the fourth track's first packet well past 5 MB, and a track ffprobe never saw
 * is a track the user cannot select. It is a read bound, not a download — the
 * HTTP demuxer stops pulling once it has enough.
 */
const PROBE_SIZE_BYTES = 8_000_000;

/**
 * Providers that disguise their segments as images (PRD-38 E-03).
 *
 * `Hdmovie2` serves `.png` URLs containing MPEG-TS, to get past CDN filters that
 * block video extensions. FFmpeg's HLS demuxer refuses unknown extensions by
 * default — `URL ... .png is not in allowed_segment_extensions` — and there is
 * no way to enumerate what a provider might pick next, so the allow-list is
 * opened rather than extended. The protocol whitelist is the security boundary
 * that matters here and it stays closed: file, http, https, tcp, tls, crypto.
 *
 * **`-allowed_extensions ALL` stopped being enough, and it failed silently.**
 * FFmpeg 7.1 added `-extension_picky`, defaulting to *true*, and it is checked
 * before the allow-list — so on the bundled build (n8.0) the documented fix was
 * inert and every extensionless or image-named segment failed exactly as it did
 * before the fix existed. Measured against a local HLS fixture with `.png`
 * segments: `-allowed_extensions ALL` fails, `-allowed_segment_extensions ALL`
 * fails, `-extension_picky 0` succeeds. Found by the vendor matrix harness on a
 * real provider playlist, not by reading release notes.
 *
 * The flag cannot simply be added, because passing an option a binary does not
 * know is fatal — `Option extension_picky not found`, and the probe dies on
 * every stream rather than the ones it was meant to rescue. FFmpeg 7.0 is still
 * in the download mirrors and on plenty of machines' PATH. So it is *detected*
 * once per binary and passed only where it exists.
 */
const HLS_BASE_OPTIONS = [
  '-allowed_extensions', 'ALL',
  '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,data',
];

/**
 * Whether the resolved ffmpeg/ffprobe understands `-extension_picky`.
 *
 * `null` until something has asked. Unknown is treated as absent: omitting the
 * flag loses image-named segments, while passing one that does not exist loses
 * *every* stream, and those are not the same size of mistake.
 */
let extensionPickySupported: boolean | null = null;

/**
 * Records what the probe binary supports. Called once at startup by `main.ts`.
 *
 * Deliberately a module-level fact rather than a parameter threaded through
 * `inputOptionsFor`: the answer is a property of the binary on this machine,
 * every caller would pass the same value, and three call sites each doing their
 * own detection is three chances to forget.
 */
export function setFfmpegExtensionPicky(supported: boolean): void {
  extensionPickySupported = supported;
}

export function hlsDemuxerOptions(): string[] {
  return extensionPickySupported
    ? [...HLS_BASE_OPTIONS, '-extension_picky', '0']
    : HLS_BASE_OPTIONS;
}

/**
 * Detects the option by asking the binary to describe its own HLS demuxer.
 *
 * `-h demuxer=hls` lists every option the demuxer accepts, which is the same
 * source of truth the parser uses. Cheap, exact, and it costs one process
 * launch at startup rather than a failed probe per stream.
 */
export async function detectExtensionPicky(
  ffprobePath: string,
  run: (path: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>
): Promise<boolean> {
  try {
    const result = await run(ffprobePath, ['-hide_banner', '-h', 'demuxer=hls'], 8000);
    const supported = /-extension_picky\b/.test(`${result.stdout}${result.stderr}`);
    setFfmpegExtensionPicky(supported);
    return supported;
  } catch {
    setFfmpegExtensionPicky(false);
    return false;
  }
}

const BITMAP_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvbsub', 'xsub',
]);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/**
 * `-user_agent` belongs to the HTTP demuxer.
 *
 * FFmpeg fails outright with "Option user_agent not found" when it is passed for
 * a local path, and providers 403 often enough that omitting it on network input
 * turns a working stream into a phantom "no audio". So it is conditional rather
 * than always or never.
 */
export function inputOptionsFor(url: string, transport: MediaTransport): string[] {
  const options: string[] = [];
  if (transport === 'hls' || transport === 'dash') options.push(...hlsDemuxerOptions());
  if (!/^https?:\/\//i.test(url)) return options;
  return [
    ...options,
    '-user_agent', BROWSER_USER_AGENT,
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
  ];
}

/**
 * What kind of thing this URL is, decided by what the server said where possible.
 *
 * The extension is checked first because it is free and right most of the time,
 * but it is not sufficient: providers serve `.m3u8` content from URLs ending in
 * `.php`, `.txt` and nothing at all. `classifyBody` is the authority when a body
 * is available — an HLS playlist always starts `#EXTM3U` and a DASH manifest is
 * always an XML document with an `<MPD` element, and neither can be mistaken for
 * the binary head of an MP4 or Matroska file.
 */
export function transportFromUrl(url: string, isM3u8?: boolean): MediaTransport {
  if (isM3u8) return 'hls';
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (
    path.endsWith('.m3u8') ||
    path.endsWith('.m3u') ||
    /\/(getm3u8|m3u8|hls)\b/i.test(path) ||
    /[?&]format=m3u8/i.test(url)
  ) return 'hls';
  if (path.endsWith('.mpd') || /\/(dash|mpd)\b/i.test(path)) return 'dash';
  return 'progressive';
}

export function classifyBody(head: string): MediaTransport | null {
  const text = head.trimStart();
  if (text.startsWith('#EXTM3U')) return 'hls';
  if (/^<\?xml/i.test(text) || /<MPD[\s>]/i.test(text)) return 'dash';
  return null;
}

/**
 * DRM, read out of the manifest rather than assumed absent.
 *
 * The distinction that matters is not "encrypted or not" but **who can decrypt
 * it**. HLS AES-128 and SAMPLE-AES are decrypted by hls.js from a key it fetches
 * over HTTP, so those streams are ordinary as far as this engine is concerned —
 * and calling them DRM would route them to an EME path they do not need and
 * would fail on. ClearKey, Widevine and PlayReady need a CDM, which means FFmpeg
 * must not touch them: it holds no keys, so it would spend twenty seconds
 * probing noise and report a codec error about a file it never decrypted.
 */
export function detectDrm(manifest: string, transport: MediaTransport): DrmConfiguration {
  if (transport === 'hls') {
    // SAMPLE-AES-CTR is the FairPlay/Widevine-in-HLS spelling; plain AES-128 and
    // SAMPLE-AES are hls.js's own job and are deliberately not reported here.
    if (/METHOD=SAMPLE-AES-CTR/i.test(manifest)) return { type: 'widevine' };
    if (/#EXT-X-SESSION-KEY[^\n]*KEYFORMAT="urn:uuid:edef8ba9/i.test(manifest)) {
      return { type: 'widevine' };
    }
    if (/METHOD=(SAMPLE-)?AES/i.test(manifest)) {
      return { type: /METHOD=SAMPLE-AES\b/i.test(manifest) ? 'sample-aes' : 'aes-128' };
    }
    return { type: 'none' };
  }

  if (transport === 'dash') {
    if (/edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i.test(manifest)) return { type: 'widevine' };
    if (/9a04f079-9840-4286-ab92-e65be0885f95/i.test(manifest)) return { type: 'playready' };
    if (/e2719d58-a985-b3c9-781a-b030af78d30e/i.test(manifest)) return { type: 'clearkey' };
    if (/<ContentProtection/i.test(manifest)) return { type: 'clearkey' };
    return { type: 'none' };
  }

  return { type: 'none' };
}

/** ClearKey and Widevine need a CDM; AES-128 in HLS does not. */
export function drmRequiresEme(drm: DrmConfiguration): boolean {
  return drm.type === 'clearkey' || drm.type === 'widevine' || drm.type === 'playready';
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string | number;
  level?: number;
  pix_fmt?: string;
  width?: number;
  height?: number;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bit_rate?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  field_order?: string;
  color_space?: string;
  color_transfer?: string;
  disposition?: { default?: number; forced?: number };
  tags?: { language?: string; title?: string };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

function bitDepthFromPixelFormat(pixelFormat: string | undefined): number {
  if (!pixelFormat) return 8;
  const match = /(\d{2})(le|be)\b/i.exec(pixelFormat);
  if (match) return Number(match[1]);
  if (/^p010/i.test(pixelFormat)) return 10;
  return 8;
}

/** `24000/1001` → 23.976. Zero when ffprobe reports `0/0`, which it does for images. */
function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function numberOrUndefined(value: string | number | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseProbeOutput(raw: string): MediaMetadata | null {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(raw) as FfprobeOutput;
  } catch {
    return null;
  }

  let video: VideoStreamMetadata | null = null;
  const audio: AudioStreamMetadata[] = [];
  const subtitles: SubtitleStreamMetadata[] = [];
  let audioOrdinal = 0;
  let subtitleOrdinal = 0;

  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type === 'video' && !video) {
      // Cover art in an MP4 is a video stream of one frame; treating it as *the*
      // video stream reports an audio file as an undecodable MJPEG.
      if (stream.codec_name === 'mjpeg' || stream.codec_name === 'png') continue;
      const pixelFormat = stream.pix_fmt;
      const transfer = stream.color_transfer;
      video = {
        index: stream.index ?? 0,
        codec: (stream.codec_name ?? '').toLowerCase(),
        codecLongName: stream.codec_long_name,
        profile: stream.profile != null ? String(stream.profile) : undefined,
        level: stream.level,
        bitDepth: bitDepthFromPixelFormat(pixelFormat),
        pixelFormat,
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        frameRate: parseFrameRate(stream.avg_frame_rate) || parseFrameRate(stream.r_frame_rate),
        bitrate: numberOrUndefined(stream.bit_rate),
        colorSpace: stream.color_space,
        colorTransfer: transfer,
        isHdr: transfer === 'smpte2084' || transfer === 'arib-std-b67',
        isInterlaced: Boolean(stream.field_order && stream.field_order !== 'progressive'),
      };
      continue;
    }

    if (stream.codec_type === 'audio') {
      const codec = (stream.codec_name ?? '').toLowerCase();
      audio.push({
        index: audioOrdinal++,
        codec,
        codecLongName: stream.codec_long_name,
        profile: stream.profile != null ? String(stream.profile) : undefined,
        channels: stream.channels ?? 0,
        channelLayout: stream.channel_layout,
        sampleRate: numberOrUndefined(stream.sample_rate),
        bitrate: numberOrUndefined(stream.bit_rate),
        language: stream.tags?.language,
        title: stream.tags?.title,
        isDefault: stream.disposition?.default === 1,
        isForced: stream.disposition?.forced === 1,
        playable: isPlayableAudioCodec(codec),
      });
      continue;
    }

    if (stream.codec_type === 'subtitle') {
      const codec = (stream.codec_name ?? '').toLowerCase();
      subtitles.push({
        index: subtitleOrdinal++,
        codec,
        language: stream.tags?.language,
        title: stream.tags?.title,
        isDefault: stream.disposition?.default === 1,
        isForced: stream.disposition?.forced === 1,
        isBitmap: BITMAP_SUBTITLE_CODECS.has(codec),
      });
    }
  }

  return {
    formatName: parsed.format?.format_name ?? '',
    formatLongName: parsed.format?.format_long_name,
    durationSeconds: numberOrUndefined(parsed.format?.duration),
    bitrate: numberOrUndefined(parsed.format?.bit_rate),
    sizeBytes: numberOrUndefined(parsed.format?.size),
    video,
    audio,
    subtitles,
  };
}

export interface InspectionResult {
  metadata: MediaMetadata | null;
  transport: MediaTransport;
  drm: DrmConfiguration;
  /** ffprobe's own account of the failure, which is usually the whole answer. */
  error?: string;
  timedOut: boolean;
  latencyMs: number;
}

const log = getLogger().child('ffprobe');

export class MediaInspector {
  private resolveFfprobe: () => string | null;
  /**
   * Reads the first few KB of a URL, for manifest sniffing. Injected so this
   * file has no opinion about which HTTP stack the app uses.
   */
  private fetchHead: (url: string) => Promise<string | null>;

  constructor(
    resolveFfprobe: () => string | null,
    fetchHead: (url: string) => Promise<string | null>
  ) {
    this.resolveFfprobe = resolveFfprobe;
    this.fetchHead = fetchHead;
  }

  /**
   * Inspects a stream and reports what is in it.
   *
   * The manifest sniff runs first and is worth its round trip: an `.mpd` fed to
   * the wrong demuxer produces `Unable to parse XML declaration allowed only at
   * the start of the document`, which names neither DASH nor the provider and
   * sends whoever reads it looking for a corrupt file.
   */
  /**
   * Wrapped rather than instrumented in place: the body has five exits and
   * would grow a sixth.
   *
   * One record carries both the question and the answer, including the
   * duration. The probe measures 1.6-1.7s against real provider streams, which
   * makes it a routine suspect whenever "play" feels slow — and a latency
   * nobody recorded is a suspicion nobody can settle.
   */
  public async inspect(url: string, hintM3u8?: boolean): Promise<InspectionResult> {
    const finish = log.begin('inspect', { url });
    try {
      const result = await this.probe(url, hintM3u8);
      finish({
        status: result.metadata ? 'ok' : result.timedOut ? 'timeout' : 'failed',
        transport: result.transport,
        container: result.metadata?.formatName,
        videoCodec: result.metadata?.video?.codec,
        videoBitDepth: result.metadata?.video?.bitDepth,
        audioTracks: result.metadata?.audio.length,
        audioCodec: result.metadata?.audio[0]?.codec,
        audioChannels: result.metadata?.audio[0]?.channels,
        subtitleTracks: result.metadata?.subtitles.length,
        drm: result.drm.type === 'none' ? undefined : result.drm.type,
        error: result.error,
      });
      return result;
    } catch (error) {
      finish({ status: 'threw', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async probe(url: string, hintM3u8?: boolean): Promise<InspectionResult> {
    const startedAt = Date.now();
    let transport = transportFromUrl(url, hintM3u8);
    let drm: DrmConfiguration = { type: 'none' };

    // Only manifests are sniffed. Pulling the first bytes of a 25 GB MKV to look
    // at them would be a wasted request on every progressive source in the app.
    if (transport !== 'progressive' || /manifest|playlist|\.mpd|\.m3u8/i.test(url)) {
      const head = await this.fetchHead(url);
      if (head) {
        transport = classifyBody(head) ?? transport;
        drm = detectDrm(head, transport);
      }
    }

    if (drmRequiresEme(drm)) {
      // Probing it would be twenty seconds spent on encrypted noise.
      return { metadata: null, transport, drm, latencyMs: Date.now() - startedAt, timedOut: false };
    }

    const ffprobe = this.resolveFfprobe();
    if (!ffprobe) {
      return {
        metadata: null,
        transport,
        drm,
        error: 'ffprobe is not installed',
        timedOut: false,
        latencyMs: Date.now() - startedAt,
      };
    }

    const result = await runTool(
      ffprobe,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_entries', 'format=duration,format_name,format_long_name,bit_rate,size',
        '-probesize', String(PROBE_SIZE_BYTES),
        '-analyzeduration', String(PROBE_SIZE_BYTES),
        ...inputOptionsFor(url, transport),
        url,
      ],
      PROBE_TIMEOUT_MS
    );

    if (!result.ok) {
      return {
        metadata: null,
        transport,
        drm,
        error: result.timedOut
          ? `ffprobe timed out after ${PROBE_TIMEOUT_MS}ms`
          : result.stderr.trim() || `ffprobe exited ${result.code ?? 'with no code'}`,
        timedOut: result.timedOut,
        latencyMs: Date.now() - startedAt,
      };
    }

    const metadata = parseProbeOutput(result.stdout);
    return {
      metadata,
      transport,
      drm,
      error: metadata ? undefined : 'ffprobe produced output that could not be read',
      timedOut: false,
      latencyMs: Date.now() - startedAt,
    };
  }
}
