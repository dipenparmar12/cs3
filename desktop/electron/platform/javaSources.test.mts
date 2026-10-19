/**
 * Each operating system downloads its own Java runtime, and finds it once unpacked.
 *
 *   node --experimental-strip-types electron/platform/javaSources.test.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locateJavaHome, portableJavaSource } from './javaSources.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const TARGETS: Array<[string, string, RegExp]> = [
  ['win32', 'x64', /jre_x64_windows_hotspot.*\.zip$/],
  ['darwin', 'x64', /jre_x64_mac_hotspot.*\.tar\.gz$/],
  ['darwin', 'arm64', /jre_aarch64_mac_hotspot.*\.tar\.gz$/],
  ['linux', 'x64', /jre_x64_linux_hotspot.*\.tar\.gz$/],
  ['linux', 'arm64', /jre_aarch64_linux_hotspot.*\.tar\.gz$/],
];

test('every release target downloads a runtime built for it', () => {
  for (const [platform, arch, asset] of TARGETS) {
    const source = portableJavaSource(platform, arch);
    assert.ok(source, `${platform}-${arch}`);
    assert.match(source.mirrors[0].url, asset, `${platform}-${arch}`);
    assert.equal(source.archive, platform === 'win32' ? 'zip' : 'tar.gz', `${platform}-${arch}`);
  }
});

test('an unknown platform gets nothing, never the Windows zip', () => {
  assert.equal(portableJavaSource('linux', 'ia32'), null);
  assert.equal(portableJavaSource('freebsd', 'x64'), null);
  assert.equal(portableJavaSource('win32', 'arm64'), null);
});

test('every mirror is verifiable: a pinned digest on each (SEC-03)', () => {
  for (const [platform, arch] of TARGETS) {
    const source = portableJavaSource(platform, arch)!;
    const digests = new Set(source.mirrors.map((m) => m.sha256));
    assert.equal(digests.size, 1, 'one asset, one digest, whichever host serves it');
    assert.match([...digests][0], /^[0-9a-f]{64}$/);
    assert.ok(source.mirrors[0].url.startsWith('https://github.com/adoptium/'), 'the publisher first');
  }
});

function tree(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-java-'));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '');
  }
  return root;
}

test('the Java home is found one level down, and under Contents/Home on macOS', () => {
  const nested = tree(['jdk-21.0.2+13-jre/bin/java', 'jdk-21.0.2+13-jre/lib/modules']);
  assert.equal(locateJavaHome(nested, 'linux'), path.join(nested, 'jdk-21.0.2+13-jre'));

  const mac = tree(['jdk-21.0.2+13-jre/Contents/Home/bin/java', 'jdk-21.0.2+13-jre/Contents/Info.plist']);
  assert.equal(locateJavaHome(mac, 'darwin'), path.join(mac, 'jdk-21.0.2+13-jre', 'Contents', 'Home'));

  const flat = tree(['bin/java.exe']);
  assert.equal(locateJavaHome(flat, 'win32'), flat);

  for (const dir of [nested, mac, flat]) fs.rmSync(dir, { recursive: true, force: true });
});

test('an archive with no launcher, or the wrong platform\'s, is not a Java home', () => {
  const empty = tree(['readme.txt', 'docs/legal']);
  assert.equal(locateJavaHome(empty, 'linux'), null);
  const windowsOnly = tree(['jre/bin/java.exe']);
  assert.equal(locateJavaHome(windowsOnly, 'linux'), null);
  assert.equal(locateJavaHome(path.join(empty, 'missing'), 'linux'), null);
  for (const dir of [empty, windowsOnly]) fs.rmSync(dir, { recursive: true, force: true });
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
