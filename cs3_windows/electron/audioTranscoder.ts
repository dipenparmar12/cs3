import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import http from 'http';
import type { AddressInfo } from 'net';
import type { BinaryDownloader } from './binaryDownloader';

/**
 * Makes audio audible that Chromium refuses to decode.
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
 * The fix is to remux on the fly — copy the video untouched and re-encode only
 * the audio to AAC — and serve the result from a loopback HTTP server. Video is
 * never re-encoded: it is the expensive part and there is nothing wrong with it.
 */

/** Codecs this Chromium has no decoder for. Everything else is left alone. */
const UNSUPPORTED_AUDIO = new Set([
  'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'dtshd', 'dca',
]);

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
  durationSeconds?: number;
  /** True when the default audio track cannot be played as-is. */
  needsTranscode: boolean;
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

export class AudioTranscoder {
  private binaries: BinaryDownloader;
  private server: http.Server | null = null;
  private port = 0;
  /** Live ffmpeg processes, keyed by session token, so each can be replaced. */
  private active = new Map<string, ChildProcessWithoutNullStreams>();
  private sessions = new Map<string, { url: string; audioIndex: number }>();
  private nextToken = 1;

  constructor(binaries: BinaryDownloader) {
    this.binaries = binaries;
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

    return {
      audio,
      videoCodec,
      durationSeconds: Number.isFinite(duration) ? duration : undefined,
      // No audio at all is not a transcoding problem, so it is not claimed as one.
      needsTranscode: Boolean(preferred && !preferred.playable),
    };
  }

  // --- transcoding ---------------------------------------------------------

  /**
   * Opens a remuxing session and returns a loopback URL to play.
   *
   * The URL is stable across seeks: the player points at it once, and each
   * range request restarts ffmpeg from the requested position. Handing back a
   * new URL per seek would reset the element and lose playback state.
   */
  public async createSession(url: string, audioIndex: number): Promise<string | null> {
    if (!this.isAvailable()) return null;
    await this.ensureServer();

    const token = String(this.nextToken++);
    this.sessions.set(token, { url, audioIndex });
    return `http://127.0.0.1:${this.port}/audio/${token}`;
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
    const match = req.url?.match(/^\/audio\/(\d+)/);
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

    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...inputOptionsFor(session.url),
      // Before -i: seeks by keyframe without decoding everything up to it.
      ...(seek > 0 ? ['-ss', String(seek)] : []),
      '-i', session.url,
      '-map', '0:v:0',
      '-map', `0:a:${session.audioIndex}?`,
      // The video is fine — it is only the audio Chromium cannot decode — so
      // copying it keeps this cheap enough to run on a laptop.
      '-c:v', 'copy',
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
