import type {
  AudioStreamMetadata,
  DrmConfiguration,
  MediaMetadata,
  MediaTransport,
  SubtitleStreamMetadata,
  VideoStreamMetadata,
} from '../../src/types/media.ts';
import type { InspectionStrategyType } from './playbackTelemetry.ts';
import { isDolbyVisionTag, isPlayableAudioCodec, requiresEmeDecryption } from './decisionEngine.ts';
import { runTool } from './runTool.ts';
import { scopedLogger } from '../logging/logger.ts';
import { describeError } from '../../src/utils/errors.ts';

const log = scopedLogger('ffprobe');

/**
 * What a manifest's codec field is set to when it declared one this build
 * cannot read.
 *
 * It is a name on purpose rather than `undefined`. `canPlayVideo` treats an
 * absent codec as "no information, do not block" — right for a manifest that
 * never said anything — whereas this is the opposite situation: the stream
 * announced what it is and we did not recognise it, which is exactly when a
 * conservative answer is wanted. Being a name no allowlist contains, it fails
 * closed and routes to a decoder that can probably handle it.
 */
const UNKNOWN_CODEC = 'unknown';

/**
 * PRD-37 / PRD-40 / PRD-40.1: Container-Aware Pre-Playback Media Inspection Layer.
 *
 * This is the gate INV-RACE-1 describes.
 * PRD-40.1 §4.2: Replaces the naive 2MB single-probe with container-typed inspection:
 *  - Manifest parsing for HLS (.m3u8) & DASH (.mpd) without calling ffprobe on manifests
 *  - Head probe (0-2MB) + tail probe on non-faststart MP4/MOV (moov at end)
 *  - Raised probesize/analyzeduration for MPEG-TS multi-track streams
 *  - Progressive widening for Matroska / unknown streams
 *  - Distinction between `probeIncomplete` and `probeError`.
 */

/** Configurable probe settings with optimized fast-switch defaults. */
export interface ProbeConfig {
  /** How much of the file ffprobe may read before deciding (defaults to 2MB). */
  probeSizeBytes: number;
  /** Max timeout for ffprobe execution. */
  probeTimeoutMs: number;
}

const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  probeSizeBytes: 2_000_000, // 2MB for fast source switching
  probeTimeoutMs: 20_000,
};

let currentProbeConfig: ProbeConfig = { ...DEFAULT_PROBE_CONFIG };

export function setProbeConfig(config: Partial<ProbeConfig>): void {
  currentProbeConfig = { ...currentProbeConfig, ...config };
}

export function getProbeConfig(): ProbeConfig {
  return { ...currentProbeConfig };
}

const PROBE_SIZE_DEFAULT = 2_000_000;
const PROBE_SIZE_RAISED = 15_000_000;
const PROBE_SIZE_PROGRESSIVE = 10_000_000;

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

let extensionPickySupported: boolean | null = null;
let toneMapSupported = false;

export function setFfmpegExtensionPicky(supported: boolean): void {
  extensionPickySupported = supported;
}

export function setFfmpegToneMapSupport(supported: boolean): void {
  toneMapSupported = supported;
}

export function hlsDemuxerOptions(): string[] {
  return extensionPickySupported === true
    ? [...HLS_BASE_OPTIONS, '-extension_picky', '0']
    : HLS_BASE_OPTIONS;
}

