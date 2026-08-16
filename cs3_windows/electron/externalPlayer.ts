import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Hands a stream to a media player that already knows how to play it.
 *
 * Chromium's decoder set is a subset of what people actually stream, and this
 * app has spent real effort closing the gap — an ffmpeg remux for AC-3/DTS
 * audio, and an H.264 re-encode for HEVC. Both work, and both cost something:
 * the video re-encode in particular is a whole CPU's worth of work to watch a
 * file that VLC or MPV would have played untouched.
 *
 * So when the built-in player cannot help or when running high-bitrate 4K HEVC / HDR
 * streams with multi-channel audio (DDP / DTS:X / TrueHD), offer the platform's
 * native media players on Windows, macOS, and Linux.
 *
 * **The URL handed over is the proxied one.** Passing the loopback URL means
 * the headers and authentication are already applied, and every player works
 * smoothly with zero per-player configuration.
 */

export interface ExternalPlayer {
  id: string;
  name: string;
  /** Absolute path to the executable or app bundle, once found. */
  path: string;
}

export interface PlayerDownloadInfo {
  id: string;
  name: string;
  url: string;
  note: string;
}

interface PlayerDefinition {
  id: string;
  name: string;
  platforms: NodeJS.Platform[];
  /** Candidate exact absolute paths or relative paths under search roots. */
  paths?: string[];
  /** Executable names to look for in PATH or directory searches. */
  executables: string[];
  /** Directories under a Program Files or Applications root. */
  directories?: string[];
  /** Extra arguments this player needs, before the URL. */
  args?: string[];
}

const ALL_PLAYERS: PlayerDefinition[] = [
  // --- Cross-Platform & Windows Players ---
  {
    id: 'vlc',
    name: 'VLC Media Player',
    platforms: ['win32', 'darwin', 'linux'],
    executables: ['vlc.exe', 'vlc'],
    directories: ['VideoLAN\\VLC', 'vlc'],
    paths: [
      '/Applications/VLC.app/Contents/MacOS/VLC',
      '/Applications/VLC.app',
      '/usr/bin/vlc',
      '/usr/local/bin/vlc',
      '/var/lib/flatpak/exports/bin/org.videolan.VLC',
    ],
  },
  {
    id: 'mpv',
    name: 'mpv',
    platforms: ['win32', 'darwin', 'linux'],
    executables: ['mpv.exe', 'mpv', 'mpvnet.exe'],
    directories: ['mpv', 'mpv.net'],
    paths: [
      '/opt/homebrew/bin/mpv',
      '/usr/local/bin/mpv',
      '/Applications/mpv.app/Contents/MacOS/mpv',
      '/Applications/mpv.app',
      '/usr/bin/mpv',
      '/var/lib/flatpak/exports/bin/io.mpv.Mpv',
    ],
  },
  {
    id: 'iina',
    name: 'IINA',
    platforms: ['darwin'],
    executables: ['iina-cli', 'iina'],
    paths: [
      '/Applications/IINA.app/Contents/MacOS/IINA',
      '/Applications/IINA.app',
    ],
  },
  {
    id: 'mpc-hc',
    name: 'MPC-HC',
    platforms: ['win32'],
    executables: ['mpc-hc64.exe', 'mpc-hc.exe'],
    directories: ['MPC-HC', 'MPC-HC64'],
  },
  {
    id: 'mpc-be',
    name: 'MPC-BE',
    platforms: ['win32'],
    executables: ['mpc-be64.exe', 'mpc-be.exe'],
    directories: ['MPC-BE', 'MPC-BE64'],
  },
  {
    id: 'potplayer',
    name: 'PotPlayer',
    platforms: ['win32'],
    executables: ['PotPlayerMini64.exe', 'PotPlayerMini.exe'],
    directories: ['DAUM\\PotPlayer', 'PotPlayer'],
  },
  {
    id: 'celluloid',
    name: 'Celluloid',
    platforms: ['linux'],
    executables: ['celluloid', 'gnome-mpv'],
    paths: [
      '/usr/bin/celluloid',
      '/usr/bin/gnome-mpv',
      '/var/lib/flatpak/exports/bin/io.github.celluloid_player.Celluloid',
    ],
  },
  {
    id: 'smplayer',
    name: 'SMPlayer',
    platforms: ['linux', 'win32'],
    executables: ['smplayer.exe', 'smplayer'],
    directories: ['SMPlayer'],
    paths: ['/usr/bin/smplayer'],
  },
];

/** Official download recommendations, platform-filtered. */
export const PLAYER_DOWNLOADS: PlayerDownloadInfo[] = [
  {
    id: 'vlc',
    name: 'VLC Media Player',
    url: 'https://www.videolan.org/vlc/',
    note: 'Universal player supporting 10-bit HEVC, Dolby TrueHD & DTS:X. Windows, macOS & Linux.',
  },
  {
    id: 'mpv',
    name: 'mpv',
    url: 'https://mpv.io/installation/',
    note: 'Ultra-fast, hardware-accelerated minimalist media player for Windows, macOS & Linux.',
  },
  {
    id: 'iina',
    name: 'IINA (macOS)',
    url: 'https://iina.io/',
    note: 'State-of-the-art modern media player built specifically for macOS.',
  },
  {
    id: 'mpc-hc',
    name: 'MPC-HC (Windows)',
    url: 'https://github.com/clsid2/mpc-hc/releases',
    note: 'Lightweight, hardware-accelerated Windows player with madVR / direct render support.',
  },
];

export class ExternalPlayerService {
  private cache: ExternalPlayer[] | null = null;

