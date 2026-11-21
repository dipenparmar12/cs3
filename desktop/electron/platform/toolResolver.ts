/**
 * System-First, App-Fallback runtime & utility resolution (PRD-57).
 *
 * Pure candidate ordering, criteria evaluation, and fingerprinted probe
 * caching live here — free of `electron` imports so the entire policy can be
 * unit-tested directly under Node's type-stripping loader.
 *
 * Precedence (default):
 *   1. Explicit override (`CS3_JAVA_HOME`, or `CS3_PREFER_BUNDLED=1` / Settings)
 *   2. System-native installation (`JAVA_HOME`, `PATH`, `extraSearchDirs`, OS JVM dirs)
 *      — accepted ONLY when it passes the tool's Compatibility Criteria Gate.
 *   3. Bundled / local checkout copy (`resources/sidecar/jre`, `resources/media`,
 *      `tools/toolchain/*`, `desktop/media-runtime`)
 *   4. App-managed fallback (`userData/cs3-runtime/java`, `userData/bin`)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extraSearchDirs } from './binarySources.ts';
import { answered, runToolOffThread } from '../media/toolCapabilities.ts';

export type ToolOrigin = 'system' | 'bundled' | 'toolchain' | 'app-managed' | 'missing';

export type ManagedToolName = 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv';

export const REQUIRED_JAVA_MAJOR = 21;

/**
 * Core JPMS modules the extension sidecar and community `.cs3` corpus rely on.
 * Any full JDK/JRE 21 ships all of these; a stripped custom JRE missing
 * `jdk.crypto.ec` or `jdk.unsupported` would fail TLS or Kotlin coroutines at
 * runtime, so the criteria gate rejects it cleanly before launch.
 */
export const REQUIRED_JAVA_MODULES = [
  'java.base',
  'java.desktop',
  'java.net.http',
  'java.sql',
  'java.scripting',
  'java.naming',
  'jdk.crypto.ec',
  'jdk.localedata',
  'jdk.unsupported',
  'jdk.zipfs',
] as const;

export interface JavaCandidate {
  exePath: string;
  origin: Exclude<ToolOrigin, 'missing'>;
  label: string;
}

export interface ToolCandidate {
  exePath: string;
  origin: Exclude<ToolOrigin, 'missing'>;
  label: string;
}

export interface JavaProbeOutcome {
  ok: boolean;
  version?: number;
  reason?: string;
}

export interface ToolProbeOutcome {
  ok: boolean;
  version?: string;
  reason?: string;
}

export interface JavaResolution {
  exePath: string | null;
  version?: number;
  origin: ToolOrigin;
  skippedSystemReason?: string;
}

export interface ToolResolution {
  path: string | null;
  origin: ToolOrigin;
  version?: string;
  skippedSystemReason?: string;
}

export interface ProbeCacheRecord {
  path: string;
  size: number;
  mtimeMs: number;
  ok: boolean;
  version?: string;
  majorVersion?: number;
  reason?: string;
}

// ── Env & Preference Helpers ─────────────────────────────────────────────────

export function preferBundledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CS3_PREFER_BUNDLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

let preferBundledProvider: (() => boolean) | null = null;

/** Registers the app-level preference reader (e.g. from DatastoreManager). */
export function setPreferBundledProvider(provider: (() => boolean) | null): void {
  preferBundledProvider = provider;
}

/** True when either `CS3_PREFER_BUNDLED=1` or the Settings toggle is enabled. */
export function isPreferBundled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (preferBundledFromEnv(env)) return true;
  try {
    return Boolean(preferBundledProvider?.());
  } catch {
    return false;
  }
}

// ── Pure Criteria Evaluators ─────────────────────────────────────────────────