export async function detectExtensionPicky(
  ffprobePath: string,
  run: (path: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>
): Promise<boolean> {
  try {
    const result = await run(ffprobePath, ['-hide_banner', '-h', 'demuxer=hls'], 8000);
    const supported = /-extension_picky\b/.test(`${result.stdout}${result.stderr}`);
    setFfmpegExtensionPicky(supported);
    return supported;
  } catch (error) {
    log.warn('detect_extension_picky_failed', { error: describeError(error) });
    setFfmpegExtensionPicky(false);
    return false;
  }
}

export async function detectToneMapSupport(
  ffmpegPath: string,
  run: (path: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>
): Promise<boolean> {
  try {
    const result = await run(ffmpegPath, ['-hide_banner', '-filters'], 8000);
    const supported = /\bzscale\b/.test(`${result.stdout}${result.stderr}`);
    setFfmpegToneMapSupport(supported);
    return supported;
  } catch {
    setFfmpegToneMapSupport(false);
    return false;
  }
}

export function toneMapFilters(): string[] {
  if (!toneMapSupported) return [];
  return [
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ];
}

const BITMAP_SUBTITLE_CODECS = new Set([
  'hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvbsub', 'xsub',
]);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

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

export type ContainerTypeCategory = 'manifest-hls' | 'manifest-dash' | 'mp4' | 'ts' | 'mkv' | 'unknown';

export function detectUrlType(url: string, hintM3u8?: boolean): ContainerTypeCategory {
  if (hintM3u8) return 'manifest-hls';
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (
    path.endsWith('.m3u8') ||
    path.endsWith('.m3u') ||
    /\/(getm3u8|m3u8|hls)\b/i.test(path) ||
    /[?&]format=m3u8/i.test(url)
  ) return 'manifest-hls';
  if (path.endsWith('.mpd') || /\/(dash|mpd)\b/i.test(path)) return 'manifest-dash';
  if (path.endsWith('.mp4') || path.endsWith('.m4v') || path.endsWith('.mov')) return 'mp4';
  if (path.endsWith('.ts') || path.endsWith('.m2ts') || path.endsWith('.mts')) return 'ts';
  if (path.endsWith('.mkv') || path.endsWith('.webm')) return 'mkv';
  return 'unknown';
}

export function transportFromUrl(url: string, isM3u8?: boolean): MediaTransport {
  const category = detectUrlType(url, isM3u8);
  if (category === 'manifest-hls') return 'hls';
  if (category === 'manifest-dash') return 'dash';
  return 'progressive';
}

export function classifyBody(head: string): MediaTransport | null {
  const text = head.trimStart();
  if (text.startsWith('#EXTM3U')) return 'hls';
  if (/^<\?xml/i.test(text) || /<MPD[\s>]/i.test(text)) return 'dash';
  return null;
}

export function detectDrm(manifest: string, transport: MediaTransport): DrmConfiguration {
  if (transport === 'hls') {
    // FairPlay in HLS (KEYFORMAT com.apple.streamingkeydelivery/fps, KEYFORMATVERSIONS, or skd:// URI)
    if (
      /KEYFORMAT="com\.apple\.(streamingkeydelivery|fps(\.1_0)?)"/i.test(manifest) ||
      (/KEYFORMATVERSIONS=/i.test(manifest) && /METHOD=(SAMPLE-AES|SAMPLE-AES-CTR)/i.test(manifest)) ||
      /URI="skd:\/\//i.test(manifest)
    ) {
      return { type: 'fairplay' };
    }
    // SAMPLE-AES-CTR is the FairPlay/Widevine-in-HLS spelling; plain AES-128 and
    // SAMPLE-AES are hls.js's own job and are deliberately not reported here.
    if (
      /METHOD=SAMPLE-AES-CTR/i.test(manifest) ||
      /#EXT-X-(SESSION-)?KEY[^\n]*KEYFORMAT="urn:uuid:edef8ba9/i.test(manifest) ||
      /KEYFORMAT="com\.widevine(\.alpha)?"/i.test(manifest)
    ) {
      return { type: 'widevine' };
    }
    // PlayReady in HLS
    if (
      /#EXT-X-(SESSION-)?KEY[^\n]*KEYFORMAT="urn:uuid:9a04f079/i.test(manifest) ||
      /KEYFORMAT="com\.microsoft\.playready"/i.test(manifest)
    ) {
      return { type: 'playready' };
    }
    // ClearKey in HLS
    if (
      /KEYFORMAT="org\.w3\.clearkey"/i.test(manifest) ||
      /#EXT-X-(SESSION-)?KEY[^\n]*KEYFORMAT="urn:uuid:e2719d58/i.test(manifest)
    ) {
      return { type: 'clearkey' };
    }
    if (/METHOD=(SAMPLE-)?AES/i.test(manifest)) {
      return { type: /METHOD=SAMPLE-AES\b/i.test(manifest) ? 'sample-aes' : 'aes-128' };
    }
    return { type: 'none' };
  }

  if (transport === 'dash') {
    if (/edef8ba9-79d6-4ace-a3c8-27dcd51d21ed/i.test(manifest)) return { type: 'widevine' };
    if (/9a04f079-9840-4286-ab92-e65be0885f95/i.test(manifest)) return { type: 'playready' };
    if (/94ce86fb-07ff-4f43-adb8-93d2fa968ca2/i.test(manifest)) return { type: 'fairplay' };
    if (
      /e2719d58-a985-b3c9-781a-b030af78d30e/i.test(manifest) ||
      /1077efec-c0b2-4d02-ace3-3c1e52e2fb4b/i.test(manifest) ||
      /org\.w3\.clearkey/i.test(manifest)
    ) {
      return { type: 'clearkey' };
    }
    if (/5e629af5-38da-40e1-80e9-74d72f9f2522/i.test(manifest)) return { type: 'marlin' };
    if (/<ContentProtection/i.test(manifest)) return { type: 'clearkey' };
    return { type: 'none' };
  }

  return { type: 'none' };
}

export function drmRequiresEme(drm: DrmConfiguration): boolean {
  return requiresEmeDecryption(drm);
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
  codec_tag_string?: string;
  /**
   * Where ffprobe puts the Dolby Vision configuration record. There is no
   * codec name for DV — the stream reports `hevc` — so this is the only place
   * the RPU announces itself. Requires `-show_streams`, which this call
   * already passes.
   */
  side_data_list?: Array<{
    side_data_type?: string;
    dv_profile?: number;
    dv_level?: number;
    rpu_present_flag?: number;
    bl_present_flag?: number;
    dv_bl_signal_compatibility_id?: number;
  }>;
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

/**
 * An RFC 6381 codec string, read as far as it can be trusted.
 *
 * Two things about the return shape are load-bearing, and both exist because
 * the first version of this function could only say "h264" or nothing at all.
 *
 * `videoUnknown`/`audioUnknown` are set when a codec *was* declared and this
 * table does not recognise it. The callers used to treat that identically to
 * "no CODECS attribute", which meant falling back to the `h264`/`aac`
 * defaults — so a manifest that plainly announced Dolby Vision or DTS was
 * recorded as the two codecs the browser is guaranteed to accept, reported as
 * directly playable, and failed in the element. Saying "something, and not
 * one of ours" is what lets the decision engine be conservative instead.
 *
 * `mp4a` is not a synonym for AAC. It is an MPEG-4 audio *namespace* whose
 * object type indication picks the actual codec: `mp4a.40.x` is AAC, but
 * `mp4a.a5` is AC-3, `mp4a.a6` is E-AC-3 and `mp4a.69`/`mp4a.6b` are MP3.
 * Collapsing the whole prefix to AAC reported AC-3 and E-AC-3 — the modal
 * provider audio — as playable, which is the silent-dialogue failure.
 */
function normalizeCodecFromRfc6381(codecString: string): {
  videoCodec?: string;
  audioCodec?: string;
  bitDepth?: number;
  dolbyVision?: boolean;
  videoUnknown?: boolean;
  audioUnknown?: boolean;
} {
  const codecs = codecString.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let videoCodec: string | undefined;
  let audioCodec: string | undefined;
  let bitDepth = 8;
  let dolbyVision = false;
  let videoUnknown = false;
  let audioUnknown = false;

  /**
   * Which family a token belongs to, so an unrecognised one can be filed as
   * unknown *video* or unknown *audio* rather than ignored. Everything in
   * MP4RA's video space is a four-character code; guessing from the string is
   * not possible, so anything unmatched is reported against both and the
   * caller keeps whichever side it had no other answer for.
   */
  for (const c of codecs) {
    if (c.startsWith('avc1') || c.startsWith('avc3')) {
      videoCodec = 'h264';
    } else if (c.startsWith('dvh1') || c.startsWith('dvhe')) {
      // Dolby Vision over HEVC. The base layer is HEVC; the RPU is what the
      // element would drop, so the codec is recorded honestly and the DV flag
      // carries the reason it must not go there.
      videoCodec = 'hevc';
      dolbyVision = true;
      bitDepth = 10;
    } else if (c.startsWith('dav1') || c.startsWith('dva1') || c.startsWith('dvav')) {
      videoCodec = c.startsWith('dav1') ? 'av1' : 'h264';
      dolbyVision = true;
      bitDepth = 10;
    } else if (c.startsWith('hvc1') || c.startsWith('hev1')) {
      videoCodec = 'hevc';
      if (c.includes('.2.') || c.includes('.l120.')) bitDepth = 10;
    } else if (c.startsWith('vvc1') || c.startsWith('vvi1')) {
      videoCodec = 'vvc';
    } else if (c.startsWith('vp09') || c.startsWith('vp9')) {
      videoCodec = 'vp9';
      if (c.startsWith('vp09.02') || c.startsWith('vp09.03')) bitDepth = 10;
    } else if (c.startsWith('vp08') || c.startsWith('vp8')) {
      videoCodec = 'vp8';
    } else if (c.startsWith('av01')) {
      videoCodec = 'av1';
      if (c.includes('.10m.')) bitDepth = 10;
    } else if (c.startsWith('mp4a')) {
      // The object type indication, not the prefix, names the codec.
      const oti = c.split('.')[1] ?? '';
      if (oti === 'a5') audioCodec = 'ac3';
      else if (oti === 'a6') audioCodec = 'eac3';
      else if (oti === 'a9') audioCodec = 'dts';
      else if (oti === '69' || oti === '6b') audioCodec = 'mp3';
      else audioCodec = 'aac';
    } else if (c.startsWith('ec-3') || c.startsWith('eac3')) {
      audioCodec = 'eac3';
    } else if (c.startsWith('ac-3') || c.startsWith('ac3')) {
      audioCodec = 'ac3';
    } else if (c.startsWith('ac-4')) {
      audioCodec = 'ac4';
    } else if (c.startsWith('dtsc') || c.startsWith('dtse') || c.startsWith('dts-')) {
      audioCodec = 'dts';
    } else if (c.startsWith('dtsh') || c.startsWith('dtsl') || c.startsWith('dtsx')) {
      audioCodec = 'dtshd';
    } else if (c.startsWith('mhm1') || c.startsWith('mha1')) {
      audioCodec = 'mpegh';
    } else if (c.startsWith('opus')) {
      audioCodec = 'opus';
    } else if (c.startsWith('flac') || c.startsWith('fLaC')) {
      audioCodec = 'flac';
    } else if (c.startsWith('alac')) {
      audioCodec = 'alac';
    } else if (c.startsWith('vorbis')) {
      audioCodec = 'vorbis';
    } else if (c.startsWith('mp3')) {
      audioCodec = 'mp3';
    } else if (c.startsWith('stpp') || c.startsWith('wvtt')) {
      // Timed text. Not a video or audio answer, and not an unknown one either.
      continue;
    } else {
      videoUnknown = true;
      audioUnknown = true;
    }
  }

  return {
    videoCodec,
    audioCodec,
    bitDepth,
    dolbyVision: dolbyVision || undefined,
    videoUnknown: videoUnknown && !videoCodec ? true : undefined,
    audioUnknown: audioUnknown && !audioCodec ? true : undefined,
  };
}

/**
 * PRD-40.1 §4.2: Parses HLS manifests directly without ffprobe.
 */
export function parseHlsManifest(manifestText: string): MediaMetadata | null {
  const lines = manifestText.split(/\r?\n/);
  if (!manifestText.includes('#EXTM3U')) return null;

  let bestWidth = 0;
  let bestHeight = 0;
  /**
   * The defaults stand only for a manifest that declared no `CODECS` at all.
   *
   * Where one *was* declared and this build could not read it, the codec is
   * set to `UNKNOWN_CODEC` instead — see `normalizeCodecFromRfc6381`. Keeping
   * the optimistic default in that case is what reported a Dolby Vision or
   * DTS playlist as H.264/AAC and sent it to hls.js to fail.
   */
  let detectedVideoCodec = 'h264';
  let detectedAudioCodec = 'aac';
  let detectedBitDepth = 8;
  let dolbyVision = false;
  let frameRate = 0;
  let hasVideo = false;

  const audioTracks: AudioStreamMetadata[] = [];
  const subtitleTracks: SubtitleStreamMetadata[] = [];

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      hasVideo = true;
      const resMatch = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
      if (resMatch) {
        const w = Number(resMatch[1]);
        const h = Number(resMatch[2]);
        if (h >= bestHeight) {
          bestWidth = w;
          bestHeight = h;
        }
      }
      const fpsMatch = /FRAME-RATE=([\d.]+)/i.exec(line);
      if (fpsMatch) frameRate = Number(fpsMatch[1]) || frameRate;

      const codecsMatch = /CODECS="([^"]+)"/i.exec(line);
      if (codecsMatch) {
        const normalized = normalizeCodecFromRfc6381(codecsMatch[1]);
        if (normalized.videoCodec) detectedVideoCodec = normalized.videoCodec;
        else if (normalized.videoUnknown) detectedVideoCodec = UNKNOWN_CODEC;
        if (normalized.audioCodec) detectedAudioCodec = normalized.audioCodec;
        else if (normalized.audioUnknown) detectedAudioCodec = UNKNOWN_CODEC;
        if (normalized.dolbyVision) dolbyVision = true;
        if (normalized.bitDepth) detectedBitDepth = normalized.bitDepth;
      }
    }

    if (line.startsWith('#EXT-X-MEDIA:')) {
      const typeMatch = /TYPE=([A-Z]+)/i.exec(line);
      const type = typeMatch?.[1]?.toUpperCase();
      const langMatch = /LANGUAGE="([^"]+)"/i.exec(line);
      const nameMatch = /NAME="([^"]+)"/i.exec(line);
      const isDefault = /DEFAULT=YES/i.test(line);

      if (type === 'AUDIO') {
        audioTracks.push({
          index: audioTracks.length,
          codec: detectedAudioCodec,
          codecLongName: detectedAudioCodec.toUpperCase(),
          channels: 2,
          language: langMatch?.[1],
          title: nameMatch?.[1],
          isDefault,
          isForced: false,
          playable: isPlayableAudioCodec(detectedAudioCodec),
        });
      } else if (type === 'SUBTITLES') {
        subtitleTracks.push({
          index: subtitleTracks.length,
          codec: 'webvtt',
          language: langMatch?.[1],
          title: nameMatch?.[1],
          isDefault,
          isForced: false,
          isBitmap: false,
        });
      }
    }
  }

  if (audioTracks.length === 0) {
    audioTracks.push({
      index: 0,
      codec: detectedAudioCodec,
      codecLongName: detectedAudioCodec.toUpperCase(),
      channels: 2,
      isDefault: true,
      isForced: false,
      playable: isPlayableAudioCodec(detectedAudioCodec),
    });
  }

  return {
    formatName: 'hls,applehttp',
    formatLongName: 'Apple HLS',
    durationSeconds: undefined,
    video: hasVideo
      ? {
          index: 0,
          codec: detectedVideoCodec,
          codecLongName: detectedVideoCodec.toUpperCase(),
          bitDepth: detectedBitDepth,
          pixelFormat: detectedBitDepth > 8 ? 'yuv420p10le' : 'yuv420p',
          width: bestWidth || 1920,
          height: bestHeight || 1080,
          frameRate: frameRate || 23.976,
          /**
           * A manifest states a transfer function or it does not; ten bits is
           * not one. This read `bitDepth > 8`, and 10-bit SDR is ordinary —
           * most HEVC WEB-DL is exactly that — so every 10-bit playlist was
           * recorded as HDR. On the re-encode path that turns the tone-map on
           * for a stream that does not need it, which flattens a correct
           * picture in the same way omitting it ruins a real HDR one.
           *
           * Dolby Vision is the one case a codec string does assert, so it is
           * the only thing that can set this here.
           */
          isHdr: dolbyVision,
          ...(dolbyVision ? { dolbyVision: true } : {}),
          isInterlaced: false,
        }
      : null,
    audio: audioTracks,
    subtitles: subtitleTracks,
  };
}

