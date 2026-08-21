import { spawn, execFile, type ChildProcess } from 'child_process';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type {
  MpvCommandResult,
  MpvEngineStatus,
  MpvOpenRequest,
  MpvSnapshot,
  MpvTrack,
} from '../../src/types/mpv';
import { scopedLogger } from '../logging/logger.ts';

const log = scopedLogger('mpv');

/**
 * The native media engine: mpv, owned and driven by this app.
 *
 * The premise, measured rather than assumed. Chromium decodes H.264, VP8, VP9
 * and AV1 and nothing else; everything past that — HEVC, 10-bit, HDR, VC-1,
 * MPEG-2, AC-3, DTS, TrueHD — reaches the viewer today only by being re-encoded
 * through ffmpeg, and that conversion is where the product loses. A 4K HEVC
 * 10-bit release becomes 1080p 8-bit H.264 with its HDR metadata discarded and
 * its 5.1 flattened to stereo, at 100% of a CPU core, and on a machine with no
 * GPU encoder it does not even keep up with realtime. mpv carries its own
 * FFmpeg and hands the compressed bitstream straight to D3D11VA, NVDEC, Vulkan
 * or VideoToolbox: the same file plays untouched, at full resolution, at a
 * couple of percent of one core.
 *
 * So this is not a fallback for our bugs. It is the path for the category of
 * stream the browser will never decode, and `decisionEngine` routes to it from
 * measured metadata exactly as it routes to the transcoder.
 *
 * **The URL handed to mpv is the proxied one**, for the same reason
 * `externalPlayer` hands over the proxied URL: provider links routinely 403
 * without the `Referer` the extension supplied, and the loopback proxy has
 * applied it already. `http-header-fields` is still passed when headers arrive
 * with the request, because a caller may hold a link the proxy never saw.
 *
 * ## What this owns and what it does not
 *
 * mpv renders into **its own window**, driven entirely over JSON IPC — our React
 * player UI is the remote control, so the timeline, the track menus, resume
 * position and next-episode all keep working. What is *not* implemented is
 * embedding that surface inside the Electron window: that needs libmpv's render
 * API through a native addon (the roadmap's Option B), and shipping a
 * half-working compositing scheme would be worse than a separate surface that
 * behaves predictably. {@link MpvOpenRequest.windowHandle} exists and is passed
 * through as `--wid` for when that lands.
 */

/** How long to keep trying to reach the IPC endpoint mpv creates on startup. */
const IPC_CONNECT_TIMEOUT_MS = 10_000;
const IPC_CONNECT_INTERVAL_MS = 60;
/** A command that has not answered by now is not going to; mpv is wedged. */
const COMMAND_TIMEOUT_MS = 8_000;

/**
 * Properties observed for the lifetime of a session.
 *
 * Observation rather than polling: mpv pushes a `property-change` event when a
 * value moves, so the renderer's timeline is driven by the decoder's own clock
 * instead of a `setInterval` guessing at it. The list is deliberately short —
 * every entry costs a message per change, and `time-pos` alone fires at least
 * once a second for the whole film.
 */
const OBSERVED = [
  'time-pos',
  'duration',
  'pause',
  'volume',
  'mute',
  'speed',
  'eof-reached',
  'idle-active',
  'paused-for-cache',
  'demuxer-cache-time',
  'track-list',
  'aid',
  'sid',
  'video-params',
  'video-codec',
  'audio-codec-name',
  'hwdec-current',
  'estimated-vf-fps',
  'frame-drop-count',
  'media-title',
  'fullscreen',
] as const;

/**
 * Video outputs tried in order, and why there is more than one.
 *
 * `gpu-next` is mpv's current output and the one that does HDR properly, but it
 * is also the one that fails on old drivers and inside remote sessions. A
 * player that refuses to start on a machine with a weak GPU is a worse product
 * than one that starts on the older output, so a failed launch walks down the
 * list rather than reporting "no native engine" to someone who has one.
 */
const VIDEO_OUTPUTS = ['gpu-next', 'gpu', 'direct3d'] as const;

