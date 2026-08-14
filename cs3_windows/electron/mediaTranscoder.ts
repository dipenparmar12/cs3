import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import type { BinaryDownloader } from './binaryDownloader';

/**
 * Makes media playable that Chromium refuses to decode.
 *
 * Measured against this Electron build with `canPlayType`, not assumed:
 *
 * ```
 *   MP4 / AAC     probably      MKV / AC-3    no
 *   MKV / AAC     probably      MKV / E-AC-3  no
 *   MP4 / FLAC    probably      MKV / DTS     no
 *   MP4 / MP3     probably      MP4 / AC-3    no
 * ```
 *
 * Chromium ships without the AC-3, E-AC-3 and DTS decoders. The failure is
 * silent and total: `video/x-matroska` still reports "maybe", so the container
 * opens, the video decodes, and the audio track is simply dropped. No error
 * fires, nothing is logged, and the volume control works perfectly on a stream
 * with no sound in it. That is precisely the reported bug.
 *
 * It hits series far harder than films, which is why it looked provider-specific
 * rather than codec-specific: TV releases are overwhelmingly HDTV or WEB-DL
 * carrying broadcast AC-3/E-AC-3, while film web-rips usually carry AAC.
 *
 * The fix is to remux on the fly and serve the result from a loopback HTTP
 * server.
 *
 * **Video has the same problem, and it is worse.** Chromium decodes H.264, VP8,
 * VP9 and AV1; it does not decode HEVC outside specific platform-decoder builds,
 * and it decodes none of MPEG-2, VC-1, MPEG-4 Part 2 (DivX/Xvid) or WMV. HEVC is
 * now routine in exactly the releases people want — 4K and most 10-bit encodes —
 * so "the browser could not decode this file" was a dead end for a growing share
 * of sources. Android does not have this problem: ExoPlayer hands the stream to
 * the device's hardware decoders, which handle all of these.
 *
 * So video is re-encoded **only when it has to be**, and copied otherwise. That
 * distinction matters more here than anywhere else in this file: re-encoding
 * video is expensive enough to matter on a laptop, where remuxing audio is free.
 * A hardware encoder is used when one exists (NVENC, QSV, AMF) precisely because
 * the software fallback is the difference between watchable and not.
 *
 * What is decodable is **measured, not assumed** — see {@link setCapabilities}.
 * Chromium's HEVC support varies by build and platform, so the renderer reports
 * what its own `canPlayType` actually says and this file believes it over any
 * table compiled here.
 */

/** Codecs this Chromium has no decoder for. Everything else is left alone. */
const UNSUPPORTED_AUDIO = new Set([
  'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'dtshd', 'dca',
]);

/**
 * Video codecs assumed undecodable until the renderer says otherwise.
 *
 * Conservative on purpose: transcoding something that would have played costs
 * CPU, while failing to transcode something that will not play costs the user
 * the film. `hevc` is the entry that matters and the one most likely to be
 * corrected at runtime — some Electron builds decode it through platform
 * decoders, and {@link setCapabilities} is how they say so.
 */
const UNSUPPORTED_VIDEO = new Set([
  'hevc', 'h265', 'mpeg2video', 'vc1', 'wmv1', 'wmv2', 'wmv3',
  'msmpeg4v1', 'msmpeg4v2', 'msmpeg4v3', 'mpeg4', 'msvideo1',
  'prores', 'dnxhd', 'cinepak', 'rv40', 'vp6f',
]);

/**
 * ffprobe codec names mapped to what `canPlayType` needs to be asked.
 *
 * The two vocabularies do not overlap: ffprobe says `hevc`, MSE wants
 * `hvc1.1.6.L93.B0`. Only codecs worth correcting are listed — there is no
 * value in asking the renderer about ones nothing produces.
 */
/** An encoder and the arguments it is used with; both are validated together. */
interface VideoEncoder {
  name: string;
  args: string[];
}

/**
 * Hardware first, software last.
 *
 * Not an optimisation: software-encoding a 4K HEVC source in real time is
 * beyond most laptops, so this ordering is frequently the difference between
 * watchable and a stall. Each carries its own options because they disagree —
 * AMF has no `-preset` and rejects it.
 */
const ENCODER_CANDIDATES: VideoEncoder[] = [
  { name: 'h264_nvenc', args: ['-preset', 'p4'] },
  { name: 'h264_qsv', args: ['-preset', 'fast'] },
  { name: 'h264_amf', args: ['-quality', 'speed'] },
  { name: 'h264_videotoolbox', args: [] },
  // Watched once and discarded: latency matters, file size does not.
  { name: 'libx264', args: ['-preset', 'veryfast'] },
];