export function parseJavaMajor(output: string): number | null {
  const match = output.match(/version "(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const first = parseInt(match[1], 10);
  if (!Number.isFinite(first)) return null;
  return first === 1 ? parseInt(match[2] ?? '0', 10) : first;
}

export function missingJavaModules(listModulesOutput: string): string[] {
  const present = new Set<string>();
  for (const rawLine of listModulesOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Lines look like `java.base@21.0.5` or `jdk.crypto.ec@21.0.5`.
    const modName = line.split('@')[0]?.trim();
    if (modName) present.add(modName);
  }
  return REQUIRED_JAVA_MODULES.filter((mod) => !present.has(mod));
}

export function evaluateJavaProbe(
  versionOutput: string,
  modulesOutput: string | null,
  minMajor = REQUIRED_JAVA_MAJOR
): JavaProbeOutcome {
  const major = parseJavaMajor(versionOutput);
  if (major === null) {
    return { ok: false, reason: 'could not read Java version from `java -version`' };
  }
  if (major < minMajor) {
    return {
      ok: false,
      version: major,
      reason: `Java ${major} found (requires Java ${minMajor}+)`,
    };
  }
  if (modulesOutput !== null) {
    const missing = missingJavaModules(modulesOutput);
    if (missing.length > 0) {
      return {
        ok: false,
        version: major,
        reason: `Java ${major} is missing required modules: ${missing.join(', ')}`,
      };
    }
  }
  return { ok: true, version: major };
}

export function evaluateBinaryProbe(
  name: ManagedToolName,
  output: string,
  exitOk: boolean
): ToolProbeOutcome {
  const trimmed = output.trim();
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? '';

  if (!exitOk && !trimmed) {
    return { ok: false, reason: `${name} failed to execute` };
  }

  if (name === 'ffmpeg' || name === 'ffprobe') {
    if (!firstLine.toLowerCase().includes(name)) {
      return { ok: false, reason: `unexpected ${name} -version output` };
    }
    const verMatch = firstLine.match(/version\s+(?:n)?(\d+)\.(\d+)/i);
    if (verMatch) {
      const major = parseInt(verMatch[1], 10);
      if (major < 4) {
        return {
          ok: false,
          version: firstLine,
          reason: `${name} ${verMatch[1]}.${verMatch[2]} is too old (requires 4.x+)`,
        };
      }
    }
    return { ok: true, version: firstLine };
  }

  if (name === 'mpv') {
    // On Windows, `mpv.exe` (without `mpv.com`) is a GUI subsystem executable
    // that exits 0 with empty stdout on `--version`. Accept a clean exit 0
    // when no output was emitted, and validate the banner whenever present.
    if (!firstLine && exitOk) {
      return { ok: true, version: 'mpv executable ready' };
    }
    if (!/\bmpv\b/i.test(firstLine)) {
      return { ok: false, reason: 'unexpected mpv --version output' };
    }
    const verMatch = firstLine.match(/mpv\s+v?(\d+)\.(\d+)/i);
    if (verMatch) {
      const major = parseInt(verMatch[1], 10);
      const minor = parseInt(verMatch[2], 10);
      if (major === 0 && minor < 35) {
        return {
          ok: false,
          version: firstLine,
          reason: `mpv ${major}.${minor} is too old (requires 0.35+ for JSON IPC)`,
        };
      }
    }
    return { ok: true, version: firstLine };
  }

  if (name === 'yt-dlp') {
    // Standard yt-dlp `--version` prints a single date token like `2025.02.19`
    // (or `2026.01.15.232011`).
    const verMatch = firstLine.match(/^(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/);
    if (!verMatch) {
      return { ok: false, reason: 'unexpected yt-dlp --version output' };
    }
    return { ok: true, version: verMatch[1] };
  }

  if (name === 'aria2c') {
    if (!/aria2/i.test(firstLine)) {
      return { ok: false, reason: 'unexpected aria2c -v output' };
    }
    const verMatch = firstLine.match(/version\s+(\d+)\.(\d+)/i);
    if (verMatch) {
      const major = parseInt(verMatch[1], 10);
      const minor = parseInt(verMatch[2], 10);
      if (major < 1 || (major === 1 && minor < 35)) {
        return {
          ok: false,
          version: firstLine,
          reason: `aria2 ${major}.${minor} is too old (requires 1.35+)`,
        };
      }
    }
    return { ok: true, version: firstLine };
  }

  return exitOk ? { ok: true, version: firstLine || `${name} ready` } : { ok: false, reason: `${name} failed` };
}

// ── Pure Candidate Ordering & Resolution ─────────────────────────────────────

function dedupeByPath<T extends { exePath: string }>(items: T[], platform: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = platform === 'win32' ? path.normalize(item.exePath).toLowerCase() : path.normalize(item.exePath);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export interface OrderJavaOptions {
  preferBundled: boolean;
  isPackaged: boolean;
  baseDir: string;
  resourcesPath?: string;
  toolchainDirs?: string[];
  distJreDirs?: string[];
  systemCandidates: Array<{ exePath: string; label: string }>;
  platform?: string;
}

/**
 * Orders Java runtime candidates according to System-First (default) or
 * Bundled-First (`preferBundled = true`).
 */
export function orderJavaCandidates(options: OrderJavaOptions): JavaCandidate[] {
  const platform = options.platform ?? process.platform;
  const exe = platform === 'win32' ? 'java.exe' : 'java';

  const system: JavaCandidate[] = options.systemCandidates.map((c) => ({
    exePath: c.exePath,
    origin: 'system',
    label: c.label,
  }));

  const bundled: JavaCandidate[] =
    options.isPackaged && options.resourcesPath
      ? [
          {
            exePath: path.join(options.resourcesPath, 'sidecar', 'jre', 'bin', exe),
            origin: 'bundled',
            label: 'Bundled JRE',
          },
        ]
      : [];

  const toolchain: JavaCandidate[] = [];
  if (!options.isPackaged) {
    for (const dir of options.toolchainDirs ?? []) {
      toolchain.push({
        exePath: path.join(dir, 'bin', exe),
        origin: 'toolchain',
        label: 'Dev toolchain JDK',
      });
      toolchain.push({
        exePath: path.join(dir, 'jre', 'bin', exe),
        origin: 'toolchain',
        label: 'Dev toolchain JRE',
      });
    }
    for (const distJre of options.distJreDirs ?? []) {
      toolchain.push({
        exePath: path.join(distJre, 'bin', exe),
        origin: 'toolchain',
        label: 'Prebuilt dist JRE',
      });
    }
  }

  const appManaged: JavaCandidate[] = [
    {
      exePath: path.join(options.baseDir, 'java', 'bin', exe),
      origin: 'app-managed',
      label: 'App-managed Java',
    },
    {
      exePath: path.join(options.baseDir, 'jre', 'bin', exe),
      origin: 'app-managed',
      label: 'App-managed JRE',
    },
  ];

  const ordered = options.preferBundled
    ? [...bundled, ...appManaged, ...toolchain, ...system]
    : [...system, ...bundled, ...toolchain, ...appManaged];

  return dedupeByPath(ordered, platform);
}

/**
 * Walks ordered Java candidates and picks the first existing binary that passes
 * the criteria probe. Records why a system candidate was rejected (if any) so
 * callers and Settings UI can explain fallback transparently.
 */
export function resolveJavaCandidate(
  candidates: JavaCandidate[],
  exists: (file: string) => boolean,
  probe: (candidate: JavaCandidate) => JavaProbeOutcome
): JavaResolution {
  let skippedSystemReason: string | undefined;

  for (const candidate of candidates) {
    if (!exists(candidate.exePath)) continue;
    const result = probe(candidate);
    if (result.ok && result.version !== undefined) {
      return {
        exePath: candidate.exePath,
        version: result.version,
        origin: candidate.origin,
        skippedSystemReason: candidate.origin === 'system' ? undefined : skippedSystemReason,
      };
    }
    if (candidate.origin === 'system' && !skippedSystemReason) {
      skippedSystemReason = `${candidate.label} (${candidate.exePath}) skipped: ${result.reason ?? 'failed compatibility check'}`;
    }
  }

  return {
    exePath: null,
    origin: 'missing',
    skippedSystemReason,
  };
}

export interface OrderBinaryOptions {
  name: ManagedToolName;
  preferBundled: boolean;
  bundledDirs: string[];
  binDir: string;
  cwdBinDir: string;
  systemDirs: string[];
  /** Optional directory of a paired system tool (e.g. `ffmpeg`'s dir for `ffprobe`). */
  pairedSystemDir?: string | null;
  platform?: string;
}

/**
 * Orders helper binary candidates according to System-First (default) or
 * Bundled-First (`preferBundled = true`).
 */
export function orderBinaryCandidates(options: OrderBinaryOptions): ToolCandidate[] {
  const platform = options.platform ?? process.platform;
  const exe = platform === 'win32' ? `${options.name}.exe` : options.name;

  const system: ToolCandidate[] = [];
  if (options.pairedSystemDir) {
    system.push({
      exePath: path.join(options.pairedSystemDir, exe),
      origin: 'system',
      label: 'System (paired)',
    });
  }
  for (const dir of options.systemDirs) {
    if (!dir) continue;
    system.push({
      exePath: path.join(dir, exe),
      origin: 'system',
      label: 'System PATH',
    });
  }

  const bundled: ToolCandidate[] = options.bundledDirs.map((dir) => ({
    exePath: path.join(dir, exe),
    origin: 'bundled',
    label: 'Included with app',
  }));

  const appManaged: ToolCandidate[] = [
    {
      exePath: path.join(options.binDir, exe),
      origin: 'app-managed',
      label: 'App-managed',
    },
    {
      exePath: path.join(options.cwdBinDir, exe),
      origin: 'app-managed',
      label: 'Local bin',
    },
  ];

  // For `yt-dlp`, an app-managed copy is self-updated between releases, so
  // under `preferBundled` (or after system fallback) `userData/bin` precedes
  // bundled media dirs. System-native still wins first in default mode.
  const fallback =
    options.name === 'yt-dlp' ? [...appManaged, ...bundled] : [...bundled, ...appManaged];

  const ordered = options.preferBundled ? [...fallback, ...system] : [...system, ...fallback];
  return dedupeByPath(ordered, platform);
}

/**
 * Walks ordered binary candidates and picks the first existing binary that
 * passes verification. System candidates are always criteria-gated; bundled and
 * app-managed candidates are trusted once present on disk (so warm/fallback
 * resolution incurs zero unnecessary spawns).
 */
export function resolveBinaryCandidate(
  candidates: ToolCandidate[],
  exists: (file: string) => boolean,
  probeSystem: (candidate: ToolCandidate) => ToolProbeOutcome
): ToolResolution {
  let skippedSystemReason: string | undefined;

  for (const candidate of candidates) {
    if (!exists(candidate.exePath)) continue;
    if (candidate.origin === 'system') {
      const result = probeSystem(candidate);
      if (result.ok) {
        return {
          path: candidate.exePath,
          origin: 'system',
          version: result.version,
        };
      }
      if (!skippedSystemReason) {
        skippedSystemReason = `System ${path.basename(candidate.exePath)} (${candidate.exePath}) skipped: ${result.reason ?? 'failed compatibility check'}`;
      }
      continue;
    }
    return {
      path: candidate.exePath,
      origin: candidate.origin,
      skippedSystemReason,
    };
  }

  return {
    path: null,
    origin: 'missing',
    skippedSystemReason,
  };
}

// ── System Discovery Helpers ─────────────────────────────────────────────────

export function systemSearchDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  home: string = os.homedir()
): string[] {
  const pathKey = platform === 'win32'
    ? Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
    : 'PATH';
  const fromPath = (env[pathKey] ?? '').split(path.delimiter).filter(Boolean);
  return [...fromPath, ...extraSearchDirs(platform, home)];
}

export function discoverSystemJavaCandidates(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  exists: (file: string) => boolean = fs.existsSync
): Array<{ exePath: string; label: string }> {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const out: Array<{ exePath: string; label: string }> = [];

  // 1. Explicit env override
  if (env.CS3_JAVA_HOME?.trim()) {
    out.push({
      exePath: path.join(env.CS3_JAVA_HOME.trim(), 'bin', exe),
      label: 'CS3_JAVA_HOME',
    });
  }

  // 2. Standard JAVA_HOME
  if (env.JAVA_HOME?.trim()) {
    out.push({
      exePath: path.join(env.JAVA_HOME.trim(), 'bin', exe),
      label: 'JAVA_HOME',
    });
  }

  // 3. System PATH + extra search dirs
  for (const dir of systemSearchDirs(env, platform)) {
    const candidate = path.join(dir, exe);
    if (exists(candidate)) {
      out.push({ exePath: candidate, label: 'PATH' });
    }
  }

  // 4. OS-standard JVM installation trees (for GUI launches that lack shell JAVA_HOME)
  if (platform === 'darwin') {
    const jvmRoot = '/Library/Java/JavaVirtualMachines';
    try {
      if (exists(jvmRoot)) {
        for (const entry of fs.readdirSync(jvmRoot).sort().reverse()) {
          const candidate = path.join(jvmRoot, entry, 'Contents', 'Home', 'bin', exe);
          if (exists(candidate)) out.push({ exePath: candidate, label: 'macOS JVM' });
        }
      }
    } catch {
      // Ignore unreadable system dirs
    }
  } else if (platform === 'linux') {
    const jvmRoot = '/usr/lib/jvm';
    try {
      if (exists(jvmRoot)) {
        for (const entry of fs.readdirSync(jvmRoot).sort().reverse()) {
          const candidate = path.join(jvmRoot, entry, 'bin', exe);
          if (exists(candidate)) out.push({ exePath: candidate, label: 'Linux JVM' });
        }
      }
    } catch {
      // Ignore unreadable system dirs
    }
  }

  return out;
}

// ── Fingerprinted Probe Cache ────────────────────────────────────────────────

export class ToolProbeCache {
  private entries = new Map<string, ProbeCacheRecord>();
  private cacheFile: string | null = null;
  private loaded = false;

  constructor(cacheFile?: string) {
    if (cacheFile) this.setFile(cacheFile);
  }

  public setFile(cacheFile: string): void {
    if (this.cacheFile === cacheFile && this.loaded) return;
    this.cacheFile = cacheFile;
    this.load();
  }

  private load(): void {
    this.loaded = true;
    if (!this.cacheFile) return;
    try {
      if (!fs.existsSync(this.cacheFile)) return;
      const parsed = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) as Record<string, ProbeCacheRecord>;
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value.size === 'number' && typeof value.mtimeMs === 'number') {
            this.entries.set(key, value);
          }
        }
      }
    } catch {
      // Corrupt cache is simply rebuilt on demand.
    }
  }

  private save(): void {
    if (!this.cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const obj: Record<string, ProbeCacheRecord> = {};
      for (const [k, v] of this.entries) obj[k] = v;
      fs.writeFileSync(this.cacheFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch {
      // Best-effort persistence.
    }
  }

  private fingerprint(filePath: string): { size: number; mtimeMs: number } | null {
    try {
      const st = fs.statSync(filePath);
      if (!st.isFile()) return null;
      return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
    } catch {
      return null;
    }
  }

  public get(key: string, filePath: string): ProbeCacheRecord | null {
    const fp = this.fingerprint(filePath);
    if (!fp) return null;
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (hit.path === filePath && hit.size === fp.size && hit.mtimeMs === fp.mtimeMs) {
      return hit;
    }
    return null;
  }

  public set(
    key: string,
    filePath: string,
    result: { ok: boolean; version?: string; majorVersion?: number; reason?: string }
  ): void {
    const fp = this.fingerprint(filePath);
    if (!fp) return;
    this.entries.set(key, {
      path: filePath,
      size: fp.size,
      mtimeMs: fp.mtimeMs,
      ok: result.ok,
      version: result.version,
      majorVersion: result.majorVersion,
      reason: result.reason,
    });
    this.save();
  }

  public delete(key: string): void {
    if (this.entries.delete(key)) this.save();
  }

  public clear(): void {
    this.entries.clear();
    this.save();
  }
}

const sharedProbeCache = new ToolProbeCache();

export function configureProbeCache(cacheFile: string): void {
  sharedProbeCache.setFile(cacheFile);
}

export function getSharedProbeCache(): ToolProbeCache {
  return sharedProbeCache;
}

// ── Live Probing (Sync + Off-Thread Async) ───────────────────────────────────

function probeCommandForBinary(
  name: ManagedToolName,
  exePath: string,
  platform: string
): { command: string; flag: string } {
  const flag =
    name === 'yt-dlp' || name === 'mpv' ? '--version' : name === 'aria2c' ? '-v' : '-version';

  // On Windows `mpv.exe` is a GUI subsystem binary whose stdout goes nowhere;
  // prefer the console wrapper `mpv.com` beside it when probing version output.
  if (platform === 'win32' && name === 'mpv' && exePath.toLowerCase().endsWith('.exe')) {
    const comPath = exePath.slice(0, -4) + '.com';
    if (fs.existsSync(comPath)) {
      return { command: comPath, flag };
    }
  }
  return { command: exePath, flag };
}

export function probeJavaBinarySync(
  exePath: string,
  cache: ToolProbeCache = sharedProbeCache,
  checkModules = true
): JavaProbeOutcome {
  const cacheKey = `java:${checkModules ? 'full' : 'ver'}:${exePath}`;
  const cached = cache.get(cacheKey, exePath);
  if (cached) {
    return { ok: cached.ok, version: cached.majorVersion, reason: cached.reason };
  }

  try {
    const verProbe = spawnSync(exePath, ['-version'], {
      encoding: 'utf8',
      timeout: 6_000,
      windowsHide: true,
    });
    const verOut = `${verProbe.stderr ?? ''}${verProbe.stdout ?? ''}`;
    const quickCheck = evaluateJavaProbe(verOut, null);
    if (!quickCheck.ok || !checkModules) {
      if (!verProbe.error) {
        cache.set(cacheKey, exePath, {
          ok: quickCheck.ok,
          majorVersion: quickCheck.version,
          reason: quickCheck.reason,
        });
      }
      return quickCheck;
    }

    const modProbe = spawnSync(exePath, ['--list-modules'], {
      encoding: 'utf8',
      timeout: 8_000,
      windowsHide: true,
    });
    const modOut = modProbe.status === 0 ? `${modProbe.stdout ?? ''}` : null;
    const outcome = evaluateJavaProbe(verOut, modOut);
    if (!modProbe.error) {
      cache.set(cacheKey, exePath, {
        ok: outcome.ok,
        majorVersion: outcome.version,
        reason: outcome.reason,
      });
    }
    return outcome;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'failed to run java',
    };
  }
}

