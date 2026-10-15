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

/**
 * SHA-256 of the pinned artifacts, which is what lets a third-party mirror be
 * used at all (`fastDownloader.usableMirrors`, audit SEC-03). yt-dlp's are the
 * release's own `SHA2-256SUMS`; aria2's was computed from the GitHub release
 * asset on 2026-10-14 (ghproxy.net served identical bytes). A "latest" URL has
 * no digest, so it is fetched only from GitHub itself.
 */
const YTDLP_PINNED_SHA256: Record<string, string> = {
  'yt-dlp': 'a18843c75b04756ed1d8e261b54de8b7ddf918f73134175d5acab745455dcbc8',
  'yt-dlp.exe': 'b9fac42a19e118e1b0a5c98832928a1c25782d805a9905476bb55d479212621a',
  'yt-dlp_linux': 'a3e45133e1960a2ecc3c575b8470ab0d48a52bd92eb1ee3b4b82698fb9a2fc48',
  'yt-dlp_linux_aarch64': '7b804899b2bd3e7c1c8ca0cfb69a51c83151ab6464d27b7def7514d13b882719',
  'yt-dlp_macos': 'fc92f4bc4b5bc4bb0406f47c52b1617e7d4b7e34ef4b6af992e80e338d5cda31',
};
const ARIA2_ZIP = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip';
const ARIA2_ZIP_SHA256 = '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288';

export type BinaryMirror = string | { url: string; sha256: string };

/** yt-dlp's own standalone builds — no Python needed on any of them. */
export function ytDlpAsset(platform: string, arch: string): string | null {
  if (platform === 'win32') return 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos'; // universal: Intel and Apple silicon
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  return null;
}

export function ytDlpMirrors(platform: string, arch: string): BinaryMirror[] {
  const asset = ytDlpAsset(platform, arch);
  if (!asset) return [];
  const sha256 = YTDLP_PINNED_SHA256[asset];
  return [
    // Newest first, from GitHub only: there is no digest to check a mirror's copy against.
    `${YTDLP_RELEASE}/${asset}`,
    { url: `${YTDLP_PINNED}/${asset}`, sha256 },
    { url: `${PROXY}${YTDLP_PINNED}/${asset}`, sha256 },
  ];
}

/**
 * aria2 publishes Windows builds only. Elsewhere it comes from the system
 * package manager — and when it is absent, downloads still work through the
 * built-in HTTP downloader, just without aria2's segmented transfers.
 */
/**
 * The aria2 zip. The bare `aria2c.exe` in the project repository is not a zip
 * and is fetched by its own fallback in `binaryDownloader.setupAria2`; listed
 * here it was downloaded as an archive and failed extraction.
 */
export function aria2Mirrors(platform: string): BinaryMirror[] {
  if (platform !== 'win32') return [];
  return [
    { url: ARIA2_ZIP, sha256: ARIA2_ZIP_SHA256 },
    { url: `${PROXY}${ARIA2_ZIP}`, sha256: ARIA2_ZIP_SHA256 },
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
