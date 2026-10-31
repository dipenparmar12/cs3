/**
 * Which GitHub release to offer, and which of its files (App Update PRD §4–6).
 *
 * The channel is read from the **tag**, not GitHub's prerelease flag: an
 * unsigned stable build is published as a prerelease too (`release.yml`), so
 * the flag cannot mean "beta". `v1.4.0` is stable; `v1.5.0-beta.20261023.42`
 * is beta. Versions compare by semver; equal versions are decided by
 * publication date, and a release published before the running build was is
 * never offered however its tag reads (a mis-tagged old build). Pure.
 */

export type UpdateChannel = 'stable' | 'beta';

export interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string;
  assets?: GithubAsset[];
}

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers (`beta.20261023.42`), empty for a release. */
  pre: string[];
}

export function parseVersion(tag: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  };
}

/** Semver precedence: negative when `a` is older. */
export function compareVersions(a: Semver, b: Semver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.pre.length === 0 || b.pre.length === 0) return (a.pre.length === 0 ? 1 : 0) - (b.pre.length === 0 ? 1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== null) return -1;
    else if (ny !== null) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function channelOf(version: Semver): UpdateChannel {
  return version.pre.length > 0 ? 'beta' : 'stable';
}

export interface Platform {
  os: NodeJS.Platform;
  arch: string;
  /** How this copy runs, which decides the file to offer. */
  kind: 'installed' | 'portable' | 'appimage' | 'other';
  /** Linux: whether `dpkg` exists, so a `.deb` can be installed. */
  hasDpkg?: boolean;
}

const OS_LABEL: Partial<Record<NodeJS.Platform, string>> = { win32: 'windows', darwin: 'macos', linux: 'linux' };

/**
 * The file for this machine, by the names `tools/package/package-layout.mjs`
 * pins, best first. `null` when the release was not built for this system.
 */
export function pickAsset(assets: GithubAsset[], version: string, platform: Platform): GithubAsset | null {
  const label = OS_LABEL[platform.os];
  if (!label) return null;
  const base = `CS3-${version}-${label}-${platform.arch}`;
  const wanted =
    platform.os === 'win32'
      ? platform.kind === 'portable'
        ? [`${base}-portable.exe`, `${base}-portable.zip`]
        : [`${base}-installer.exe`, `${base}-portable.zip`]
      : platform.os === 'darwin'
        ? [`${base}.dmg`, `${base}.zip`]
        : platform.kind === 'appimage'
          ? [`${base}.AppImage`, `${base}.tar.gz`]
          : platform.hasDpkg
            ? [`${base}.deb`, `${base}.tar.gz`]
            : [`${base}.tar.gz`, `${base}.AppImage`];
  for (const name of wanted) {
    const asset = assets.find((a) => a.name === name);
    if (asset) return asset;
  }
  return null;
}

export interface UpdateOffer {
  version: string;
  channel: UpdateChannel;
  publishedAt: number;
  title: string;
  notes: string;
  pageUrl: string;
  asset: { name: string; size: number; url: string };
}

export interface SelectionInput {
  releases: GithubRelease[];
  current: string;
  /** When the running build was made (ms), if known; older releases are refused. */
  currentBuiltAt?: number;
  channel: UpdateChannel;
  platform: Platform;
  skipped?: string;
}

export interface Selection {
  offer: UpdateOffer | null;
  /** Tags that did not parse, for the log. */
  ignored: string[];
}

export function selectUpdate(input: SelectionInput): Selection {
  const current = parseVersion(input.current);
  const ignored: string[] = [];
  let best: { version: Semver; release: GithubRelease; asset: GithubAsset; publishedAt: number } | null = null;

  for (const release of input.releases) {
    if (release.draft) continue;
    const version = parseVersion(release.tag_name ?? '');
    if (!version) {
      ignored.push(release.tag_name ?? '(no tag)');
      continue;
    }
    if (input.channel === 'stable' && channelOf(version) === 'beta') continue;
    const publishedAt = Date.parse(release.published_at ?? '') || 0;
    if (input.currentBuiltAt && publishedAt && publishedAt < input.currentBuiltAt) continue;
    if (current && compareVersions(version, current) <= 0) continue;
    const plain = release.tag_name.replace(/^v/, '');
    if (input.skipped && input.skipped.replace(/^v/, '') === plain) continue;
    const asset = pickAsset(release.assets ?? [], plain, input.platform);
    if (!asset) continue;
    const order = best ? compareVersions(version, best.version) : 1;
    if (!best || order > 0 || (order === 0 && publishedAt > best.publishedAt)) {
      best = { version, release, asset, publishedAt };
    }
  }

  if (!best) return { offer: null, ignored };
  const version = best.release.tag_name.replace(/^v/, '');
  return {
    ignored,
    offer: {
      version,
      channel: channelOf(best.version),
      publishedAt: best.publishedAt,
      title: best.release.name?.trim() || `CloudStream 3 Desktop ${version}`,
      notes: (best.release.body ?? '').trim(),
      pageUrl: best.release.html_url ?? '',
      asset: { name: best.asset.name, size: best.asset.size, url: best.asset.browser_download_url },
    },
  };
}

/**
 * `SHA256SUMS.txt` as `release.yml` writes it (`sha256sum CS3-*`): one
 * `<64 hex>  <name>` per line, `*` before the name in binary mode. Anything
 * else is ignored rather than guessed at.
 */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (match) sums.set(match[2], match[1].toLowerCase());
  }
  return sums;
}

/** The checksum file of the release that carries `version`, if it published one. */
export function checksumsAsset(releases: GithubRelease[], version: string): GithubAsset | null {
  const release = releases.find((r) => r.tag_name.replace(/^v/, '') === version);
  return release?.assets?.find((a) => a.name === 'SHA256SUMS.txt') ?? null;
}
