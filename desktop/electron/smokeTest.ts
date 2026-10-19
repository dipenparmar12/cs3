/**
 * A packaged build checking itself, for the release pipeline.
 *
 * Inert unless `CS3_SMOKE_REPORT` names a file. `tools/package/smoke-package.mjs`
 * launches the built app — unpacked, installed from the installer, or the
 * AppImage — with it set, twice against one throwaway profile, and fails the
 * release on what comes back.
 *
 * Why the app checks itself rather than being poked from outside: what goes
 * wrong in a package goes wrong *inside* it. A JRE that does not start on that
 * OS, an ffmpeg missing its exec bit, a native module built for the wrong
 * architecture — `verify-package.mjs` can see that the files are there, and
 * only the running app can say they work. And CI machines carry their own Java
 * and often ffmpeg, so "the sidecar started" proves nothing unless it started
 * on the *bundled* JRE: every check here names the copy it used and fails on a
 * fallback to the machine's own.
 *
 * Network is reported, never required unless asked (`CS3_SMOKE_NETWORK=require`):
 * a repository being down is not the package being broken.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { App, BrowserWindow } from 'electron';

const REPORT_PATH = process.env.CS3_SMOKE_REPORT?.trim() || null;

/** Whether this launch is a smoke test. */
export const smokeTestRequested = REPORT_PATH !== null;

/** The launch counter `persistence` reads and bumps — a key no real profile uses. */
export const SMOKE_LAUNCH_KEY = 'cs3_smoke_launch_count';

/**
 * Points userData at the throwaway profile. Called before anything reads it,
 * so a smoke run on a developer's machine never touches their library.
 */
export function prepareSmokeTest(app: App): void {
  if (!smokeTestRequested) return;
  const dir = process.env.CS3_SMOKE_USER_DATA?.trim();
  if (dir) app.setPath('userData', path.resolve(dir));
}

export interface SmokeCheck {
  id: string;
  ok: boolean;
  /** A failed required check fails the release; an optional one is reported. */
  required: boolean;
  detail: string;
  ms: number;
}

export interface SmokeReport {
  ok: boolean;
  launch: number;
  platform: string;
  arch: string;
  appVersion: string;
  electron: string;
  packaged: boolean;
  userData: string;
  logsDir: string;
  /** The JVM's pid, so the caller can confirm quitting took it down too. */
  sidecarPid?: number;
  checks: SmokeCheck[];
  startedAt: string;
  finishedAt: string;
}

/**
 * Which tools a package for this target carries itself — the same table as
 * `tools/package/verify-package.mjs` and `build-media-runtime.mjs`. ffmpeg is
 * everywhere but Apple silicon (no static build exists; Homebrew's is used);
 * mpv only on Windows (elsewhere the distribution's or Homebrew's).
 */
export function bundledTools(platform: string, arch: string): { ffmpeg: boolean; mpv: boolean } {
  return { ffmpeg: !(platform === 'darwin' && arch === 'arm64'), mpv: platform === 'win32' };
}

type ToolName = 'ffmpeg' | 'ffprobe' | 'mpv';

export interface SmokeDeps {
  app: App;
  window: () => BrowserWindow | null;
  testBinary: (name: ToolName) => Promise<{ ok: boolean; version?: string; path?: string; error?: string }>;
  isBundled: (name: ToolName) => boolean;
  /** `SidecarSupervisor.status()`: provisions, starts the JVM and pings it. */
  sidecarStatus: () => Promise<{ running: boolean; canExecute: boolean; reason?: string; javaVersion?: string; pid?: number }>;
  javaPath: () => string | undefined;
  readLaunchCount: () => number;
  /** Stores the count and flushes it to disk before returning. */
  writeLaunchCount: (count: number) => void;
  /** Loads webtorrent and its native modules, and binds the loopback stream server. */
  startTorrentEngine: () => Promise<void>;
  /** Fetches one bundled repository's index; resolves to a one-line description. */
  reachRepository: () => Promise<string>;
  /** What the package was built for; this process's own platform unless a test says otherwise. */
  target?: { platform: string; arch: string };
}

const DEADLINE_MS = 240_000;
/** The deep steps' own timeouts, summed: install + load + search + details + links + play + download. */
const DEEP_DEADLINE_MS = 1_200_000;