export const VIDEO_CODEC_PROBES: Record<string, string> = {
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  h264: 'video/mp4; codecs="avc1.42E01E"',
  vp9: 'video/webm; codecs="vp09.00.10.08"',
  av1: 'video/mp4; codecs="av01.0.04M.08"',
  mpeg2video: 'video/mp2t; codecs="mp2v"',
  mpeg4: 'video/mp4; codecs="mp4v.20.8"',
};

export interface AudioStreamInfo {
  /** Index within the file's audio streams, which is what `-map 0:a:N` takes. */
  index: number;
  codec: string;
  language?: string;
  title?: string;
  channels?: number;
  isDefault: boolean;
  /** False when Chromium cannot decode it, and transcoding is required. */
  playable: boolean;
}

export interface MediaProbe {
  audio: AudioStreamInfo[];
  videoCodec?: string;
  /** False when Chromium has no decoder for the video, so it must be re-encoded. */
  videoPlayable: boolean;
  durationSeconds?: number;
  /** True when the default audio track cannot be played as-is. */
  needsAudioTranscode: boolean;
  /** True when the video stream has to be re-encoded. The expensive case. */
  needsVideoTranscode: boolean;
  /** Either of the above. What a caller checks to decide whether to remux at all. */
  needsTranscode: boolean;
}

/** What the renderer measured about its own decoders. See `setCapabilities`. */
/** Why a probe produced nothing, when it produced nothing. */
export interface ProbeFailure {
  /** HTTP status the source answered with, when it answered at all. */
  status?: number;
  reason: string;
  /** True when the source is gone rather than merely undecodable. */
  dead: boolean;
}

export interface RendererCapabilities {
  /** ffprobe codec name to whether `canPlayType` returned anything but "". */
  video: Record<string, boolean>;
}

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  disposition?: { default?: number };
  tags?: { language?: string; title?: string };
}

/** Probing must not delay playback; a slow answer is worse than no answer. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * `-user_agent` belongs to the HTTP demuxer, and FFmpeg fails outright with
 * "Option user_agent not found" when it is passed for a local path. Providers
 * 403 often enough that omitting it on network input turns a working stream
 * into a phantom "no audio", so it has to be applied conditionally rather than
 * always or never.
 */
function inputOptionsFor(url: string): string[] {
  return /^https?:\/\//i.test(url)
    ? ['-user_agent', 'Mozilla/5.0 CloudStreamDesktop']
    : [];
}

export class MediaTranscoder {
  private binaries: BinaryDownloader;
  private server: http.Server | null = null;
  private port = 0;
  /** Live ffmpeg processes, keyed by session token, so each can be replaced. */
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private sessions = new Map<
    string,
    { url: string; audioIndex: number; transcodeVideo: boolean }
  >();
  private nextToken = 1;
  /** What the renderer reported it can decode; overrides the static table. */
  private capabilities: RendererCapabilities | null = null;
  /** The encoder that passed its test encode. Fixed for the run once chosen. */
  private videoEncoder: VideoEncoder | null = null;

  constructor(binaries: BinaryDownloader) {
    this.binaries = binaries;
  }

  /**
   * Records what the renderer's own decoders actually support.
   *
   * Believed over {@link UNSUPPORTED_VIDEO}, in both directions. Chromium's HEVC
   * support depends on the build and on platform decoders being present, so a
   * table compiled here is a guess about someone else's machine; `canPlayType`
   * in the renderer is a measurement of the machine in question. The same
   * reasoning produced the audio table in the first place — it was measured, not
   * looked up.
   */
  public setCapabilities(capabilities: RendererCapabilities): void {
    this.capabilities = capabilities;
  }

  /** True when this codec plays as-is, preferring the measured answer. */
  private canPlayVideo(codec: string | undefined): boolean {
    if (!codec) return true;
    const name = codec.toLowerCase();
    const measured = this.capabilities?.video?.[name];
    if (typeof measured === 'boolean') return measured;
    return !UNSUPPORTED_VIDEO.has(name);
  }

  public isAvailable(): boolean {
    return Boolean(
      this.binaries.resolveBinary('ffmpeg') && this.binaries.resolveBinary('ffprobe')
    );
  }