export async function probeJavaBinaryAsync(
  exePath: string,
  cache: ToolProbeCache = sharedProbeCache,
  checkModules = true
): Promise<JavaProbeOutcome> {
  const cacheKey = `java:${checkModules ? 'full' : 'ver'}:${exePath}`;
  const cached = cache.get(cacheKey, exePath);
  if (cached) {
    return { ok: cached.ok, version: cached.majorVersion, reason: cached.reason };
  }

  const verRes = await runToolOffThread(exePath, ['-version'], 6_000);
  const verOut = `${verRes.stderr}${verRes.stdout}`;
  const quickCheck = evaluateJavaProbe(verOut, null);
  if (!quickCheck.ok || !checkModules) {
    if (answered(verRes)) {
      cache.set(cacheKey, exePath, {
        ok: quickCheck.ok,
        majorVersion: quickCheck.version,
        reason: quickCheck.reason,
      });
    }
    return quickCheck;
  }

  const modRes = await runToolOffThread(exePath, ['--list-modules'], 8_000);
  const modOut = modRes.ok ? modRes.stdout : null;
  const outcome = evaluateJavaProbe(verOut, modOut);
  if (answered(modRes)) {
    cache.set(cacheKey, exePath, {
      ok: outcome.ok,
      majorVersion: outcome.version,
      reason: outcome.reason,
    });
  }
  return outcome;
}

