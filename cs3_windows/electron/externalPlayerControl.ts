import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import type { ExternalPlaybackSnapshot, ExternalControlCapability } from '../src/types/player';

/**
 * Two-way control of a player that is not ours.
 *
 * The requirement is that our transport controls keep working when playback is
 * delegated outside the app — and, where the player allows it, that the two
 * stay in step: our timeline follows theirs, our pause pauses theirs.
 *
 * **What is actually possible is not uniform, and pretending otherwise is the
 * failure mode this file exists to avoid.** A seek bar that does nothing is
 * worse than no seek bar, because the viewer drags it, watches nothing happen,
 * and concludes the app is broken. So capability is declared per player and the
 * UI is told which it got:
 *
 * | Player            | Channel                       | Capability |
 * |-------------------|-------------------------------|------------|
 * | mpv, mpv.net      | JSON IPC over a named pipe    | `full`     |
 * | VLC               | Its built-in HTTP interface   | `full`     |
 * | MPC-HC / MPC-BE   | Web UI, **off by default**    | `none`     |
 * | PotPlayer         | none                          | `none`     |
 * | IINA, Celluloid…  | none worth relying on         | `none`     |
 *
 * MPC's web interface deserves the note: it *has* one, at `/variables.html`,
 * but it is disabled unless the user has turned it on in MPC's own options and
 * there is no command line switch that enables it for one launch. Claiming
 * `full` and then failing on every request would be exactly the broken seek bar
 * above, so it is declared `none` until someone points us at a version that can
 * be enabled from outside.
 *
 * mpv is not handled here at all: `MpvEngine` already speaks its IPC properly,
 * including track lists and property observation, and a second, worse client
 * for the same protocol would be a maintenance trap. `ExternalPlayerService`
 * routes mpv through that engine instead.
 */

/** Polling cadence for VLC. Fast enough to feel live, slow enough to be free. */
const POLL_INTERVAL_MS = 700;
/** VLC needs a moment to bind its HTTP port; before that every request refuses. */
const CONNECT_TIMEOUT_MS = 12_000;

export function controlCapabilityFor(playerId: string): ExternalControlCapability {
  if (playerId === 'mpv') return 'full';
  if (playerId === 'vlc') return 'full';
  return 'none';
}

/** A free loopback port, asked of the OS rather than guessed. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function randomPassword(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/** VLC's status.xml is small and regular; a parser dependency would be overkill. */
function readTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match ? match[1] : null;
}

export interface ExternalControlDeps {
  onUpdate: (snapshot: ExternalPlaybackSnapshot) => void;
}

/**
 * Drives VLC through the HTTP interface it ships with.
 *
 * Enabled per launch with `--extraintf http`, on a port the OS picked and behind
 * a password generated for this session — VLC's HTTP interface is unauthenticated
 * by default and binding it without one would expose playback control to
 * anything else on the machine. Bound to loopback for the same reason.
 */
export class VlcController {
  private process: ChildProcess | null = null;
  private port = 0;
  private password = '';
  private timer: NodeJS.Timeout | null = null;
  private deps: ExternalControlDeps;
  private snapshot: ExternalPlaybackSnapshot;
  private startedAt = 0;

  constructor(deps: ExternalControlDeps) {
    this.deps = deps;
    this.snapshot = VlcController.emptySnapshot();
  }

  private static emptySnapshot(): ExternalPlaybackSnapshot {
    return {
      playerId: 'vlc',
      capability: 'full',
      state: 'idle',
      positionSeconds: 0,
      durationSeconds: 0,
      paused: false,
      volume: 100,
      muted: false,
      error: null,
    };
  }

  public isRunning(): boolean {
    return this.process !== null;
  }

  public current(): ExternalPlaybackSnapshot {
    return this.snapshot;
  }