async function timed(
  id: string,
  required: boolean,
  run: () => Promise<{ ok: boolean; detail: string }>,
  timeoutMs: number
): Promise<SmokeCheck> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      run(),
      new Promise<{ ok: boolean; detail: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, detail: `no answer within ${timeoutMs / 1000}s` }), timeoutMs);
      }),
    ]);
    return { id, required, ...outcome, ms: Date.now() - started };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { id, required, ok: false, detail, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Waits for the window to load and React to draw something into `#root`. */
async function rendererMounted(window: () => BrowserWindow | null): Promise<{ ok: boolean; detail: string }> {
  const win = window();
  if (!win || win.isDestroyed()) return { ok: false, detail: 'no main window' };
  const contents = win.webContents;
  if (contents.isLoading()) {
    const failure = await new Promise<string | null>((resolve) => {
      contents.once('did-finish-load', () => resolve(null));
      contents.once('did-fail-load', (_event, code, description) => resolve(`${description} (${code})`));
    });
    if (failure) return { ok: false, detail: `the renderer failed to load: ${failure}` };
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = (await contents.executeJavaScript(
      '({ bridge: typeof window.cloudstream === "object", nodes: document.getElementById("root")?.childElementCount ?? 0 })',
      true
    )) as { bridge: boolean; nodes: number };
    if (!state.bridge) return { ok: false, detail: 'the preload bridge (window.cloudstream) is missing' };
    if (state.nodes > 0) return { ok: true, detail: `${contents.getURL().split('?')[0]} mounted` };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, detail: 'the page loaded but React never drew into #root' };
}

/** In a package, the JRE that answered must be the one inside it. */
function isBundledJava(file: string | undefined, packaged: boolean): boolean {
  if (!packaged) return true;
  return Boolean(file) && path.resolve(file!).startsWith(path.resolve(process.resourcesPath) + path.sep);
}

/** Runs every check, writes the report, then quits through the normal shutdown. */
export async function runSmokeTest(deps: SmokeDeps): Promise<void> {
  if (!REPORT_PATH) return;
  const { app } = deps;
  const launch = Number(process.env.CS3_SMOKE_LAUNCH) || 1;
  const deep = process.env.CS3_SMOKE_DEEP === '1';
  const packaged = app.isPackaged;
  const startedAt = new Date().toISOString();
  const target = deps.target ?? { platform: process.platform, arch: process.arch };
  const expected = bundledTools(target.platform, target.arch);
  const checks: SmokeCheck[] = [];
  let sidecarPid: number | undefined;

  const all = (async () => {
    checks.push(await timed('renderer', true, () => rendererMounted(deps.window), 90_000));

    for (const name of ['ffmpeg', 'ffprobe', 'mpv'] as const) {
      const mustBeBundled = name === 'mpv' ? expected.mpv : expected.ffmpeg;
      checks.push(
        await timed(
          name,
          mustBeBundled,
          async () => {
            const result = await deps.testBinary(name);
            if (!result.ok) return { ok: false, detail: result.error ?? `${name} did not run` };
            const bundled = deps.isBundled(name);
            const where = `${result.path} (${bundled ? 'bundled' : 'from this machine'})`;
            if (mustBeBundled && packaged && !bundled) {
              return { ok: false, detail: `ran ${where}, not the copy this package should carry` };
            }
            return { ok: true, detail: `${result.version} — ${where}` };
          },
          20_000
        )
      );
    }

    checks.push(
      await timed(
        'sidecar',
        true,
        async () => {
          const status = await deps.sidecarStatus();
          sidecarPid = status.pid;
          const java = deps.javaPath();
          if (!status.running) return { ok: false, detail: status.reason ?? 'the JVM did not answer' };
          if (!status.canExecute) return { ok: false, detail: `started, but cannot run providers: ${status.reason}` };
          if (!isBundledJava(java, packaged)) {
            return { ok: false, detail: `answered on ${java}, not the bundled JRE` };
          }
          return { ok: true, detail: `${status.javaVersion ?? 'Java'} (pid ${status.pid}) on ${java}` };
        },
        150_000
      )
    );

    checks.push(
      await timed(
        'torrent',
        true,
        async () => {
          await deps.startTorrentEngine();
          return { ok: true, detail: 'webtorrent and its native modules loaded; loopback server bound' };
        },
        60_000
      )
    );

    checks.push(
      await timed(
        'persistence',
        true,
        async () => {
          const before = deps.readLaunchCount();
          deps.writeLaunchCount(before + 1);
          const ok = before === launch - 1;
          return {
            ok,
            detail: ok
              ? `launch ${launch} found ${before} earlier launch${before === 1 ? '' : 'es'} on disk`
              : `launch ${launch} expected ${launch - 1} earlier launches on disk, found ${before}`,
          };
        },
        10_000
      )
    );

    checks.push(
      await timed(
        'network',
        process.env.CS3_SMOKE_NETWORK === 'require',
        async () => ({ ok: true, detail: await deps.reachRepository() }),
        45_000
      )
    );

    // An extension used end to end (`smokeDeep.ts`), only when asked for: it
    // depends on third-party sites. Loaded here, not at the top, so an
    // ordinary launch evaluates none of it. Each step needs the one before.
    const win = deps.window();
    if (deep && win && !win.isDestroyed()) {
      const { deepSteps } = await import('./smokeDeep.ts');
      for (const step of deepSteps(win, launch)) {
        const check = await timed(step.id, true, step.run, step.timeoutMs);
        checks.push(check);
        if (!check.ok) break;
      }
    }
  })();

  const deadlineMs = deep ? DEADLINE_MS + DEEP_DEADLINE_MS : DEADLINE_MS;
  let timer: NodeJS.Timeout | undefined;
  const finished = await Promise.race([
    all.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  if (!finished) {
    checks.push({ id: 'deadline', required: true, ok: false, detail: `the checks took over ${deadlineMs / 1000}s`, ms: deadlineMs });
  }

  const report: SmokeReport = {
    ok: checks.every((check) => check.ok || !check.required),
    launch,
    platform: target.platform,
    arch: target.arch,
    appVersion: app.getVersion(),
    electron: process.versions.electron ?? '',
    packaged,
    userData: app.getPath('userData'),
    logsDir: path.join(app.getPath('userData'), 'logs'),
    sidecarPid,
    checks,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('[smoke] could not write the report:', error);
  }
  // The ordinary quit, so the teardown in `before-quit` is part of what is tested.
  app.quit();
}