/**
 * PRD-40.1 §4.2: Parses DASH manifests directly without ffprobe.
 */
export function parseDashManifest(manifestText: string): MediaMetadata | null {
  if (!manifestText.includes('<MPD') && !manifestText.includes('urn:mpeg:dash:schema:mpd:2011')) {
    return null;
  }

  let bestWidth = 0;
  let bestHeight = 0;
  let detectedVideoCodec = 'h264';
  let detectedAudioCodec = 'aac';
  let detectedBitDepth = 8;
  let dolbyVision = false;
  let hasVideo = false;

  const audioTracks: AudioStreamMetadata[] = [];
  const subtitleTracks: SubtitleStreamMetadata[] = [];

  const adaptationSetRegex = /<AdaptationSet([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
  let adaptMatch: RegExpExecArray | null;
  while ((adaptMatch = adaptationSetRegex.exec(manifestText)) !== null) {
    const attrs = adaptMatch[1];
    const body = adaptMatch[2];
    const isVideo = /contentType="video"/i.test(attrs) || /mimeType="video\//i.test(attrs) || /<Representation[^>]*mimeType="video\//i.test(body);
    const isAudio = /contentType="audio"/i.test(attrs) || /mimeType="audio\//i.test(attrs) || /<Representation[^>]*mimeType="audio\//i.test(body);

    if (isVideo) {
      hasVideo = true;
      const repRegex = /<Representation([^>]*)>/gi;
      let repTag: RegExpExecArray | null;
      while ((repTag = repRegex.exec(body)) !== null) {
        const repAttrs = repTag[1];
        const wMatch = /width="(\d+)"/i.exec(repAttrs);
        const hMatch = /height="(\d+)"/i.exec(repAttrs);
        const cMatch = /codecs="([^"]+)"/i.exec(repAttrs);
        if (wMatch && hMatch) {
          const w = Number(wMatch[1]);
          const h = Number(hMatch[1]);
          if (h >= bestHeight) {
            bestWidth = w;
            bestHeight = h;
          }
        }
        if (cMatch) {
          const normalized = normalizeCodecFromRfc6381(cMatch[1]);
          if (normalized.videoCodec) detectedVideoCodec = normalized.videoCodec;
          else if (normalized.videoUnknown) detectedVideoCodec = UNKNOWN_CODEC;
          if (normalized.dolbyVision) dolbyVision = true;
          if (normalized.bitDepth) detectedBitDepth = normalized.bitDepth;
        }
      }
      const codecAttr = /codecs="([^"]+)"/i.exec(attrs);
      if (codecAttr) {
        const normalized = normalizeCodecFromRfc6381(codecAttr[1]);
        if (normalized.videoCodec) detectedVideoCodec = normalized.videoCodec;
        else if (normalized.videoUnknown) detectedVideoCodec = UNKNOWN_CODEC;
        if (normalized.dolbyVision) dolbyVision = true;
        if (normalized.bitDepth) detectedBitDepth = normalized.bitDepth;
      }
    } else if (isAudio) {
      const langMatch = /lang="([^"]+)"/i.exec(attrs);
      const codecsMatch = /codecs="([^"]+)"/i.exec(attrs) || /codecs="([^"]+)"/i.exec(body);
      let codec = 'aac';
      if (codecsMatch) {
        const normalized = normalizeCodecFromRfc6381(codecsMatch[1]);
        if (normalized.audioCodec) codec = normalized.audioCodec;
        else if (normalized.audioUnknown) codec = UNKNOWN_CODEC;
      }
      audioTracks.push({
        index: audioTracks.length,
        codec,
        codecLongName: codec.toUpperCase(),
        channels: 2,
        language: langMatch?.[1],
        isDefault: audioTracks.length === 0,
        isForced: false,
        playable: isPlayableAudioCodec(codec),
      });
    }
  }

  /**
   * The rescue for a manifest whose AdaptationSets this parser could not
   * walk. The codec alternation is part of the *test*, so it decided which
   * manifests have video at all — and it listed four prefixes, which meant a
   * Dolby Vision or VVC manifest laid out this way was recorded as having no
   * video stream rather than an undecodable one.
   */
  if (
    !hasVideo &&
    (manifestText.includes('mimeType="video/') ||
      /codecs="(?:avc1|avc3|hvc1|hev1|dvh1|dvhe|dav1|dva1|dvav|vvc1|vvi1|vp0?[89]|av01)/i.test(
        manifestText
      ))
  ) {
    hasVideo = true;
    const codecMatch = /codecs="([^"]+)"/i.exec(manifestText);
    if (codecMatch) {
      const normalized = normalizeCodecFromRfc6381(codecMatch[1]);
      if (normalized.videoCodec) detectedVideoCodec = normalized.videoCodec;
      else if (normalized.videoUnknown) detectedVideoCodec = UNKNOWN_CODEC;
      if (normalized.dolbyVision) dolbyVision = true;
      if (normalized.bitDepth) detectedBitDepth = normalized.bitDepth;
    }
  }

  if (audioTracks.length === 0) {
    audioTracks.push({
      index: 0,
      codec: detectedAudioCodec,
      codecLongName: detectedAudioCodec.toUpperCase(),
      channels: 2,
      isDefault: true,
      isForced: false,
      playable: isPlayableAudioCodec(detectedAudioCodec),
    });
  }

  return {
    formatName: 'dash',
    formatLongName: 'MPEG-DASH',
    durationSeconds: undefined,
    video: hasVideo
      ? {
          index: 0,
          codec: detectedVideoCodec,
          codecLongName: detectedVideoCodec.toUpperCase(),
          bitDepth: detectedBitDepth,
          pixelFormat: detectedBitDepth > 8 ? 'yuv420p10le' : 'yuv420p',
          width: bestWidth || 1920,
          height: bestHeight || 1080,
          frameRate: 23.976,
          /** Same rule as the HLS path: ten bits is not a transfer function. */
          isHdr: dolbyVision,
          ...(dolbyVision ? { dolbyVision: true } : {}),
          isInterlaced: false,
        }
      : null,
    audio: audioTracks,
    subtitles: subtitleTracks,
  };
}

