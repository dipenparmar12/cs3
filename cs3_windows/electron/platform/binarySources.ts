/**
 * Where each helper binary comes from on each operating system, and where a
 * system-installed copy may live.
 *
 * The downloader was written for Windows and fetched `yt-dlp.exe` and a Windows
 * aria2 zip everywhere: on macOS and Linux that wrote a Windows executable
 * under the Unix name, never marked it executable, and reported the tool as
 * "installed" until the first download failed. Pure, so the table is tested
 * rather than discovered on a user's machine.
 *
 * Platform and architecture are Node's spellings (`win32`, `darwin`, `linux`;
 * `x64`, `arm64`).
 */

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const YTDLP_PINNED = 'https://github.com/yt-dlp/yt-dlp/releases/download/2025.02.19';
const PROXY = 'https://ghproxy.net/';

/** yt-dlp's own standalone builds — no Python needed on any of them. */
export function ytDlpAsset(platform: string, arch: string): string | null {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos'; // universal: Intel and Apple silicon
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return null;
}

export function ytDlpMirrors(platform: string, arch: string): string[] {
  const asset = ytDlpAsset(platform, arch);
  if (!asset) return [];
  return [
    `${YTDLP_RELEASE}/${asset}`,
    `${PROXY}${YTDLP_RELEASE}/${asset}`,
    `${YTDLP_PINNED}/${asset}`,
  ];
}

/**
 * aria2 publishes Windows builds only. Elsewhere it comes from the system
 * package manager — and when it is absent, downloads still work through the
 * built-in HTTP downloader, just without aria2's segmented transfers.
 */
export function aria2Mirrors(platform: string): string[] {
  if (platform !== 'win32') return [];
  return [
    'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
    `${PROXY}https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip`,
    'https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe',
  ];
}

/** What to tell someone whose platform installs this through its package manager. */
export function installHint(tool: 'mpv' | 'ffmpeg' | 'aria2c', platform: string): string {
  const pkg = tool === 'aria2c' ? 'aria2' : tool;
  if (platform === 'darwin') return `Install ${pkg} with Homebrew (\`brew install ${pkg}\`), then reopen this panel.`;
  return `Install ${pkg} with your package manager (for example \`sudo apt install ${pkg}\`), then reopen this panel.`;
}

/**
 * Directories a system-installed tool may be in that a GUI app's PATH lacks.
 *
 * An app started from Finder or a desktop launcher does not inherit the shell's
 * PATH: on macOS that is `/usr/bin:/bin:/usr/sbin:/sbin`, which misses every
 * Homebrew install — so `brew install mpv` looked like it had done nothing.
 */
export function extraSearchDirs(platform: string, home: string): string[] {
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', `${home}/.local/bin`];
  }
  if (platform === 'linux') {
    return ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', `${home}/.local/bin`, '/var/lib/flatpak/exports/bin'];
  }
  return [];
}