interface Pending {
  resolve: (value: MpvCommandResult) => void;
  timer: NodeJS.Timeout;
}

export interface MpvEngineDeps {
  /** Where to find mpv. Resolved lazily so provisioning can happen after boot. */
  resolveBinary: (name: string) => string | null;
  /** Snapshots are pushed here; `main.ts` forwards them to the renderer. */
  onUpdate: (snapshot: MpvSnapshot) => void;
  diagnostics?: {
    record(entry: {
      level: 'error' | 'warn' | 'info';
      stage: 'playback';
      url?: string;
      source?: string;
      message: string;
      detail?: string;
    }): void;
  };
}

export class MpvEngine {
  private deps: MpvEngineDeps;

  private process: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private buffer = '';
  private nextRequestId = 1;
  private pending = new Map<number, Pending>();

  private sessionId = '';
  private nextSession = 1;
  private currentUrl = '';
  private currentTitle = '';
  /** Which entry of {@link VIDEO_OUTPUTS} the running process was started with. */
  private videoOutput: string = VIDEO_OUTPUTS[0];

  /** Last known value of every observed property, keyed by mpv's own name. */
  private properties = new Map<string, unknown>();
  private state: MpvSnapshot['state'] = 'idle';
  private lastLoggedState: MpvSnapshot['state'] | null = null;
  private lastError: string | null = null;
  private startedAt = 0;

  private cachedVersion: string | null = null;
  private cachedPath: string | null = null;
  private hardwareDecoders: string[] | null = null;

  constructor(deps: MpvEngineDeps) {
    this.deps = deps;
  }

  // --- availability --------------------------------------------------------

  /**
   * Where mpv is, if it is anywhere.
   *
   * Asked again on every call rather than cached as a negative: the point of
   * provisioning mpv on demand is that a machine without it at launch has it ten
   * seconds later, and a remembered "not installed" would make the feature
   * appear only after a restart.
   */
  public resolvePath(): string | null {
    const found = this.deps.resolveBinary('mpv');
    if (found !== this.cachedPath) {
      this.cachedPath = found;
      this.cachedVersion = null;
      this.hardwareDecoders = null;
    }
    return found;
  }

  public isAvailable(): boolean {
    return this.resolvePath() !== null;
  }

  public isRunning(): boolean {
    return this.process !== null;
  }

  public async status(): Promise<MpvEngineStatus> {
    const binary = this.resolvePath();
    if (!binary) {
      return {
        available: false,
        running: false,
        path: null,
        version: null,
        hardwareDecoders: [],
        videoOutput: null,
        sessionId: '',
      };
    }

    if (this.cachedVersion === null) this.cachedVersion = await this.readVersion(binary);

    return {
      available: true,
      running: this.process !== null,
      path: binary,
      version: this.cachedVersion,
      hardwareDecoders: await this.readHardwareDecoders(binary),
      videoOutput: this.process ? this.videoOutput : null,
      sessionId: this.sessionId,
    };
  }