export function probeManagedBinarySync(
  name: ManagedToolName,
  exePath: string,
  cache: ToolProbeCache = sharedProbeCache,
  platform: string = process.platform
): ToolProbeOutcome {
  const cacheKey = `bin:${name}:${exePath}`;
  const cached = cache.get(cacheKey, exePath);
  if (cached) {
    return { ok: cached.ok, version: cached.version, reason: cached.reason };
  }

  try {
    const { command, flag } = probeCommandForBinary(name, exePath, platform);
    const probe = spawnSync(command, [flag], {
      encoding: 'utf8',
      timeout: 6_000,
      windowsHide: true,
    });
    const out = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    const exitOk = !probe.error && probe.status === 0;
    const outcome = evaluateBinaryProbe(name, out, exitOk);
    if (!probe.error && probe.status !== null) {
      cache.set(cacheKey, exePath, outcome);
    }
    return outcome;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : `failed to run ${name}`,
    };
  }
}

export async function probeManagedBinaryAsync(
  name: ManagedToolName,
  exePath: string,
  cache: ToolProbeCache = sharedProbeCache,
  platform: string = process.platform
): Promise<ToolProbeOutcome> {
  const cacheKey = `bin:${name}:${exePath}`;
  const cached = cache.get(cacheKey, exePath);
  if (cached) {
    return { ok: cached.ok, version: cached.version, reason: cached.reason };
  }

  const { command, flag } = probeCommandForBinary(name, exePath, platform);
  const res = await runToolOffThread(command, [flag], 8_000);
  const outcome = evaluateBinaryProbe(name, `${res.stdout}${res.stderr}`, res.ok);
  if (answered(res)) {
    cache.set(cacheKey, exePath, outcome);
  }
  return outcome;
}