  /** Resolves executable name in system PATH */
  private findInPath(execName: string): string | null {
    const pathEnv = process.env['PATH'] || '';
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const dirs = pathEnv.split(delimiter);
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

    for (const dir of dirs) {
      if (!dir) continue;
      for (const ext of extensions) {
        const full = path.join(
          dir,
          execName.toLowerCase().endsWith(ext.toLowerCase()) ? execName : `${execName}${ext}`
        );
        try {
          if (fs.existsSync(full) && fs.statSync(full).isFile()) {
            return full;
          }
        } catch {
          // ignore stat errors
        }
      }
    }
    return null;
  }

  /** Roots to search on Windows */
  private searchRootsWin(): string[] {
    const roots = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
      process.env['ProgramW6432'],
      process.env['LOCALAPPDATA'],
      process.env['APPDATA'],
    ];
    return roots.filter((root): root is string => Boolean(root));
  }

  /** Roots to search on macOS */
  private searchRootsMac(): string[] {
    const home = os.homedir();
    return ['/Applications', path.join(home, 'Applications'), '/System/Applications'];
  }

  /** Detects all players present on the current machine across Windows, macOS, and Linux. */
  public list(): ExternalPlayer[] {
    if (this.cache) return this.cache;

    const currentPlatform = process.platform;
    const found: ExternalPlayer[] = [];
    const seenIds = new Set<string>();

    const candidatePlayers = ALL_PLAYERS.filter((p) =>
      p.platforms.includes(currentPlatform)
    );

    for (const player of candidatePlayers) {
      if (seenIds.has(player.id)) continue;

      let detectedPath: string | null = null;

      // 1. Check explicit absolute paths (e.g. macOS /Applications, Linux /usr/bin)
      if (player.paths) {
        for (const candidate of player.paths) {
          const resolved = candidate.startsWith('~')
            ? path.join(os.homedir(), candidate.slice(1))
            : candidate;
          try {
            if (fs.existsSync(resolved)) {
              detectedPath = resolved;
              break;
            }
          } catch {
            // continue
          }
        }
      }

      // 2. Check Windows directories if on win32
      if (!detectedPath && currentPlatform === 'win32' && player.directories) {
        const roots = this.searchRootsWin();
        for (const root of roots) {
          for (const dir of player.directories) {
            for (const exec of player.executables) {
              const candidate = path.join(root, dir, exec);
              try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                  detectedPath = candidate;
                  break;
                }
              } catch {
                // continue
              }
            }
            if (detectedPath) break;
          }
          if (detectedPath) break;
        }
      }

      // 3. Check macOS Application search roots if on darwin
      if (!detectedPath && currentPlatform === 'darwin') {
        const macRoots = this.searchRootsMac();
        for (const root of macRoots) {
          for (const exec of player.executables) {
            const appPath = path.join(root, `${player.name}.app`);
            const execPath = path.join(appPath, 'Contents', 'MacOS', exec);
            try {
              if (fs.existsSync(execPath) && fs.statSync(execPath).isFile()) {
                detectedPath = execPath;
                break;
              }
              if (fs.existsSync(appPath)) {
                detectedPath = appPath;
                break;
              }
            } catch {
              // continue
            }
          }
          if (detectedPath) break;
        }
      }

      // 4. Check System PATH
      if (!detectedPath) {
        for (const exec of player.executables) {
          const inPath = this.findInPath(exec);
          if (inPath) {
            detectedPath = inPath;
            break;
          }
        }
      }

      if (detectedPath) {
        found.push({ id: player.id, name: player.name, path: detectedPath });
        seenIds.add(player.id);
      }
    }

    // Always offer the system's default media player wrapper as a reliable fallback
    found.push({
      id: 'system-default',
      name:
        currentPlatform === 'win32'
          ? 'Windows Default Player'
          : currentPlatform === 'darwin'
          ? 'macOS Default Player (QuickTime/System)'
          : 'Linux Default Media Player',
      path: 'system',
    });

    this.cache = found;
    return found;
  }

  /** Returns download suggestions tailored to the current operating system. */
  public getDownloads(): PlayerDownloadInfo[] {
    const currentPlatform = process.platform;
    if (currentPlatform === 'darwin') {
      return PLAYER_DOWNLOADS.filter((d) => d.id === 'iina' || d.id === 'vlc' || d.id === 'mpv');
    }
    if (currentPlatform === 'linux') {
      return PLAYER_DOWNLOADS.filter((d) => d.id === 'vlc' || d.id === 'mpv');
    }
    return PLAYER_DOWNLOADS.filter((d) => d.id === 'vlc' || d.id === 'mpv' || d.id === 'mpc-hc');
  }

  /** Re-detects players for after the user installs one without needing an app restart. */
  public refresh(): ExternalPlayer[] {
    this.cache = null;
    return this.list();
  }

  /**
   * Launches a player on a stream and returns.
   * Works consistently on Windows, macOS, and Linux.
   */
  public open(playerId: string, url: string): { ok: boolean; error?: string } {
    if (playerId === 'system-default') {
      try {
        let child: ReturnType<typeof spawn>;
        if (process.platform === 'darwin') {
          child = spawn('open', [url], { detached: true, stdio: 'ignore' });
        } else if (process.platform === 'win32') {
          child = spawn('cmd.exe', ['/c', 'start', '', url], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
        }
        child.unref();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    const player = this.list().find((entry) => entry.id === playerId);
    if (!player) return { ok: false, error: `${playerId} is not installed.` };

    const definition = ALL_PLAYERS.find((entry) => entry.id === playerId);
    try {
      let child: ReturnType<typeof spawn>;

      if (process.platform === 'darwin' && player.path.endsWith('.app')) {
        child = spawn('open', ['-a', player.path, url], {
          detached: true,
          stdio: 'ignore',
        });
      } else {
        child = spawn(player.path, [...(definition?.args ?? []), url], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
      }

      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