  private readVersion(binary: string): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(binary, ['--version'], { timeout: 8000, windowsHide: true }, (error, stdout) => {
        if (error && !stdout) return resolve(null);
        resolve((stdout || '').split('\n')[0]?.trim() || null);
      });
    });
  }

  /**
   * Which hardware decoders this build can offer.
   *
   * Reported rather than acted on, unlike the *encoder* probe in
   * `mediaTranscoder` which has to test-encode because the listing lies. mpv
   * picks its own decoder at runtime with `auto-safe` and falls back to software
   * by itself, so there is nothing here to get wrong by trusting the list. It
   * exists so a diagnostic can say `d3d11va` rather than "hardware decoding"
   * when someone asks why a file stutters.
   */
  private readHardwareDecoders(binary: string): Promise<string[]> {
    if (this.hardwareDecoders) return Promise.resolve(this.hardwareDecoders);
    return new Promise((resolve) => {
      execFile(binary, ['--hwdec=help'], { timeout: 8000, windowsHide: true }, (_error, stdout) => {
        const names = new Set<string>();
        for (const line of (stdout || '').split('\n')) {
          const match = /^\s{2}([a-z0-9-]+)/.exec(line);
          if (match && match[1] !== 'no' && match[1] !== 'auto') names.add(match[1]);
        }
        this.hardwareDecoders = [...names];
        resolve(this.hardwareDecoders);
      });
    });
  }

  // --- session lifecycle ---------------------------------------------------

  /**
   * Starts playback of one stream, replacing whatever was playing.
   *
   * Reuses the running process when there is one: mpv with `--idle=yes` stays
   * alive between files, so `loadfile` starts the next episode in a few hundred
   * milliseconds where a cold start costs a window creation and a GPU context.
   * Binge-watching is the common case and it is the one that would otherwise
   * have felt slowest.
   */
  public async open(request: MpvOpenRequest): Promise<MpvCommandResult> {
    const binary = this.resolvePath();
    if (!binary) {
      return { ok: false, error: 'The native playback engine (mpv) is not installed.' };
    }
    if (!request.url) return { ok: false, error: 'No stream URL was given to the native engine.' };

    this.currentUrl = request.url;
    this.currentTitle = request.title ?? '';
    this.lastError = null;
    this.state = 'loading';

    if (!this.process) {
      const started = await this.launch(binary, request);
      if (!started.ok) {
        /**
         * The caller gets the error back, but anything reading `mpv:snapshot`
         * would otherwise sit on `loading` forever — a spinner over a process
         * that was never going to start. Same rule as the sidecar's
         * `T4_BLOCKED`: a component that cannot start has to say so.
         */
        this.fail(started.error ?? 'The native engine could not be started.');
        return started;
      }
    }

    this.sessionId = String(this.nextSession++);
    this.properties.clear();
    this.startedAt = Date.now();

    const result = await this.command([
      'loadfile',
      request.url,
      'replace',
      0,
      this.loadfileOptions(request),
    ]);
    if (!result.ok) {
      this.fail(result.error ?? 'The native engine refused the stream.');
      return result;
    }

    this.emit();
    return { ok: true, sessionId: this.sessionId };
  }

  /**
   * Per-file options, applied through `loadfile`'s option map rather than as
   * process arguments.
   *
   * That distinction is what lets one long-lived mpv process serve a whole
   * series: the `Referer` for episode 2 is a different string from episode 1's,
   * and a process argument would have frozen the first one for the life of the
   * instance.
   */
  private loadfileOptions(request: MpvOpenRequest): Record<string, string> {
    const options: Record<string, string> = {};

    const headers = request.headers ?? {};
    const userAgent = headers['User-Agent'] ?? headers['user-agent'];
    if (userAgent) options['user-agent'] = userAgent;

    const fields = Object.entries(headers)
      .filter(([name]) => name.toLowerCase() !== 'user-agent')
      .map(([name, value]) => `${name}: ${value}`);
    if (fields.length > 0) options['http-header-fields'] = fields.join(',');

    if (request.title) options['force-media-title'] = request.title;
    if (request.startSeconds && request.startSeconds > 0) {
      options.start = String(Math.floor(request.startSeconds));
    }
    /**
     * A separately-sourced subtitle file is attached at load, not after.
     *
     * Adding it afterwards works but races the first frames, and a viewer who
     * chose subtitles before pressing play should not watch the opening thirty
     * seconds without them.
     */
    if (request.subtitleUrl) options['sub-file'] = request.subtitleUrl;
    if (typeof request.audioTrackId === 'number' && request.audioTrackId > 0) {
      options.aid = String(request.audioTrackId);
    }

    return options;
  }

  private async launch(binary: string, request: MpvOpenRequest): Promise<MpvCommandResult> {
    let lastError = 'The native engine could not be started.';

    for (const output of VIDEO_OUTPUTS) {
      const attempt = await this.launchWith(binary, request, output);
      if (attempt.ok) {
        this.videoOutput = output;
        return attempt;
      }
      lastError = attempt.error ?? lastError;
      /**
       * Kill before tearing down, or the failed attempt leaks.
       *
       * `teardown` only drops our references. A process that started but never
       * opened its control channel is still running — with a window, holding a
       * GPU context — and walking the video-output list would leave one behind
       * per attempt, three per failed launch, invisible until someone looks at
       * the task list.
       */
      try {
        this.process?.kill();
      } catch {
        /* already gone */
      }
      this.teardown();
    }

    this.deps.diagnostics?.record({
      level: 'error',
      stage: 'playback',
      url: request.url,
      source: 'mpv',
      message: 'The native playback engine could not be started.',
      detail: lastError,
    });
    return { ok: false, error: lastError };
  }

  private async launchWith(
    binary: string,
    request: MpvOpenRequest,
    videoOutput: string
  ): Promise<MpvCommandResult> {
    const ipcPath = this.ipcPath();

    let child: ChildProcess;
    try {
      child = spawn(binary, this.processArgs(ipcPath, videoOutput, request), {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    this.process = child;

    /**
     * mpv's stderr is a diagnosis, not noise.
     *
     * A stream that fails here fails with a line naming the reason — an HTTP
     * status, a missing demuxer, a refused hardware context — and dropping it
     * would leave exactly the bare "it did not play" this engine exists to
     * replace with a fact.
     */
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => this.readStderr(chunk));

    child.on('exit', (code) => {
      const wasPlaying = this.state === 'playing' || this.state === 'paused';
      this.teardown();
      if (wasPlaying) {
        this.state = 'ended';
        this.emit();
      } else if (code !== 0 && code !== null) {
        this.fail(this.lastError ?? `The native engine exited with code ${code}.`);
      }
    });

    child.on('error', (error) => this.fail(error.message));

    if (!(await this.connect(ipcPath))) {
      return {
        ok: false,
        error: this.lastError ?? 'The native engine did not open its control channel.',
      };
    }

    await this.observeProperties();
    return { ok: true };
  }

  private processArgs(ipcPath: string, videoOutput: string, request: MpvOpenRequest): string[] {
    const args = [
      /**
       * Idle rather than exit-on-EOF. The process outlives one file so the next
       * episode starts instantly, and end-of-file becomes an event we report
       * rather than a window vanishing out from under the viewer.
       */
      '--idle=yes',
      `--input-ipc-server=${ipcPath}`,
      /**
       * Not `--no-terminal`, which is the obvious choice and the wrong one.
       *
       * It disables *all* use of stdin/stdout/stderr — measured: an unreachable
       * URL produces literally no output — so `readStderr` becomes dead code and
       * every failure arrives as a bare state change with no reason attached.
       * Terminal *input* is what we actually want gone, since the engine takes
       * its orders over IPC; the error stream is the diagnosis.
       */
      '--input-terminal=no',
      '--msg-level=all=error',
      /**
       * The user's own `mpv.conf` is deliberately not read.
       *
       * Someone who uses mpv has configured it for mpv — key bindings, an OSC,
       * a profile forcing software decoding, `--save-position-on-quit`. Any of
       * those silently changes what this engine does, and the resulting bug
       * would be invisible on every machine except theirs.
       */
      '--no-config',
      /**
       * Enable mpv's built-in On-Screen Controller (OSC) and On-Screen Display (OSD),
       * along with full keyboard and mouse bindings, so the MPV window has its own
       * rich interactive controls (seek bar, play/pause, volume, tracks, shortcuts)
       * without needing to switch windows.
       */
      '--osc=yes',
      '--osd-level=1',
      '--osd-on-seek=msg-bar',
      '--input-default-bindings=yes',
      '--input-vo-keyboard=yes',
      '--input-cursor=yes',
      /**
       * mpv's youtube-dl hook is off: link resolution is this app's job and the
       * extensions have already done it. Left on, every failed load spends
       * several seconds shelling out to a downloader that cannot help — measured
       * on a dead provider link, where the hook added ~8s to a failure that mpv
       * itself had already diagnosed as HTTP 522.
       */
      '--ytdl=no',
      '--load-scripts=yes',
      /** The whole reason for this engine. `auto-safe` falls back on its own. */
      '--hwdec=auto-safe',
      `--vo=${videoOutput}`,
      /**
       * A network stream is not a local file: with no demuxer cache mpv re-reads
       * over HTTP on every seek and stutters on any jitter.
       */
      '--cache=yes',
      '--demuxer-max-bytes=256MiB',
      '--demuxer-readahead-secs=30',
      '--force-seekable=yes',
      /** Nothing is written next to the source; these are other people's URLs. */
      '--sub-auto=no',
      '--audio-file-auto=no',
      '--save-position-on-quit=no',
      '--keep-open=yes',
      `--title=${request.title || 'CloudStream'}`,
    ];

    if (process.platform === 'win32') args.push('--gpu-context=d3d11');

    /**
     * Embedding, for when the native surface can live inside our window.
     *
     * Passed through untouched. mpv fills the given HWND/NSView/X11 window
     * entirely, so the caller owns the geometry — which is why this is a
     * parameter rather than something decided here.
     */
    if (request.windowHandle) args.push(`--wid=${request.windowHandle}`);
    else args.push('--force-window=immediate');

    if (request.fullscreen) args.push('--fullscreen=yes');
    if (typeof request.volume === 'number') args.push(`--volume=${Math.round(request.volume)}`);

    return args;
  }

  private ipcPath(): string {
    const unique = `cs3-mpv-${process.pid}-${Date.now().toString(36)}`;
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\${unique}`
      : path.join(os.tmpdir(), `${unique}.sock`);
  }

  /**
   * Waits for mpv's control channel to exist, then attaches to it.
   *
   * The retry loop is not defensive padding: mpv creates the pipe after it has
   * parsed its arguments and opened its video output, which on a cold GPU
   * context is comfortably longer than the spawn call takes to return. A single
   * connect attempt fails on every machine, every time.
   */
  private async connect(ipcPath: string): Promise<boolean> {
    const deadline = Date.now() + IPC_CONNECT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (!this.process) return false;
      const socket = await this.tryConnect(ipcPath);
      if (socket) {
        this.socket = socket;
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => this.readIpc(chunk));
        socket.on('error', () => undefined);
        socket.on('close', () => {
          this.socket = null;
        });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, IPC_CONNECT_INTERVAL_MS));
    }
    return false;
  }

  private tryConnect(ipcPath: string): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      if (process.platform !== 'win32' && !fs.existsSync(ipcPath)) return resolve(null);
      const socket = net.connect(ipcPath);
      const done = (value: net.Socket | null) => {
        socket.removeAllListeners('connect');
        socket.removeAllListeners('error');
        if (!value) socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => done(socket));
      socket.once('error', () => done(null));
    });
  }

  private async observeProperties(): Promise<void> {
    await Promise.all(
      OBSERVED.map((name, index) => this.command(['observe_property', index + 1, name]))
    );
  }

  // --- IPC -----------------------------------------------------------------

  /**
   * Sends one command and waits for the reply carrying its id.
   *
   * mpv answers out of order — a `loadfile` for a slow URL is still open while a
   * `set_property` for the volume comes back — so replies are correlated by
   * `request_id` rather than by arrival. Anything else silently attributes one
   * command's failure to another command.
   */
  private command(command: unknown[]): Promise<MpvCommandResult> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      return Promise.resolve({ ok: false, error: 'The native engine is not running.' });
    }

    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: 'The native engine did not answer.' });
      }, COMMAND_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, timer });

      try {
        socket.write(`${JSON.stringify({ command, request_id: requestId })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  private readIpc(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleFrame(line);
      index = this.buffer.indexOf('\n');
    }
    /**
     * A partial line that never completes would grow without bound. mpv does not
     * write anything enormous, but an unbounded buffer fed by a child process is
     * the kind of thing that only fails nine hours into a session.
     */
    if (this.buffer.length > 1_000_000) this.buffer = '';
  }

  private handleFrame(line: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof frame.request_id === 'number') {
      const pending = this.pending.get(frame.request_id);
      if (pending) {
        this.pending.delete(frame.request_id);
        clearTimeout(pending.timer);
        const error = typeof frame.error === 'string' ? frame.error : 'success';
        pending.resolve(
          error === 'success'
            ? { ok: true, data: frame.data, sessionId: this.sessionId }
            : { ok: false, error }
        );
      }
      return;
    }

    if (typeof frame.event === 'string') this.handleEvent(frame);
  }

  private handleEvent(frame: Record<string, unknown>): void {
    switch (frame.event) {
      case 'property-change': {
        if (typeof frame.name === 'string') this.properties.set(frame.name, frame.data);
        this.deriveState();
        this.emit();
        break;
      }
      case 'start-file': {
        this.state = 'loading';
        this.emit();
        break;
      }
      case 'file-loaded':
      case 'playback-restart': {
        if (this.state !== 'error') this.state = 'playing';
        this.emit();
        break;
      }
      case 'end-file': {
        /**
         * `end-file` carries the reason, and the two that matter look nothing
         * alike to a viewer: `eof` is the credits, `error` is a dead link. Both
         * used to arrive as "playback stopped".
         */
        const reason = typeof frame.reason === 'string' ? frame.reason : 'eof';
        if (reason === 'error') {
          const detail =
            typeof frame.file_error === 'string'
              ? frame.file_error
              : this.lastError ?? 'the stream could not be read';
          this.fail(`The native engine could not play this source: ${detail}.`);
        } else if (reason === 'eof') {
          this.state = 'ended';
          this.emit();
        }
        break;
      }
      default:
        break;
    }
  }

  private readStderr(chunk: string): void {
    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      /**
       * Only failures are kept. mpv is chatty at its default level, and
       * recording every line would bury the one saying why nothing played under
       * a hundred saying what did.
       */
      if (/error|fatal|Failed to |Could not open|HTTP error/i.test(line)) {
        this.lastError = line;
        this.deps.diagnostics?.record({
          level: 'error',
          stage: 'playback',
          url: this.currentUrl,
          source: 'mpv',
          message: line,
        });
      }
    }
  }

  // --- state ---------------------------------------------------------------

  private deriveState(): void {
    if (this.state === 'error') return;

    if (this.properties.get('eof-reached') === true) {
      const pos = this.numberProperty('time-pos');
      const dur = this.numberProperty('duration');
      if (pos > 0 && dur > 0 && pos >= dur - 2) {
        this.state = 'ended';
        return;
      }
    }
    /**
     * Buffering is `paused-for-cache`, not `core-idle`.
     *
     * `core-idle` is also true while the viewer has it paused, so reading that
     * as buffering would put a spinner over every deliberate pause.
     */
    if (this.properties.get('paused-for-cache') === true) {
      this.state = 'buffering';
      return;
    }
    if (this.properties.get('idle-active') === true) {
      this.state = 'idle';
      return;
    }
    /**
     * A file that has not produced a timestamp yet is still loading. Without
     * this the first `pause` observation — which arrives before any frame — would
     * report "playing" over a black window.
     */
    if (this.state === 'loading' && typeof this.properties.get('time-pos') !== 'number') return;

    this.state = this.properties.get('pause') === true ? 'paused' : 'playing';
  }

  private numberProperty(name: string): number {
    const value = this.properties.get(name);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private tracks(): { audio: MpvTrack[]; subtitles: MpvTrack[] } {
    const raw = this.properties.get('track-list');
    const audio: MpvTrack[] = [];
    const subtitles: MpvTrack[] = [];
    if (!Array.isArray(raw)) return { audio, subtitles };

    for (const entry of raw as Array<Record<string, unknown>>) {
      const track: MpvTrack = {
        id: typeof entry.id === 'number' ? entry.id : 0,
        type: String(entry.type ?? ''),
        title: typeof entry.title === 'string' ? entry.title : undefined,
        language: typeof entry.lang === 'string' ? entry.lang : undefined,
        codec: typeof entry.codec === 'string' ? entry.codec : undefined,
        channels:
          typeof entry['demux-channel-count'] === 'number'
            ? (entry['demux-channel-count'] as number)
            : undefined,
        isDefault: entry.default === true,
        isForced: entry.forced === true,
        selected: entry.selected === true,
        /**
         * Tracks the container carries, versus ones we attached. A viewer who
         * loaded a subtitle file needs to see it listed as theirs rather than as
         * something the release shipped with.
         */
        external: entry.external === true,
      };
      if (track.type === 'audio') audio.push(track);
      else if (track.type === 'sub') subtitles.push(track);
    }
    return { audio, subtitles };
  }

  public snapshot(): MpvSnapshot {
    const { audio, subtitles } = this.tracks();
    const params = this.properties.get('video-params') as Record<string, unknown> | undefined;

    const position = this.numberProperty('time-pos');
    const cacheTime = this.numberProperty('demuxer-cache-time');

    return {
      sessionId: this.sessionId,
      state: this.state,
      url: this.currentUrl,
      title: (this.properties.get('media-title') as string | undefined) || this.currentTitle || '',
      positionSeconds: position,
      durationSeconds: this.numberProperty('duration'),
      /** Absolute, like `<video>`'s buffered ranges — not a delta from `time-pos`. */
      bufferedSeconds: cacheTime > 0 ? cacheTime : position,
      paused: this.properties.get('pause') === true,
      volume: this.numberProperty('volume'),
      muted: this.properties.get('mute') === true,
      speed: this.numberProperty('speed') || 1,
      fullscreen: this.properties.get('fullscreen') === true,

      width: typeof params?.w === 'number' ? (params.w as number) : 0,
      height: typeof params?.h === 'number' ? (params.h as number) : 0,
      /**
       * `hw-pixelformat` first, and that ordering is load-bearing.
       *
       * Once a hardware decoder is running, `video-params/pixelformat` reports
       * the *surface* type — `d3d11`, `cuda`, `vaapi` — and the real format
       * moves to `hw-pixelformat`. Reading only the first one makes every
       * hardware-decoded file look like it has no bit depth, which is exactly
       * the fact this field exists to carry: a `yuv420p10` here is why the
       * stream was routed to this engine in the first place.
       */
      pixelFormat:
        typeof params?.['hw-pixelformat'] === 'string'
          ? (params['hw-pixelformat'] as string)
          : typeof params?.pixelformat === 'string'
            ? (params.pixelformat as string)
            : undefined,
      colorTransfer: typeof params?.gamma === 'string' ? (params.gamma as string) : undefined,
      videoCodec: (this.properties.get('video-codec') as string | undefined) ?? '',
      audioCodec: (this.properties.get('audio-codec-name') as string | undefined) ?? '',
      /**
       * What mpv *actually* used, which is the number worth reporting.
       * `auto-safe` falls back to software silently, and "hardware decoding is
       * on" in a settings screen is not the same claim as `d3d11va` in a
       * diagnostic taken while a file stutters.
       */
      hardwareDecoder: (this.properties.get('hwdec-current') as string | undefined) ?? 'no',
      frameRate: this.numberProperty('estimated-vf-fps'),
      droppedFrames: this.numberProperty('frame-drop-count'),

      audioTracks: audio,
      subtitleTracks: subtitles,
      selectedAudioId:
        typeof this.properties.get('aid') === 'number'
          ? (this.properties.get('aid') as number)
          : null,
      selectedSubtitleId:
        typeof this.properties.get('sid') === 'number'
          ? (this.properties.get('sid') as number)
          : null,

      error: this.state === 'error' ? this.lastError : null,
      startupLatencyMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();

    /**
     * State transitions are logged here and nowhere else.
     *
     * `deriveState` assigns `this.state` from six different branches, and
     * instrumenting each would be six chances to add a seventh without one.
     * Every one of them ends up here, so a transition is recorded exactly once
     * and the sequence in the log is the sequence that actually happened —
     * which is the whole point of recording a state machine.
     *
     * Only *changes* are recorded. `time-pos` alone fires about once a second
     * for the length of a film, and logging an unchanged `playing` each time
     * would bury the transitions that matter under two thousand that do not.
     */
    if (snapshot.state !== this.lastLoggedState) {
      const previous = this.lastLoggedState;
      this.lastLoggedState = snapshot.state;
      log.write(snapshot.state === 'error' ? 'warn' : 'info', 'state_changed', {
        playbackState: snapshot.state,
        from: previous,
        url: this.currentUrl,
        mediaTitle: this.currentTitle,
        positionSeconds: Math.round(snapshot.positionSeconds),
        durationSeconds: Math.round(snapshot.durationSeconds),
        videoCodec: snapshot.videoCodec,
        audioCodec: snapshot.audioCodec,
        // The decoder actually chosen, not the setting: `auto-safe` falls back
        // to software silently, and that is the first thing worth knowing when
        // someone reports a 4K file stuttering.
        hardwareDecoder: snapshot.hardwareDecoder,
        error: snapshot.error ?? undefined,
      });
    }

    try {
      this.deps.onUpdate(snapshot);
    } catch {
      /* a renderer that has gone away must not stop the engine */
    }
  }

  private fail(message: string): void {
    log.error('engine_failed', {
      error: message,
      url: this.currentUrl,
      mediaTitle: this.currentTitle,
      playbackState: this.state,
    });
    this.lastError = message;
    this.state = 'error';
    this.emit();
  }

  // --- controls ------------------------------------------------------------

  public setPaused(paused: boolean): Promise<MpvCommandResult> {
    return this.command(['set_property', 'pause', paused]);
  }

  public seek(seconds: number): Promise<MpvCommandResult> {
    return this.command(['seek', Math.max(0, seconds), 'absolute']);
  }

  public setVolume(volume: number): Promise<MpvCommandResult> {
    return this.command(['set_property', 'volume', Math.max(0, Math.min(130, volume))]);
  }

  public setMuted(muted: boolean): Promise<MpvCommandResult> {
    return this.command(['set_property', 'mute', muted]);
  }

  public setSpeed(speed: number): Promise<MpvCommandResult> {
    return this.command(['set_property', 'speed', Math.max(0.25, Math.min(4, speed))]);
  }

  public setFullscreen(fullscreen: boolean): Promise<MpvCommandResult> {
    return this.command(['set_property', 'fullscreen', fullscreen]);
  }

  /** `null` selects no track, which is how subtitles are turned off. */
  public setAudioTrack(id: number | null): Promise<MpvCommandResult> {
    return this.command(['set_property', 'aid', id === null ? 'no' : id]);
  }

  public setSubtitleTrack(id: number | null): Promise<MpvCommandResult> {
    return this.command(['set_property', 'sid', id === null ? 'no' : id]);
  }

  /**
   * Attaches a subtitle file mid-playback and selects it.
   *
   * `select` rather than `cached` for the flags argument: the latter adds it to
   * the list without selecting it, which reads as a subtitle track that does
   * nothing when clicked.
   */
  public addSubtitle(url: string, title?: string, language?: string): Promise<MpvCommandResult> {
    return this.command(['sub-add', url, 'select', title ?? 'Subtitles', language ?? '']);
  }

  public setSubtitleDelay(seconds: number): Promise<MpvCommandResult> {
    return this.command(['set_property', 'sub-delay', seconds]);
  }

  /**
   * Stops playback without killing the process.
   *
   * The instance is kept idle on purpose — see {@link open}. `stop` returns it
   * to the idle state, where the next `loadfile` costs a few hundred
   * milliseconds rather than a full start.
   */
  public async stop(): Promise<MpvCommandResult> {
    if (!this.process) return { ok: true };
    const result = await this.command(['stop']);
    this.state = 'idle';
    this.emit();
    return result;
  }

  /** Ends the process. Wired into `before-quit`; otherwise mpv outlives the app. */
  public async shutdown(): Promise<void> {
    if (!this.process) return;
    const child = this.process;
    try {
      await this.command(['quit']);
    } catch {
      /* the process is going away regardless */
    }
    this.teardown();
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill();
      } catch {
        /* already gone */
      }
    }, 1500);
  }

  private teardown(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'The native engine stopped.' });
    }
    this.pending.clear();

    try {
      this.socket?.destroy();
    } catch {
      /* best effort */
    }
    this.socket = null;
    this.process = null;
    this.buffer = '';
    this.properties.clear();
  }
}