  // --- probing -------------------------------------------------------------

  /**
   * Lists the audio tracks in a stream and says whether they can be played.
   *
   * This is also what makes multi-audio selection meaningful. A plain `<video>`
   * element exposes almost nothing about tracks it cannot decode, so without a
   * probe the app cannot even tell the user that a Japanese AC-3 track exists.
   */
  public async probe(url: string): Promise<MediaProbe | null> {
    const ffprobe = this.binaries.resolveBinary('ffprobe');
    if (!ffprobe) return null;

    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      '-show_entries', 'format=duration',
      ...inputOptionsFor(url),
      url,
    ];

    const raw = await this.run(ffprobe, args, PROBE_TIMEOUT_MS);
    if (!raw) return null;

    let parsed: { streams?: FfprobeStream[]; format?: { duration?: string } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const audio: AudioStreamInfo[] = [];
    let videoCodec: string | undefined;
    let audioOrdinal = 0;

    for (const stream of parsed.streams ?? []) {
      if (stream.codec_type === 'video' && !videoCodec) {
        videoCodec = stream.codec_name;
        continue;
      }
      if (stream.codec_type !== 'audio') continue;

      const codec = (stream.codec_name ?? '').toLowerCase();
      audio.push({
        index: audioOrdinal++,
        codec,
        language: stream.tags?.language,
        title: stream.tags?.title,
        channels: stream.channels,
        isDefault: stream.disposition?.default === 1,
        playable: !UNSUPPORTED_AUDIO.has(codec),
      });
    }

    const preferred = audio.find((a) => a.isDefault) ?? audio[0];
    const duration = Number(parsed.format?.duration);
    const videoPlayable = this.canPlayVideo(videoCodec);
    // No audio at all is not a transcoding problem, so it is not claimed as one.
    const needsAudioTranscode = Boolean(preferred && !preferred.playable);
    const needsVideoTranscode = Boolean(videoCodec) && !videoPlayable;

    return {
      audio,
      videoCodec,
      videoPlayable,
      durationSeconds: Number.isFinite(duration) ? duration : undefined,
      needsAudioTranscode,
      needsVideoTranscode,
      needsTranscode: needsAudioTranscode || needsVideoTranscode,
    };
  }

  /**
   * The best H.264 encoder this machine can actually run.
   *
   * **Test-encoded, not listed.** `ffmpeg -encoders` reports what the binary was
   * *built* with, which is not what the hardware supports: the bundled build
   * advertises `h264_nvenc`, `h264_qsv` and `h264_amf` on every machine, and on
   * the one this was written on only QSV opens — NVENC fails with "Could not
   * open encoder" because there is no NVIDIA GPU. Trusting the listing meant
   * choosing an encoder that dies the moment a viewer presses play, which is the
   * worst possible time to discover it.
   *
   * So each candidate encodes one frame to null with the exact arguments it
   * would be used with. That also validates the arguments themselves — encoders
   * disagree about `-preset` — so an option a given encoder rejects removes it
   * from consideration instead of failing mid-stream.
   *
   * Costs a few hundred milliseconds, once, and only when a video transcode is
   * actually needed. `libx264` is last and always works.
   */
  private async resolveVideoEncoder(): Promise<VideoEncoder> {
    if (this.videoEncoder) return this.videoEncoder;

    const ffmpeg = this.binaries.resolveBinary('ffmpeg');
    const fallback: VideoEncoder = { name: 'libx264', args: ['-preset', 'veryfast'] };
    if (!ffmpeg) return fallback;

    for (const candidate of ENCODER_CANDIDATES) {
      const works = await this.run(
        ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=128x128:d=0.1',
          '-c:v', candidate.name,
          ...candidate.args,
          '-pix_fmt', 'yuv420p',
          '-frames:v', '1',
          '-f', 'null', '-',
        ],
        20_000
      );
      // `run` resolves null on a non-zero exit, which is exactly the signal.
      if (works !== null) {
        this.videoEncoder = candidate;
        return candidate;
      }
    }

