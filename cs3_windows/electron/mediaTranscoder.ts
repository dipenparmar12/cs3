import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import http from 'http';
import os from 'os';
import type { AddressInfo } from 'net';
import type { BinaryDownloader } from './binaryDownloader';
import type {
  HostEncodeCapability,
  MediaTransport,
  TransformationPlan,
} from '../src/types/media';
import { inputOptionsFor } from './media/mediaInspector.ts';
import { runTool } from './media/runTool.ts';

/**
 * Executes a {@link TransformationPlan} as a live HTTP stream.
 *
 * This file used to decide *and* execute. It no longer decides: the plan arrives
 * from `media/decisionEngine.ts`, which is a pure function of measured metadata,
 * and everything here is the mechanical translation of that plan into ffmpeg
 * arguments. Splitting the two is what makes the decision testable at all — and
 * every playback bug in PRD-37 §4.1 was a decision made with the wrong facts, not
 * an ffmpeg invocation that was subtly off.
 *
 * What Chromium cannot do, measured on this build rather than looked up:
 *
 * ```
 *   MP4 / AAC     probably      MKV / AC-3    no
 *   MKV / AAC     probably      MKV / E-AC-3  no
 *   MP4 / FLAC    probably      MKV / DTS     no
 *   MP4 / MP3     probably      MP4 / AC-3    no
 * ```
 *
 * The audio failure is silent and total: `video/x-matroska` still reports
 * "maybe", so the container opens, the video decodes, and the audio track is
 * dropped with no error. An H.264 + AC-3 file decodes 65,397 bytes of video and
 * exactly 0 bytes of audio, with a working volume slider.
 *
 * Video is worse. Chromium decodes H.264, VP8, VP9 and AV1 and none of HEVC
 * (outside platform-decoder builds), MPEG-2, VC-1, MPEG-4 Part 2 or WMV. HEVC is
 * routine in 4K and 10-bit releases. Android does not have this problem —
 * ExoPlayer hands the stream to the device's own hardware decoders.
 */

/** An encoder and the arguments it is used with; both are validated together. */
interface VideoEncoder {
  name: string;
  args: string[];
  accelerator: HostEncodeCapability['accelerator'];
}

/**
 * Hardware first, software last.
 *
 * Not an optimisation. Software-encoding a 4K HEVC source in real time is beyond
 * most machines — 11–13 FPS measured, 0.47x realtime — so this ordering is
 * frequently the difference between watchable and a permanent buffering stall.
 * Each candidate carries its own options because they disagree: AMF has no
 * `-preset` and rejects it outright.
 */