export function isMetadataIncomplete(meta: MediaMetadata | null): boolean {
  if (!meta) return true;
  if (!meta.formatName) return true;
  if (meta.video && (!meta.video.codec || !meta.video.bitDepth)) return true;
  return false;
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
      if (stream.codec_name === 'mjpeg' || stream.codec_name === 'png') continue;
      const pixelFormat = stream.pix_fmt;
      const transfer = stream.color_transfer;
      /**
       * Dolby Vision, from side data first and the codec tag as the fallback.
       *
       * Both are checked because they fail in different places: a remuxed MKV
       * routinely keeps the RPU while losing the `dvh1` tag, and a fragmented
       * MP4 read from a partial range can carry the tag before ffprobe has
       * seen enough frames to emit the configuration record.
       */
      const dvSideData = stream.side_data_list?.find(
        (entry) =>
          entry.dv_profile != null ||
          /dovi|dolby vision/i.test(entry.side_data_type ?? '')
      );
      const dolbyVision = Boolean(dvSideData) || isDolbyVisionTag(stream.codec_tag_string);
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
        /**
         * Dolby Vision counts as HDR even when the transfer says otherwise.
         *
         * Profile 5 signals its transfer inside the RPU rather than in the
         * container, so `color_transfer` comes back `unknown` on a great many
         * real files — which left `isHdr` false, and `withFfmpegExtras` only
         * tone-maps when `isHdr` is true. A DV release re-encoded on a machine
         * without mpv therefore skipped the tone-map and came out grey, which
         * is the failure the tone-map chain was built to prevent, reached
         * through the one path that never checked for it.
         */
        isHdr: transfer === 'smpte2084' || transfer === 'arib-std-b67' || dolbyVision,
        ...(dolbyVision ? { dolbyVision: true } : {}),
        ...(dvSideData?.dv_profile != null
          ? { dolbyVisionProfile: dvSideData.dv_profile }
          : {}),
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
  error?: string;
  timedOut: boolean;
  latencyMs: number;
  inspectionStrategy: InspectionStrategyType;
  probeIncomplete: boolean;
  probeBytesTransferred: number;
  probeNetworkMs: number;
  probeParseMs: number;
}

