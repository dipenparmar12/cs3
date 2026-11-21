/**
 * System-First, App-Fallback resolution policy & criteria gate tests (PRD-57).
 *
 *   node --experimental-strip-types electron/platform/toolResolver.test.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REQUIRED_JAVA_MODULES,
  ToolProbeCache,
  evaluateBinaryProbe,
  evaluateJavaProbe,
  missingJavaModules,
  orderBinaryCandidates,
  orderJavaCandidates,
  parseJavaMajor,
  preferBundledFromEnv,
  resolveBinaryCandidate,
  resolveJavaCandidate,
} from './toolResolver.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ── Criteria evaluators ──────────────────────────────────────────────────────

test('parseJavaMajor reads modern and legacy Java version banners', () => {
  assert.equal(parseJavaMajor('openjdk version "21.0.5" 2024-10-15'), 21);
  assert.equal(parseJavaMajor('java version "23" 2024-09-17'), 23);
  assert.equal(parseJavaMajor('openjdk version "17.0.12"'), 17);
  assert.equal(parseJavaMajor('java version "1.8.0_411"'), 8);
  assert.equal(parseJavaMajor('not java at all'), null);
});

test('evaluateJavaProbe accepts Java 21+ with all required JPMS modules', () => {
  const allModules = REQUIRED_JAVA_MODULES.map((m) => `${m}@21.0.5`).join('\n');
  const res = evaluateJavaProbe('openjdk version "21.0.5"', allModules);
  assert.equal(res.ok, true);
  assert.equal(res.version, 21);
});

test('evaluateJavaProbe rejects Java 17 and stripped JREs missing jdk.crypto.ec', () => {
  const old = evaluateJavaProbe('openjdk version "17.0.12"', null);
  assert.equal(old.ok, false);
  assert.equal(old.version, 17);
  assert.match(old.reason ?? '', /Java 17.*21\+/);

  const strippedModules = REQUIRED_JAVA_MODULES.filter((m) => m !== 'jdk.crypto.ec')
    .map((m) => `${m}@21.0.5`)
    .join('\n');
  assert.deepEqual(missingJavaModules(strippedModules), ['jdk.crypto.ec']);
  const stripped = evaluateJavaProbe('openjdk version "21.0.5"', strippedModules);
  assert.equal(stripped.ok, false);
  assert.match(stripped.reason ?? '', /jdk\.crypto\.ec/);
});

test('evaluateBinaryProbe enforces per-tool version and banner criteria', () => {
  assert.equal(evaluateBinaryProbe('ffmpeg', 'ffmpeg version 7.1-essentials_build', true).ok, true);
  assert.equal(evaluateBinaryProbe('ffmpeg', 'ffmpeg version n6.1.1', true).ok, true);
  assert.equal(evaluateBinaryProbe('ffmpeg', 'ffmpeg version 3.4.2', true).ok, false);
  assert.equal(evaluateBinaryProbe('ffmpeg', 'random output', true).ok, false);

  assert.equal(evaluateBinaryProbe('ffprobe', 'ffprobe version 7.1', true).ok, true);
  assert.equal(evaluateBinaryProbe('ffprobe', '', false).ok, false);

  assert.equal(evaluateBinaryProbe('mpv', 'mpv v0.38.0 Copyright ...', true).ok, true);
  assert.equal(evaluateBinaryProbe('mpv', 'mpv 0.34.1 Copyright ...', true).ok, false);
  // Windows mpv.exe GUI subsystem exits 0 with empty output when mpv.com is absent
  assert.equal(evaluateBinaryProbe('mpv', '', true).ok, true);

  const ytdlp = evaluateBinaryProbe('yt-dlp', '2025.02.19\n', true);
  assert.equal(ytdlp.ok, true);
  assert.equal(ytdlp.version, '2025.02.19');
  assert.equal(evaluateBinaryProbe('yt-dlp', 'broken banner', true).ok, false);

  assert.equal(evaluateBinaryProbe('aria2c', 'aria2 version 1.37.0', true).ok, true);
  assert.equal(evaluateBinaryProbe('aria2c', 'aria2 version 1.34.0', true).ok, false);
});

// ── System-First Java resolution ─────────────────────────────────────────────

test('default Java resolution prefers verified system Java over bundled and app-managed', () => {
  const candidates = orderJavaCandidates({
    preferBundled: false,
    isPackaged: true,
    baseDir: '/appdata/cs3-runtime',
    resourcesPath: '/app/resources',
    systemCandidates: [{ exePath: '/sys/jdk21/bin/java', label: 'JAVA_HOME' }],
    platform: 'linux',
  });

  const existing = new Set([
    '/sys/jdk21/bin/java',
    '/app/resources/sidecar/jre/bin/java',
    '/appdata/cs3-runtime/java/bin/java',
  ]);
  const resolved = resolveJavaCandidate(
    candidates,
    (f) => existing.has(f),
    () => ({ ok: true, version: 21 })
  );

  assert.equal(resolved.origin, 'system');
  assert.equal(resolved.exePath, '/sys/jdk21/bin/java');
  assert.equal(resolved.skippedSystemReason, undefined);
});

test('system JAVA_HOME=17 is rejected with reason and falls back to PATH Java 21, then bundled JRE', () => {
  const candidates = orderJavaCandidates({
    preferBundled: false,
    isPackaged: true,
    baseDir: '/appdata/cs3-runtime',
    resourcesPath: '/app/resources',
    systemCandidates: [
      { exePath: '/sys/jdk17/bin/java', label: 'JAVA_HOME' },
      { exePath: '/usr/bin/java', label: 'PATH' },
    ],
    platform: 'linux',
  });

  const bundledJava = path.join('/app/resources', 'sidecar', 'jre', 'bin', 'java');

  // Case A: PATH has Java 21 → stays system-native
  const resA = resolveJavaCandidate(
    candidates,
    (f) => f === '/sys/jdk17/bin/java' || f === '/usr/bin/java' || f === bundledJava,
    (c) =>
      c.exePath === '/sys/jdk17/bin/java'
        ? { ok: false, version: 17, reason: 'Java 17 found (requires Java 21+)' }
        : { ok: true, version: 21 }
  );
  assert.equal(resA.origin, 'system');
  assert.equal(resA.exePath, '/usr/bin/java');

  // Case B: only JAVA_HOME=17 on system → falls back to bundled JRE with diagnostic
  const resB = resolveJavaCandidate(
    candidates,
    (f) => f === '/sys/jdk17/bin/java' || f === bundledJava,
    (c) =>
      c.exePath === '/sys/jdk17/bin/java'
        ? { ok: false, version: 17, reason: 'Java 17 found (requires Java 21+)' }
        : { ok: true, version: 21 }
  );
  assert.equal(resB.origin, 'bundled');
  assert.equal(resB.exePath, bundledJava);
  assert.match(resB.skippedSystemReason ?? '', /JAVA_HOME.*Java 17/);
});

test('preferBundled flips Java precedence back to bundled before system', () => {
  const candidates = orderJavaCandidates({
    preferBundled: true,
    isPackaged: true,
    baseDir: '/appdata/cs3-runtime',
    resourcesPath: '/app/resources',
    systemCandidates: [{ exePath: '/sys/jdk21/bin/java', label: 'JAVA_HOME' }],
    platform: 'linux',
  });

  const existing = new Set([
    '/sys/jdk21/bin/java',
    path.join('/app/resources', 'sidecar', 'jre', 'bin', 'java'),
  ]);
  const resolved = resolveJavaCandidate(
    candidates,
    (f) => existing.has(f),
    () => ({ ok: true, version: 21 })
  );
  assert.equal(resolved.origin, 'bundled');
});

test('vacuous case: missing everywhere returns origin=missing and null path', () => {
  const candidates = orderJavaCandidates({
    preferBundled: false,
    isPackaged: false,
    baseDir: '/appdata/cs3-runtime',
    systemCandidates: [],
    platform: 'linux',
  });
  const resolved = resolveJavaCandidate(candidates, () => false, () => ({ ok: false }));
  assert.equal(resolved.origin, 'missing');
  assert.equal(resolved.exePath, null);
});

// ── System-First Helper Binary resolution ────────────────────────────────────

test('default binary resolution prefers verified system tool over bundled and app-managed', () => {
  const candidates = orderBinaryCandidates({
    name: 'ffmpeg',
    preferBundled: false,
    bundledDirs: ['/app/resources/media'],
    binDir: '/appdata/bin',
    cwdBinDir: '/cwd/bin',
    systemDirs: ['/usr/local/bin', '/usr/bin'],
    platform: 'linux',
  });

  const existing = new Set([
    path.join('/usr/local/bin', 'ffmpeg'),
    path.join('/app/resources/media', 'ffmpeg'),
    path.join('/appdata/bin', 'ffmpeg'),
  ]);
  const resolved = resolveBinaryCandidate(
    candidates,
    (f) => existing.has(f),
    () => ({ ok: true, version: 'ffmpeg version 7.1' })
  );
  assert.equal(resolved.origin, 'system');
  assert.equal(resolved.path, path.join('/usr/local/bin', 'ffmpeg'));
  assert.equal(resolved.version, 'ffmpeg version 7.1');
});

test('broken system ffmpeg is skipped with diagnostic and falls back to bundled copy', () => {
  const candidates = orderBinaryCandidates({
    name: 'ffmpeg',
    preferBundled: false,
    bundledDirs: ['/app/resources/media'],
    binDir: '/appdata/bin',
    cwdBinDir: '/cwd/bin',
    systemDirs: ['/usr/bin'],
    platform: 'linux',
  });

  const existing = new Set([
    path.join('/usr/bin', 'ffmpeg'),
    path.join('/app/resources/media', 'ffmpeg'),
  ]);
  const resolved = resolveBinaryCandidate(
    candidates,
    (f) => existing.has(f),
    () => ({ ok: false, reason: 'ffmpeg 3.4 is too old (requires 4.x+)' })
  );
  assert.equal(resolved.origin, 'bundled');
  assert.equal(resolved.path, path.join('/app/resources/media', 'ffmpeg'));
  assert.match(resolved.skippedSystemReason ?? '', /3\.4/);
});

test('pairedSystemDir prefers ffprobe beside the resolved system ffmpeg', () => {
  const candidates = orderBinaryCandidates({
    name: 'ffprobe',
    preferBundled: false,
    bundledDirs: ['/app/resources/media'],
    binDir: '/appdata/bin',
    cwdBinDir: '/cwd/bin',
    systemDirs: ['/usr/bin', '/opt/ffmpeg/bin'],
    pairedSystemDir: '/opt/ffmpeg/bin',
    platform: 'linux',
  });

  const existing = new Set([
    path.join('/usr/bin', 'ffprobe'),
    path.join('/opt/ffmpeg/bin', 'ffprobe'),
  ]);
  const resolved = resolveBinaryCandidate(
    candidates,
    (f) => existing.has(f),
    () => ({ ok: true, version: 'ffprobe version 7.1' })
  );
  assert.equal(resolved.origin, 'system');
  assert.equal(resolved.path, path.join('/opt/ffmpeg/bin', 'ffprobe'));
});

test('preferBundled env parser handles truthy and falsy values', () => {
  assert.equal(preferBundledFromEnv({ CS3_PREFER_BUNDLED: '1' }), true);
  assert.equal(preferBundledFromEnv({ CS3_PREFER_BUNDLED: 'true' }), true);
  assert.equal(preferBundledFromEnv({ CS3_PREFER_BUNDLED: '0' }), false);
  assert.equal(preferBundledFromEnv({}), false);
});

// ── Fingerprinted Probe Cache ────────────────────────────────────────────────

test('ToolProbeCache hits on matching fingerprint and invalidates when file changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-probe-cache-'));
  try {
    const cacheFile = path.join(dir, 'probes.json');
    const binFile = path.join(dir, 'fake-tool');
    fs.writeFileSync(binFile, 'v1-binary');

    const cache1 = new ToolProbeCache(cacheFile);
    assert.equal(cache1.get('bin:ffmpeg', binFile), null);
    cache1.set('bin:ffmpeg', binFile, { ok: true, version: 'ffmpeg 7.1' });

    // Re-load from disk: must hit without re-probing
    const cache2 = new ToolProbeCache(cacheFile);
    const hit = cache2.get('bin:ffmpeg', binFile);
    assert.ok(hit);
    assert.equal(hit.ok, true);
    assert.equal(hit.version, 'ffmpeg 7.1');

    // Mutate file size → fingerprint changes → cache miss
    fs.writeFileSync(binFile, 'v2-binary-longer-content');
    assert.equal(cache2.get('bin:ffmpeg', binFile), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