const ENCODER_CANDIDATES: VideoEncoder[] = [
  { name: 'h264_nvenc', args: ['-preset', 'p4', '-tune', 'll'], accelerator: 'nvenc' },
  { name: 'h264_qsv', args: ['-preset', 'fast'], accelerator: 'qsv' },
  { name: 'h264_amf', args: ['-quality', 'speed'], accelerator: 'amf' },
  { name: 'h264_mf', args: [], accelerator: 'mf' },
  { name: 'h264_videotoolbox', args: [], accelerator: 'videotoolbox' },
  // Watched once and discarded: latency matters, file size does not.
  { name: 'libx264', args: ['-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '22'], accelerator: 'cpu' },
];

const SOFTWARE_ENCODER: VideoEncoder = {
  name: 'libx264',
  args: ['-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '22'],
  accelerator: 'cpu',
};

/**
 * ffprobe codec names mapped to what `canPlayType` needs to be asked.
 *
 * The two vocabularies do not overlap: ffprobe says `hevc`, MSE wants
 * `hvc1.1.6.L93.B0`. Only codecs worth correcting are listed — there is no value
 * in asking the renderer about ones nothing produces. `hevc10` is asked
 * separately because Main 10 is supported separately from Main, and conflating
 * them stream-copied a 10-bit file as "playable" that then would not play.
 */
export const VIDEO_CODEC_PROBES: Record<string, string> = {
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  hevc10: 'video/mp4; codecs="hvc1.2.4.L120.B0"',
  h264: 'video/mp4; codecs="avc1.42E01E"',
  vp9: 'video/webm; codecs="vp09.00.10.08"',
  av1: 'video/mp4; codecs="av01.0.04M.08"',
  mpeg2video: 'video/mp2t; codecs="mp2v"',
  mpeg4: 'video/mp4; codecs="mp4v.20.8"',
};

/**
 * The output wrapper, as ffmpeg arguments.
 *
 * WebM is not a stylistic alternative to MP4 here — it is the only wrapper that
 * takes VP8, which ffmpeg flatly refuses to write into MP4 (`Could not find tag
 * for codec vp8 in stream #0`), killing the command at the header. See
 * `chooseCopyContainer`, which is what decides between them.
 *
 * `-live 1` matters for the same reason `frag_keyframe+empty_moov` does on the
 * MP4 side: the default WebM muxer seeks back to the head of the file to write
 * cue points and the duration, and the output here is a pipe that cannot seek.
 * Without it the muxer produces a file whose header is never finalised.
 */
function containerOptionsFor(action: TransformationPlan['containerAction']): string[] {
  if (action === 'webm') {
    return ['-live', '1', '-cluster_time_limit', '2000', '-f', 'webm'];
  }
  return ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4'];
}

/** The wrapper's MIME type. A WebM served as `video/mp4` is refused outright. */
function contentTypeFor(action: TransformationPlan['containerAction']): string {
  return action === 'webm' ? 'video/webm' : 'video/mp4';
}

/** How long a subtitle extraction may run before it is given up on. */
const SUBTITLE_EXTRACT_TIMEOUT_MS = 180_000;

interface Session {
  url: string;
  transport: MediaTransport;
  plan: TransformationPlan;
}

export class MediaTranscoder {
  private binaries: BinaryDownloader;
  private server: http.Server | null = null;
  private port = 0;
  /** Live ffmpeg processes, keyed by session token, so each can be replaced. */
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private sessions = new Map<string, Session>();
  private nextToken = 1;
  /** Where probe and encode failures are reported; see `setDiagnostics`. */
  private diagnostics: {
    record(entry: {
      level: 'error' | 'warn' | 'info';
      stage: 'playback';
      url?: string;
      message: string;
      detail?: string;
    }): void;
  } | null = null;
  /** The encoder that passed its test encode. Fixed for the run once chosen. */
  private videoEncoder: VideoEncoder | null = null;
  /** Extracted WebVTT, keyed by `${url}#${index}` — extraction is not cheap. */
  private subtitleCache = new Map<string, string>();

  constructor(binaries: BinaryDownloader) {
    this.binaries = binaries;
  }

  public setDiagnostics(sink: NonNullable<MediaTranscoder['diagnostics']>): void {
    this.diagnostics = sink;
  }

  public isAvailable(): boolean {
    return Boolean(
      this.binaries.resolveBinary('ffmpeg') && this.binaries.resolveBinary('ffprobe')
    );
  }

  public resolveFfprobe(): string | null {
    return this.binaries.resolveBinary('ffprobe');
  }

  // --- host capability -----------------------------------------------------

  /**
   * What this machine can actually encode with, and how fast.
   *
   * Needed *before* the strategy is chosen, not after: the software-encoder
   * guard in `decisionEngine` decides whether a 4K source keeps its resolution,
   * and it cannot decide that without knowing whether a GPU encoder exists. So
   * this is resolved once during playback preparation and handed to the engine.
   */
  public async hostCapability(): Promise<HostEncodeCapability> {
    const encoder = await this.resolveVideoEncoder();
    return {
      hardware: encoder.accelerator !== 'cpu',
      accelerator: encoder.accelerator,
      logicalCores: os.cpus().length || 4,
    };
  }

  /**
   * The best H.264 encoder this machine can actually run.
   *
   * **Test-encoded, not listed.** `ffmpeg -encoders` reports what the binary was
   * *built* with, which is not what the hardware supports: the bundled build
   * advertises `h264_nvenc`, `h264_qsv` and `h264_amf` on every machine, and on
   * the development machine only QSV opens — NVENC fails with "Could not open
   * encoder" because there is no NVIDIA GPU. Trusting the listing meant choosing
   * an encoder that dies the moment a viewer presses play.
   *
   * The test surface is **10-bit** (`yuv420p10le`), because that is the real
   * workload: the sources that need re-encoding are overwhelmingly HEVC Main 10,
   * and a driver that opens for 8-bit input and rejects a 10-bit one would pass
   * an 8-bit test and fail in front of the viewer. Each candidate also runs with
   * the exact arguments it would be used with, so an option a given encoder
   * rejects removes it from consideration rather than failing mid-stream.
   */
  private async resolveVideoEncoder(): Promise<VideoEncoder> {
    if (this.videoEncoder) return this.videoEncoder;

    const ffmpeg = this.binaries.resolveBinary('ffmpeg');
    if (!ffmpeg) return SOFTWARE_ENCODER;

    for (const candidate of ENCODER_CANDIDATES) {
      const works = await runTool(
        ffmpeg,
        [
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi',
          '-i', 'color=c=black:s=256x256:d=0.1,format=yuv420p10le',
          '-c:v', candidate.name,
          ...candidate.args,
          '-pix_fmt', 'yuv420p',
          '-frames:v', '1',
          '-f', 'null', '-',
        ],
        20_000
      );
      if (works.ok) {
        this.videoEncoder = candidate;
        return candidate;
      }
    }

    this.videoEncoder = SOFTWARE_ENCODER;
    return SOFTWARE_ENCODER;
  }

  // --- sessions ------------------------------------------------------------

  /**
   * Opens a session and returns a loopback URL to play.
   *
   * The URL is stable across seeks: the player points at it once, and each range
   * request restarts ffmpeg from the requested position. Handing back a new URL
   * per seek would reset the element and lose playback state — and the element
   * *is* the playback, so that would also drop the swarm.
   */
  public async createSession(
    url: string,
    plan: TransformationPlan,
    transport: MediaTransport = 'progressive'
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;
    await this.ensureServer();
    // Resolved before the first request so the decision is not made on the hot
    // path, where a 15-second encoder probe would look like a stalled stream.
    if (plan.videoAction === 'transcode' || plan.videoAction === 'downscale') {
      await this.resolveVideoEncoder();
    }

    const token = String(this.nextToken++);
    this.sessions.set(token, { url, plan, transport });
    return `http://127.0.0.1:${this.port}/media/${token}`;
  }

  /**
   * Replaces a live session's plan, for an audio-track switch.
   *
   * Takes the whole plan rather than an index, because switching track can
   * change whether the audio is copied or re-encoded — the previous signature
   * could only move the index, which let a caller point a copy-the-audio plan at
   * an AC-3 track and get `Cannot write moov atom before AC3 packets` instead of
   * a stream. See `planForAudioTrack`.
   *
   * Returns whether the session exists; the caller re-requests the URL to make
   * the change take effect, because the element only ever receives the one track
   * mapped for it and ffmpeg has to restart at the current position.
   */
  public updatePlan(token: string, plan: TransformationPlan): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    session.plan = plan;
    return true;
  }

  public planFor(token: string): TransformationPlan | null {
    return this.sessions.get(token)?.plan ?? null;
  }

  /** The playback URL of an open session, for restarting it after a switch. */
  public streamUrl(token: string): string | null {
    if (!this.sessions.has(token) || !this.port) return null;
    return `http://127.0.0.1:${this.port}/media/${token}`;
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

  // --- argument construction -----------------------------------------------

  /**
   * The plan, as ffmpeg arguments.
   *
   * Exported shape rather than inlined so the e2e harness can assert on what
   * would be run without running it — the arguments are the contract PRD-38's
   * test spec checks, and reconstructing them in a test would test the copy.
   */
  public buildArgs(session: Session, seekSeconds: number): string[] {
    const { plan } = session;
    const encoder = this.videoEncoder ?? SOFTWARE_ENCODER;

    const videoArgs: string[] = [];
    if (plan.videoAction === 'copy') {
      videoArgs.push('-c:v', 'copy');
    } else if (plan.videoAction === 'transcode' || plan.videoAction === 'downscale') {
      if (plan.videoAction === 'downscale' && plan.targetHeight) {
        /**
         * The software-encoder guard, and the whole reason for the `downscale`
         * action existing as something distinct from `transcode`.
         *
         * Measured on a 3840x2160 10-bit HEVC source: libx264 at native
         * resolution encodes at 11–13 FPS, so Chromium drains its buffer in
         * three seconds and stalls permanently. The same encode at 1080p runs
         * at 26–28 FPS — above realtime — and plays smoothly. `-2` keeps the
         * width even, which H.264 requires.
         */
        videoArgs.push('-vf', `scale=-2:${plan.targetHeight}`);
      }
      videoArgs.push('-c:v', encoder.name, ...encoder.args);
      // 8-bit 4:2:0 is what Chromium decodes. HEVC sources are routinely 10-bit,
      // and handing back 10-bit H.264 would swap one undecodable stream for
      // another.
      videoArgs.push('-pix_fmt', plan.targetPixelFormat ?? 'yuv420p');
      /**
       * A short GOP so the first fragment arrives quickly.
       *
       * `-movflags frag_keyframe` emits one fragment per keyframe, so the
       * player waits for a whole GOP before it has anything to decode. A source
       * default of 250 frames is ten seconds of dead air on a stream the viewer
       * has just asked for; 48 frames is about two.
       */
      videoArgs.push('-g', '48', '-keyint_min', '48');
      if (encoder.accelerator === 'cpu') {
        videoArgs.push('-threads', '0', '-maxrate', '25M', '-bufsize', '50M');
      }
    } else {
      videoArgs.push('-c:v', 'copy');
    }

    const audioArgs: string[] = [];
    if (plan.selectedAudioIndex >= 0) {
      audioArgs.push(
        ...(plan.audioAction === 'transcode'
          ? /**
             * Downmixed to stereo deliberately.
             *
             * 5.1 AC-3 re-encoded as 5.1 AAC decodes but routes to the wrong
             * outputs on most desktop setups, which sounds like the dialogue has
             * gone missing — a different bug wearing the costume of the one this
             * exists to fix.
             */
            ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']
          : ['-c:a', 'copy'])
      );
    }

    return [
      '-hide_banner', '-loglevel', 'error',
      ...inputOptionsFor(session.url, session.transport),
      // Before -i: seeks by keyframe without decoding everything up to it.
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-i', session.url,
      '-map', '0:v:0',
      ...(plan.selectedAudioIndex >= 0
        ? ['-map', `0:a:${plan.selectedAudioIndex}?`]
        : ['-an']),
      ...videoArgs,
      ...audioArgs,
      // Timestamps from a scraped stream are routinely broken; without this an
      // MPEG-TS remux produces "Application provided invalid, non monotonically
      // increasing dts" and drops frames.
      '-fflags', '+genpts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      ...containerOptionsFor(plan.containerAction),
      'pipe:1',
    ];
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '';
    const subtitle = url.match(/^\/subtitle\/(\d+)\/(\d+)/);
    if (subtitle) {
      void this.serveSubtitle(res, subtitle[1], Number(subtitle[2]));
      return;
    }

    const match = url.match(/^\/media\/(\d+)/);
    const token = match?.[1];
    const session = token ? this.sessions.get(token) : undefined;

    if (!token || !session) {
      res.writeHead(404).end('Unknown transcode session');
      return;
    }

    /**
     * A fragmented MP4 produced on the fly has no index, so byte ranges are
     * meaningless. Seeking is served by restarting ffmpeg at the requested time
     * instead, which the player triggers by re-requesting with `?t=`.
     *
     * Accuracy is bounded by the source's keyframe interval, because `-c:v copy`
     * can only begin at a keyframe. Real releases place one every few seconds so
     * the error is small; a file with a single keyframe cannot be seeked at all
     * by copy and restarts from the beginning.
     */
    const seek = Number(new URL(url, 'http://127.0.0.1').searchParams.get('t')) || 0;

    this.kill(token);

    const ffmpeg = this.binaries.resolveBinary('ffmpeg');
    if (!ffmpeg) {
      res.writeHead(503).end('ffmpeg is not installed');
      return;
    }

    const proc = spawn(ffmpeg, this.buildArgs(session, seek), { windowsHide: true });
    this.active.set(token, proc);

    res.writeHead(200, {
      'Content-Type': contentTypeFor(session.plan.containerAction),
      // Ranges cannot be honoured on a live pipe; saying so stops the player
      // from issuing range requests it will not get an answer to.
      'Accept-Ranges': 'none',
      'Cache-Control': 'no-store',
    });

    /**
     * Both ends of the pipe are guarded, not just the source.
     *
     * `pipe` does not forward errors, and this pipe breaks routinely: every seek
     * kills the ffmpeg process mid-write, and a viewer closing the player
     * destroys the socket underneath a conversion still producing output. An
     * unhandled `error` on either stream is an uncaught exception in the main
     * process. Neither is worth reporting — a killed transcode is what seeking
     * *is*, and a closed socket is the viewer leaving.
     */
    proc.stdout.on('error', () => this.kill(token));
    res.on('error', () => this.kill(token));

    proc.stdout.pipe(res);

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderr.length < 4_000) stderr += text;
      const trimmed = text.trim();
      if (trimmed) console.warn(`[transcode] ${trimmed.slice(0, 300)}`);
    });

    proc.on('close', (code) => {
      // Code 255 is the kill this issues itself on seek or teardown, which is
      // routine and not worth reporting.
      if (code === 0 || code === null || code === 255) return;
      this.diagnostics?.record({
        level: 'error',
        stage: 'playback',
        url: session.url,
        message: `ffmpeg exited ${code} while converting this stream`,
        detail: stderr.trim() || undefined,
      });
    });

    const cleanup = () => this.kill(token);
    res.on('close', cleanup);
    proc.on('error', (error) => {
      console.warn('[transcode] ffmpeg failed to start:', error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  }

  // --- embedded subtitles --------------------------------------------------

  /**
   * A URL serving one embedded subtitle track as WebVTT.
   *
   * `<track>` rejects SubRip and ASS silently — WebVTT is the only text format a
   * media element accepts — and there is no way for the renderer to reach inside
   * a Matroska file to get at them. Without this, a release carrying its own
   * forced-narrative subtitles had none in the app, and an extension-sourced film
   * with no IMDb id could not be helped by the online search either.
   *
   * **Honest limitation.** Subtitle streams are interleaved through the whole
   * file, so extracting them means reading the whole file: a 25 GB remote MKV
   * cannot be subtitled quickly, and this is bounded at three minutes rather than
   * left to run. That is why it is on demand — the viewer asked for this track —
   * and cached, so asking twice costs once.
   */
  public subtitleUrl(token: string, index: number): string | null {
    if (!this.sessions.has(token) || !this.port) return null;
    return `http://127.0.0.1:${this.port}/subtitle/${token}/${index}`;
  }

  private async serveSubtitle(
    res: http.ServerResponse,
    token: string,
    index: number
  ): Promise<void> {
    const session = this.sessions.get(token);
    const ffmpeg = this.binaries.resolveBinary('ffmpeg');
    if (!session || !ffmpeg || !Number.isInteger(index) || index < 0) {
      res.writeHead(404).end('Unknown subtitle track');
      return;
    }

    const key = `${session.url}#${index}`;
    const cached = this.subtitleCache.get(key);
    if (cached !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' }).end(cached);
      return;
    }

    const result = await runTool(
      ffmpeg,
      [
        '-hide_banner', '-loglevel', 'error',
        ...inputOptionsFor(session.url, session.transport),
        '-i', session.url,
        '-map', `0:s:${index}`,
        '-c:s', 'webvtt',
        '-f', 'webvtt',
        'pipe:1',
      ],
      SUBTITLE_EXTRACT_TIMEOUT_MS
    );

    if (!result.ok || !result.stdout.trim()) {
      this.diagnostics?.record({
        level: 'warn',
        stage: 'playback',
        url: session.url,
        message: `Embedded subtitle track ${index + 1} could not be extracted`,
        detail: result.timedOut
          ? 'Extraction has to read the whole file and did not finish within three minutes.'
          : result.stderr.trim() || undefined,
      });
      res.writeHead(422).end('This subtitle track could not be extracted.');
      return;
    }

    // Bounded: a full film's subtitles are ~100 KB, and caching more than a
    // handful of those in an app that stays open for days is a leak.
    if (this.subtitleCache.size > 24) {
      const oldest = this.subtitleCache.keys().next().value;
      if (oldest !== undefined) this.subtitleCache.delete(oldest);
    }
    this.subtitleCache.set(key, result.stdout);
    res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' }).end(result.stdout);
  }

  /** Stops every live process and the server. Wired into app shutdown. */
  public shutdown(): void {
    for (const token of [...this.active.keys()]) this.kill(token);
    this.sessions.clear();
    this.subtitleCache.clear();
    this.server?.close();
    this.server = null;
  }
}