export class MediaInspector {
  private resolveFfprobe: () => string | null;
  private fetchHead: (url: string) => Promise<string | null>;

  constructor(
    resolveFfprobe: () => string | null,
    fetchHead: (url: string) => Promise<string | null>
  ) {
    this.resolveFfprobe = resolveFfprobe;
    this.fetchHead = fetchHead;
  }

  public async inspect(url: string, hintM3u8?: boolean): Promise<InspectionResult> {
    const finish = log.begin('inspect', { url });
    try {
      const result = await this.probe(url, hintM3u8);
      finish({
        status: result.metadata ? 'ok' : result.timedOut ? 'timeout' : 'failed',
        strategy: result.inspectionStrategy,
        probeIncomplete: result.probeIncomplete,
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
      finish({ status: 'threw', error: describeError(error) });
      throw error;
    }
  }

  private async probe(url: string, hintM3u8?: boolean): Promise<InspectionResult> {
    const startedAt = Date.now();
    const category = detectUrlType(url, hintM3u8);
    let transport: MediaTransport = category === 'manifest-hls' ? 'hls' : category === 'manifest-dash' ? 'dash' : 'progressive';
    let drm: DrmConfiguration = { type: 'none' };
    let inspectionStrategy: InspectionStrategyType = 'head';

    // 1. Manifest path (HLS / DASH)
    if (transport !== 'progressive' || /manifest|playlist|\.mpd|\.m3u8/i.test(url)) {
      const headFetchStart = Date.now();
      const head = await this.fetchHead(url);
      const headFetchMs = Date.now() - headFetchStart;

      if (head) {
        transport = classifyBody(head) ?? transport;
        drm = detectDrm(head, transport);

        if (transport === 'hls') {
          const parseStart = Date.now();
          const meta = parseHlsManifest(head);
          const parseMs = Date.now() - parseStart;
          return {
            metadata: meta,
            transport: 'hls',
            drm,
            timedOut: false,
            latencyMs: Date.now() - startedAt,
            inspectionStrategy: 'manifest-hls',
            probeIncomplete: isMetadataIncomplete(meta),
            probeBytesTransferred: head.length,
            probeNetworkMs: headFetchMs,
            probeParseMs: parseMs,
          };
        }

        if (transport === 'dash') {
          const parseStart = Date.now();
          const meta = parseDashManifest(head);
          const parseMs = Date.now() - parseStart;
          return {
            metadata: meta,
            transport: 'dash',
            drm,
            timedOut: false,
            latencyMs: Date.now() - startedAt,
            inspectionStrategy: 'manifest-dash',
            probeIncomplete: isMetadataIncomplete(meta),
            probeBytesTransferred: head.length,
            probeNetworkMs: headFetchMs,
            probeParseMs: parseMs,
          };
        }
      }
    }

    if (drmRequiresEme(drm)) {
      return {
        metadata: null,
        transport,
        drm,
        latencyMs: Date.now() - startedAt,
        timedOut: false,
        inspectionStrategy: 'head',
        probeIncomplete: false,
        probeBytesTransferred: 0,
        probeNetworkMs: 0,
        probeParseMs: 0,
      };
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
        inspectionStrategy: 'head',
        probeIncomplete: true,
        probeBytesTransferred: 0,
        probeNetworkMs: 0,
        probeParseMs: 0,
      };
    }

    // 2. Primary Head Probe
    inspectionStrategy = 'head';
    let currentProbeSize = PROBE_SIZE_DEFAULT;
    if (category === 'ts') {
      currentProbeSize = PROBE_SIZE_PROGRESSIVE;
    }

    let probeRun = await this.executeFfprobe(ffprobe, url, transport, currentProbeSize);
    let meta = probeRun.rawOutput ? parseProbeOutput(probeRun.rawOutput) : null;
    let incomplete = isMetadataIncomplete(meta);

    // 3. Container-Typed Incomplete Resolution per PRD-40.1 §4.2
    if (incomplete && probeRun.ok) {
      if (category === 'mp4') {
        // Non-faststart MP4/MOV with moov at end -> Tail probe
        inspectionStrategy = 'head+tail';
        log.info('probe_tail_retry_non_faststart_mp4', { url });
        const tailRun = await this.executeFfprobe(ffprobe, url, transport, PROBE_SIZE_PROGRESSIVE, ['-seek_to_start', '0']);
        if (tailRun.rawOutput) {
          const tailMeta = parseProbeOutput(tailRun.rawOutput);
          if (tailMeta && !isMetadataIncomplete(tailMeta)) {
            meta = tailMeta;
            probeRun = tailRun;
            incomplete = false;
          }
        }
      } else if (category === 'ts') {
        // MPEG-TS with multiple secondary tracks -> Raised probesize/analyzeduration
        inspectionStrategy = 'head+probesize';
        log.info('probe_ts_raised_probesize_retry', { url });
        const raisedRun = await this.executeFfprobe(ffprobe, url, transport, PROBE_SIZE_RAISED);
        if (raisedRun.rawOutput) {
          const raisedMeta = parseProbeOutput(raisedRun.rawOutput);
          if (raisedMeta && !isMetadataIncomplete(raisedMeta)) {
            meta = raisedMeta;
            probeRun = raisedRun;
            incomplete = false;
          }
        }
      } else {
        // Progressive widen for MKV / Unknown
        inspectionStrategy = 'progressive';
        log.info('probe_progressive_retry', { url, category });
        const progRun = await this.executeFfprobe(ffprobe, url, transport, PROBE_SIZE_PROGRESSIVE);
        if (progRun.rawOutput) {
          const progMeta = parseProbeOutput(progRun.rawOutput);
          if (progMeta && !isMetadataIncomplete(progMeta)) {
            meta = progMeta;
            probeRun = progRun;
            incomplete = false;
          }
        }
      }
    }

    const elapsed = Date.now() - startedAt;
    const probeNetworkMs = Math.max(0, elapsed - probeRun.parseMs);

    return {
      metadata: meta,
      transport,
      drm,
      error: probeRun.ok ? undefined : probeRun.error,
      timedOut: probeRun.timedOut,
      latencyMs: elapsed,
      inspectionStrategy,
      probeIncomplete: incomplete,
      probeBytesTransferred: currentProbeSize,
      probeNetworkMs,
      probeParseMs: probeRun.parseMs,
    };
  }

  private async executeFfprobe(
    ffprobe: string,
    url: string,
    transport: MediaTransport,
    probeSize: number,
    extraArgs: string[] = []
  ): Promise<{ ok: boolean; rawOutput: string | null; error?: string; timedOut: boolean; parseMs: number }> {
    const parseStart = Date.now();
    const result = await runTool(
      ffprobe,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_streams',
        '-show_entries', 'format=duration,format_name,format_long_name,bit_rate,size',
        '-probesize', String(probeSize || currentProbeConfig.probeSizeBytes),
        '-analyzeduration', String(probeSize || currentProbeConfig.probeSizeBytes),
        ...extraArgs,
        ...inputOptionsFor(url, transport),
        url,
      ],
      currentProbeConfig.probeTimeoutMs
    );
    const parseMs = Date.now() - parseStart;

    if (!result.ok) {
      return {
        ok: false,
        rawOutput: null,
        error: result.timedOut
          ? `ffprobe timed out after ${currentProbeConfig.probeTimeoutMs}ms`
          : result.stderr.trim() || `ffprobe exited ${result.code ?? 'with no code'}`,
        timedOut: result.timedOut,
        parseMs,
      };
    }

    return {
      ok: true,
      rawOutput: result.stdout,
      timedOut: false,
      parseMs,
    };
  }
}
