import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Hands a stream to a media player that already knows how to play it.
 *
 * Chromium's decoder set is a subset of what people actually stream, and this
 * app has spent real effort closing the gap — an ffmpeg remux for AC-3/DTS
 * audio, and an H.264 re-encode for HEVC. Both work, and both cost something:
 * the video re-encode in particular is a whole CPU's worth of work to watch a
 * file that VLC would have played untouched.
 *
 * So when the built-in player cannot help, offer the machine's own. This is not
 * a fallback for our bugs — it is the right answer for a category of file we
 * will never decode natively, and it costs nothing to support.
 *
 * **The URL handed over is the proxied one.** External players have their own,
 * mutually incompatible ways of setting a `Referer` (`--http-referrer` in VLC,
 * `--http-header-fields` in mpv, nothing at all in some), and a provider link
 * without its header is a 403 in any of them. Passing the loopback URL means
 * the headers are already applied by the time the player sees it, and every
 * player works the same way with no per-player knowledge.
 *
 * Nothing is downloaded or installed here. Players are detected, never
 * fetched — silently pulling a third-party installer onto someone's machine is
 * not a thing an app should do, and {@link PLAYER_DOWNLOADS} exists so the user
 * can make that choice themselves in their browser.
 */

export interface ExternalPlayer {
  id: string;
  name: string;
  /** Absolute path to the executable, once found. */
  path: string;
}

interface PlayerDefinition {
  id: string;
  name: string;
  /** Executable names to look for, most preferred first. */
  executables: string[];
  /** Directories under a Program Files root, relative. */
  directories: string[];
  /**
   * Extra arguments this player needs, before the URL.
   *
   * Deliberately sparse. Every player here plays an HTTP URL given as a bare
   * argument, and options beyond that are where per-player behaviour starts to
   * diverge and rot.
   */
  args?: string[];
}

/**
 * Players worth looking for, roughly in order of how well they handle the
 * long tail — VLC and mpv both carry their own ffmpeg and play essentially
 * anything, which is exactly the property that matters here.
 */
const PLAYERS: PlayerDefinition[] = [
  {
    id: 'vlc',
    name: 'VLC',
    executables: ['vlc.exe'],
    directories: ['VideoLAN\\VLC'],
  },
  {
    id: 'mpv',
    name: 'mpv',
    executables: ['mpv.exe'],
    directories: ['mpv', 'mpv.net'],
  },
  {
    id: 'mpc-hc',
    name: 'MPC-HC',
    executables: ['mpc-hc64.exe', 'mpc-hc.exe'],
    directories: ['MPC-HC', 'MPC-HC64'],
  },
  {
    id: 'mpc-be',
    name: 'MPC-BE',
    executables: ['mpc-be64.exe', 'mpc-be.exe'],
    directories: ['MPC-BE', 'MPC-BE64'],
  },
  {
    id: 'potplayer',
    name: 'PotPlayer',
    executables: ['PotPlayerMini64.exe', 'PotPlayerMini.exe'],
    directories: ['DAUM\\PotPlayer', 'PotPlayer'],
  },
];

/** Official download pages, opened in the user's browser on request. */
export const PLAYER_DOWNLOADS: Array<{ id: string; name: string; url: string; note: string }> = [
  {
    id: 'vlc',
    name: 'VLC',
    url: 'https://www.videolan.org/vlc/',
    note: 'Plays essentially any format. The safe default.',
  },
  {
    id: 'mpv',
    name: 'mpv',
    url: 'https://mpv.io/installation/',
    note: 'Minimal and very fast; keyboard-driven.',
  },
  {
    id: 'mpc-hc',
    name: 'MPC-HC',
    url: 'https://github.com/clsid2/mpc-hc/releases',
    note: 'Lightweight, long-established Windows player.',
  },
];

export class ExternalPlayerService {
  /** Detection touches the filesystem; the answer does not change mid-session. */
  private cache: ExternalPlayer[] | null = null;

  /**
   * Roots to search, in the order Windows itself would.
   *
   * `LOCALAPPDATA` matters more than it looks: mpv and several others install
   * per-user by default, and a search that only covered Program Files would
   * report them missing on the machines most likely to have them.
   */
  private searchRoots(): string[] {
    const roots = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      process.env['ProgramW6432'],
      process.env['LOCALAPPDATA'],
      process.env['APPDATA'],
    ];
    return roots.filter((root): root is string => Boolean(root));
  }

  /** Players present on this machine. Empty on non-Windows for now. */
  public list(): ExternalPlayer[] {
    if (this.cache) return this.cache;
    if (process.platform !== 'win32') {
      this.cache = [];
      return this.cache;
    }

    const found: ExternalPlayer[] = [];
    const roots = this.searchRoots();

    for (const player of PLAYERS) {
      const candidates: string[] = [];
      for (const root of roots) {
        for (const directory of player.directories) {
          for (const executable of player.executables) {
            candidates.push(path.join(root, directory, executable));
          }
        }
      }

      const hit = candidates.find((candidate) => {
        try {
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      });

      if (hit) found.push({ id: player.id, name: player.name, path: hit });
    }

    this.cache = found;
    return found;
  }

  /** Re-detects, for after the user has installed one without restarting. */
  public refresh(): ExternalPlayer[] {
    this.cache = null;
    return this.list();
  }

  /**
   * Launches a player on a stream and returns.
   *
   * Detached and with stdio ignored on purpose: the player outlives this app's
   * interest in it, and a child holding pipes open would keep a handle to a
   * process the user may leave running for two hours.
   */
  public open(playerId: string, url: string): { ok: boolean; error?: string } {
    const player = this.list().find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: `${playerId} is not installed.` };

    const definition = PLAYERS.find((entry) => entry.id === playerId);
    try {
      const child = spawn(player.path, [...(definition?.args ?? []), url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