  public async start(
    executable: string,
    url: string,
    extraArgs: string[] = []
  ): Promise<{ ok: boolean; error?: string }> {
    await this.stop();

    this.port = await freePort();
    this.password = randomPassword();
    this.snapshot = { ...VlcController.emptySnapshot(), state: 'loading' };
    this.startedAt = Date.now();

    const args = [
      ...extraArgs,
      '--extraintf',
      'http',
      '--http-host',
      '127.0.0.1',
      `--http-port=${this.port}`,
      `--http-password=${this.password}`,
      /**
       * Without this VLC pops its first-run privacy dialog and never reaches
       * the file, which reads to the viewer as "the external player did
       * nothing at all".
       */
      '--no-qt-privacy-ask',
      '--no-qt-updates-notif',
      url,
    ];

    try {
      this.process = spawn(executable, args, { detached: false, stdio: 'ignore' });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    this.process.on('exit', () => {
      /**
       * The viewer closed VLC. That is the end of playback, and the app has to
       * say so — a player window that is gone while our controls still show a
       * running timeline is the same lie in the other direction.
       */
      this.process = null;
      this.stopPolling();
      this.snapshot = { ...this.snapshot, state: 'closed', paused: true };
      this.deps.onUpdate(this.snapshot);
    });

    this.startPolling();
    return { ok: true };
  }

  private startPolling(): void {
    this.stopPolling();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async request(query: string): Promise<string | null> {
    if (!this.port) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/requests/status.xml${query}`, {
        headers: {
          // VLC's HTTP interface uses Basic auth with an empty username.
          Authorization: `Basic ${Buffer.from(`:${this.password}`).toString('base64')}`,
        },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  }

  private async poll(): Promise<void> {
    const xml = await this.request('');
    if (!xml) {
      /**
       * A failed poll during startup is VLC still binding its port, not a
       * failure. After the grace period it means the interface never came up —
       * usually a VLC build without the HTTP module — and the honest answer is
       * to drop to `none` so the UI stops offering controls that cannot work.
       */
      if (this.process && Date.now() - this.startedAt > CONNECT_TIMEOUT_MS) {
        this.snapshot = {
          ...this.snapshot,
          capability: 'none',
          state: 'playing',
          error:
            'VLC is playing, but its remote-control interface did not start, so the ' +
            'controls here cannot reach it.',
        };
        this.deps.onUpdate(this.snapshot);
        this.stopPolling();
      }
      return;
    }

    const state = readTag(xml, 'state') ?? 'stopped';
    const time = Number(readTag(xml, 'time') ?? 0);
    const length = Number(readTag(xml, 'length') ?? 0);
    const volume = Number(readTag(xml, 'volume') ?? 256);

    this.snapshot = {
      playerId: 'vlc',
      capability: 'full',
      // VLC reports `playing` | `paused` | `stopped`.
      state: state === 'stopped' ? 'ended' : state === 'paused' ? 'paused' : 'playing',
      positionSeconds: Number.isFinite(time) ? time : 0,
      durationSeconds: Number.isFinite(length) ? length : 0,
      paused: state === 'paused',
      /**
       * VLC's scale is 0–256 for 0–100% and it reports **up to 512** when the
       * user amplifies past unity — which `setVolume` below cannot even ask
       * for, but VLC's own interface and keyboard can.
       *
       * Reported unclamped, that 200% arrived in the renderer, was divided by
       * 100 into a 0–1 volume of `2.0`, and was assigned to
       * `HTMLMediaElement.volume`, which throws `IndexSizeError` outside [0,1]
       * and took the player down. Every snapshot consumer here assumes a
       * percentage of unity, so the boost is reported as the ceiling rather
       * than as a number nothing downstream can hold.
       */
      volume: Number.isFinite(volume) ? Math.min(100, Math.round((volume / 256) * 100)) : 100,
      muted: volume === 0,
      error: null,
    };
    this.deps.onUpdate(this.snapshot);
  }

  // --- commands ------------------------------------------------------------

  public async setPaused(paused: boolean): Promise<boolean> {
    // `pl_pause` toggles, so it is only correct when the current state disagrees.
    if (this.snapshot.paused === paused) return true;
    return (await this.request('?command=pl_pause')) !== null;
  }

  public async seek(seconds: number): Promise<boolean> {
    return (await this.request(`?command=seek&val=${Math.max(0, Math.floor(seconds))}`)) !== null;
  }

  public async setVolume(percent: number): Promise<boolean> {
    const scaled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 256);
    return (await this.request(`?command=volume&val=${scaled}`)) !== null;
  }

  public async setMuted(muted: boolean): Promise<boolean> {
    // VLC has no mute command over HTTP; volume 0 is the same thing to the
    // viewer, and the previous level is restored by the caller's own state.
    return this.setVolume(muted ? 0 : this.snapshot.volume || 100);
  }

  public async setSpeed(rate: number): Promise<boolean> {
    return (await this.request(`?command=rate&val=${Math.max(0.25, Math.min(4, rate))}`)) !== null;
  }

  public async setFullscreen(): Promise<boolean> {
    return (await this.request('?command=fullscreen')) !== null;
  }

  public async stop(): Promise<void> {
    this.stopPolling();
    if (!this.process) return;
    await this.request('?command=pl_stop');
    const child = this.process;
    this.process = null;
    setTimeout(() => {
      try {
        if (child.exitCode === null) child.kill();
      } catch {
        /* already gone */
      }
    }, 800);
  }
}
