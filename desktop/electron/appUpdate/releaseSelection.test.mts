import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  parseVersion,
  pickAsset,
  selectUpdate,
  type GithubRelease,
  type Platform,
} from './releaseSelection.ts';

const WIN: Platform = { os: 'win32', arch: 'x64', kind: 'installed' };

function release(tag: string, publishedAt: string, extra: Partial<GithubRelease> = {}): GithubRelease {
  const v = tag.replace(/^v/, '');
  return {
    tag_name: tag,
    published_at: publishedAt,
    html_url: `https://github.com/x/y/releases/tag/${tag}`,
    assets: [
      { name: `CS3-${v}-windows-x64-installer.exe`, size: 90, browser_download_url: `https://dl/${v}/installer.exe` },
      { name: `CS3-${v}-windows-x64-portable.exe`, size: 91, browser_download_url: `https://dl/${v}/portable.exe` },
      { name: `CS3-${v}-macos-arm64.dmg`, size: 80, browser_download_url: `https://dl/${v}/mac.dmg` },
      { name: `CS3-${v}-linux-x64.AppImage`, size: 70, browser_download_url: `https://dl/${v}/app.AppImage` },
      { name: `CS3-${v}-linux-x64.deb`, size: 60, browser_download_url: `https://dl/${v}/app.deb` },
      { name: `CS3-${v}-linux-x64.tar.gz`, size: 50, browser_download_url: `https://dl/${v}/app.tar.gz` },
    ],
    ...extra,
  };
}

const list = [
  release('v1.5.0-beta.20261023.42', '2026-10-23T10:00:00Z', { prerelease: true }),
  release('v1.4.0', '2026-10-20T10:00:00Z'),
  release('v1.3.0', '2026-10-01T10:00:00Z'),
];

test('semver orders releases, betas below their release and by date and run', () => {
  const v = (s: string) => parseVersion(s)!;
  assert.ok(compareVersions(v('1.5.0-beta.20261023.42'), v('1.5.0')) < 0);
  assert.ok(compareVersions(v('1.5.0-beta.20261024.1'), v('1.5.0-beta.20261023.42')) > 0);
  assert.ok(compareVersions(v('1.10.0'), v('1.9.9')) > 0);
  assert.equal(parseVersion('nightly'), null);
});

test('stable sees only plain tags; beta sees the newest of both', () => {
  assert.equal(selectUpdate({ releases: list, current: '1.3.0', channel: 'stable', platform: WIN }).offer?.version, '1.4.0');
  assert.equal(selectUpdate({ releases: list, current: '1.3.0', channel: 'beta', platform: WIN }).offer?.version, '1.5.0-beta.20261023.42');
});

test('an unsigned stable build, flagged prerelease by GitHub, is still stable', () => {
  const unsigned = [release('v1.6.0', '2026-10-25T10:00:00Z', { prerelease: true })];
  assert.equal(selectUpdate({ releases: unsigned, current: '1.4.0', channel: 'stable', platform: WIN }).offer?.version, '1.6.0');
});

test('nothing newer, a draft, a skipped version or a missing file is no offer', () => {
  assert.equal(selectUpdate({ releases: list, current: '1.4.0', channel: 'stable', platform: WIN }).offer, null);
  assert.equal(selectUpdate({ releases: [release('v2.0.0', '2026-11-01T00:00:00Z', { draft: true })], current: '1.4.0', channel: 'stable', platform: WIN }).offer, null);
  assert.equal(selectUpdate({ releases: list, current: '1.3.0', channel: 'stable', platform: WIN, skipped: '1.4.0' }).offer, null);
  const bare = [release('v1.4.0', '2026-10-20T10:00:00Z', { assets: [] })];
  assert.equal(selectUpdate({ releases: bare, current: '1.3.0', channel: 'stable', platform: WIN }).offer, null);
});

test('a release published before the running build is refused, whatever its tag', () => {
  const mistagged = [release('v9.0.0', '2026-01-01T00:00:00Z')];
  const built = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(selectUpdate({ releases: mistagged, current: '1.4.0', currentBuiltAt: built, channel: 'stable', platform: WIN }).offer, null);
});

test('a malformed tag is skipped and reported, the rest still compared', () => {
  const result = selectUpdate({ releases: [release('latest', '2026-10-21T00:00:00Z'), ...list], current: '1.3.0', channel: 'stable', platform: WIN });
  assert.deepEqual(result.ignored, ['latest']);
  assert.equal(result.offer?.version, '1.4.0');
});

test('the file matches the install: Windows installed or portable, macOS, Linux AppImage, deb or tarball', () => {
  const assets = release('v1.4.0', '2026-10-20T10:00:00Z').assets!;
  const name = (p: Platform) => pickAsset(assets, '1.4.0', p)?.name;
  assert.equal(name(WIN), 'CS3-1.4.0-windows-x64-installer.exe');
  assert.equal(name({ os: 'win32', arch: 'x64', kind: 'portable' }), 'CS3-1.4.0-windows-x64-portable.exe');
  assert.equal(name({ os: 'darwin', arch: 'arm64', kind: 'installed' }), 'CS3-1.4.0-macos-arm64.dmg');
  assert.equal(name({ os: 'darwin', arch: 'x64', kind: 'installed' }), undefined, 'not built for macOS x64 in this release');
  assert.equal(name({ os: 'linux', arch: 'x64', kind: 'appimage' }), 'CS3-1.4.0-linux-x64.AppImage');
  assert.equal(name({ os: 'linux', arch: 'x64', kind: 'other', hasDpkg: true }), 'CS3-1.4.0-linux-x64.deb');
  assert.equal(name({ os: 'linux', arch: 'x64', kind: 'other' }), 'CS3-1.4.0-linux-x64.tar.gz');
});
