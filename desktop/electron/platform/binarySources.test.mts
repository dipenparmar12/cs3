/**
 * Each operating system gets its own helper binaries.
 *
 *   node --experimental-strip-types electron/platform/binarySources.test.mts
 */
import assert from 'node:assert/strict';
import { aria2Mirrors, extraSearchDirs, installHint, ytDlpAsset, ytDlpMirrors } from './binarySources.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('yt-dlp is the standalone build for each platform and architecture', () => {
  assert.equal(ytDlpAsset('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(ytDlpAsset('darwin', 'arm64'), 'yt-dlp_macos');
  assert.equal(ytDlpAsset('darwin', 'x64'), 'yt-dlp_macos');
  assert.equal(ytDlpAsset('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(ytDlpAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');
  assert.equal(ytDlpAsset('freebsd', 'x64'), null);
});

test('no platform is ever handed a Windows executable it cannot run', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']]) {
    assert.ok(ytDlpMirrors(platform, arch).every((m) => !(typeof m === 'string' ? m : m.url).endsWith('.exe')), platform);
    assert.deepEqual(aria2Mirrors(platform), [], platform);
  }
  assert.ok(aria2Mirrors('win32').length > 0);
});

test('a third-party mirror is only listed with the digest that verifies it (SEC-03)', () => {
  for (const mirrors of [ytDlpMirrors('win32', 'x64'), ytDlpMirrors('linux', 'arm64'), aria2Mirrors('win32')]) {
    for (const mirror of mirrors) {
      const url = typeof mirror === 'string' ? mirror : mirror.url;
      if (!/^https:\/\/(github\.com|[a-z.]*githubusercontent\.com)\//.test(url)) {
        assert.ok(typeof mirror !== 'string' && /^[0-9a-f]{64}$/.test(mirror.sha256), url);
      }
    }
  }
});

test('Homebrew and common Linux locations are searched', () => {
  assert.ok(extraSearchDirs('darwin', '/Users/a').includes('/opt/homebrew/bin'));
  assert.ok(extraSearchDirs('linux', '/home/a').includes('/usr/bin'));
  assert.deepEqual(extraSearchDirs('win32', 'C:/Users/a'), []);
});

test('install hints name the right package manager and package', () => {
  assert.match(installHint('aria2c', 'darwin'), /brew install aria2/);
  assert.match(installHint('mpv', 'linux'), /apt install mpv/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