    this.videoEncoder = fallback;
    return fallback;
  }

  // --- transcoding ---------------------------------------------------------

  /**
   * Opens a remuxing session and returns a loopback URL to play.
   *
   * The URL is stable across seeks: the player points at it once, and each
   * range request restarts ffmpeg from the requested position. Handing back a
   * new URL per seek would reset the element and lose playback state.
   */
  public async createSession(
    url: string,
    audioIndex: number,
    transcodeVideo = false
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;
    await this.ensureServer();
    // Resolved before the first request so the decision is not made on the hot
    // path, where a 15-second encoder probe would look like a stalled stream.
    if (transcodeVideo) await this.resolveVideoEncoder();

    const token = String(this.nextToken++);
    this.sessions.set(token, { url, audioIndex, transcodeVideo });
    return `http://127.0.0.1:${this.port}/media/${token}`;
  }

  public setAudioIndex(token: string, audioIndex: number): void {
    const session = this.sessions.get(token);
    if (session) session.audioIndex = audioIndex;
  }

  public closeSession(token: string): void {
    this.kill(token);
    this.sessions.delete(token);
  }

  private kill(token: string): void {
    const proc = this.active.get(token);
    if (!proc) return;
    this.active.delete(token);
    try {
      proc.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const match = req.url?.match(/^\/media\/(\d+)/);
    const token = match?.[1];
    const session = token ? this.sessions.get(token) : undefined;

    if (!token || !session) {
      res.writeHead(404).end('Unknown transcode session');
      return;
    }

    /**
     * A fragmented MP4 produced on the fly has no index, so byte ranges are
     * meaningless. Seeking is served by restarting ffmpeg at the requested
     * time instead, which the player triggers by re-requesting with `?t=`.
     *
     * Accuracy is bounded by the source's keyframe interval, because `-c:v
     * copy` can only begin at a keyframe. Real releases place one every few
     * seconds so the error is small; a file with a single keyframe cannot be
     * seeked at all by copy and will restart from the beginning.
     */
    const seek = Number(new URL(req.url!, 'http://127.0.0.1').searchParams.get('t')) || 0;

    this.kill(token);

    const ffmpeg = this.binaries.resolveBinary('ffmpeg');
    if (!ffmpeg) {
      res.writeHead(503).end('ffmpeg is not installed');
      return;
    }

    /**
     * Video is copied unless it genuinely cannot be decoded.
     *
     * Copying is close to free and re-encoding is not, so the two cases are
     * kept strictly apart. When a re-encode is unavoidable — HEVC being the
     * common reason — it targets H.264 through whatever hardware encoder this
     * machine has, because software encoding a 4K source in real time is not
     * something most laptops manage.
     */
    const encoder = this.videoEncoder ?? { name: 'libx264', args: ['-preset', 'veryfast'] };
    const videoArgs = session.transcodeVideo
      ? [
          '-c:v', encoder.name,
          ...encoder.args,
          // 8-bit 4:2:0 is what Chromium decodes. HEVC sources are routinely
          // 10-bit, and handing back 10-bit H.264 would swap one undecodable
          // stream for another.
          '-pix_fmt', 'yuv420p',
          '-b:v', '6M',
          '-maxrate', '8M',
          '-bufsize', '12M',
        ]
      : ['-c:v', 'copy'];

    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...inputOptionsFor(session.url),
      // Before -i: seeks by keyframe without decoding everything up to it.
      ...(seek > 0 ? ['-ss', String(seek)] : []),
      '-i', session.url,
      '-map', '0:v:0',
      '-map', `0:a:${session.audioIndex}?`,
      ...videoArgs,
      '-c:a', 'aac',
      '-b:a', '192k',
      // Downmixed to stereo: a 5.1 AC-3 track re-encoded to 5.1 AAC is decoded
      // by Chromium but routed to the wrong outputs on most desktop setups,
      // which sounds like missing dialogue.
      '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    ];

    const proc = spawn(ffmpeg, args, { windowsHide: true });
    this.active.set(token, proc);

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      // Ranges cannot be honoured on a live pipe; saying so stops the player
      // from issuing range requests it will not get an answer to.
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store',
    });

    proc.stdout.pipe(res);
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`[transcode] ${text.slice(0, 300)}`);
    });

    const cleanup = () => this.kill(token);
    res.on('close', cleanup);
    proc.on('error', (error) => {
      console.warn('[transcode] ffmpeg failed to start:', error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  private run(command: string, args: string[], timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;

      const proc = spawn(command, args, { windowsHide: true });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        resolve(null);
      }, timeoutMs);

      proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code === 0 ? output : null);
      });
    });
  }

  /** Stops every live process and the server. Wired into app shutdown. */
  public shutdown(): void {
    for (const token of [...this.active.keys()]) this.kill(token);
    this.sessions.clear();
    this.server?.close();
    this.server = null;
  }
}
