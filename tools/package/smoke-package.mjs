#!/usr/bin/env node
/**
 * Installs and launches the packages this machine built, and fails if any of
 * them does not work.
 *
 * `verify-package.mjs` answers "is everything in the box"; this answers "does
 * it run". Each subject — the unpacked app, and with `--installed` every
 * artifact a user downloads (Windows: installer, portable exe, zip; macOS: dmg,
 * zip; Linux: AppImage, deb, tarball) — is launched twice against one
 * throwaway profile with `CS3_SMOKE_REPORT` set, which makes the app check
 * itself (`desktop/electron/smokeTest.ts`): the window and React mount, the
 * bundled ffmpeg/ffprobe/mpv run, the sidecar starts **on the bundled JRE** and
 * can execute providers, webtorrent's native modules load, and a value written
 * on the first launch is read back on the second. From outside, this script
 * adds what the app cannot see about itself: that it exited 0 within the
 * deadline, that the JVM did not outlive it, and that the shutdown did not
 * overrun (`shutdown_timeout` in its log). Reaching a repository is reported
 * on every launch and fails the run only with `--require-network`.
 *
 * `--deep` adds one community extension used end to end on launch 1 —
 * install, load, search, details, links, playback, a 2 MB download — and on
 * launch 2 checks it is still installed (`desktop/electron/smokeDeep.ts`;
 * pick the target with CS3_SMOKE_DEEP_REPO/_PLUGIN/_QUERY). It depends on
 * third-party sites, so it proves a build on a real machine rather than
 * gating a release.
 *
 *   node tools/package/smoke-package.mjs [--arch x64] [--installed] [--version 1.2.3]
 *                                        [--deep] [--require-network] [--no-sandbox] [--keep] [--work dir] [--timeout 300]
 *
 * Linux without a display runs under `xvfb-run`. `--no-sandbox` is for CI
 * hosts whose kernel policy forbids Chromium's sandbox (the deb's postinst
 * sets that up on a real install; an unpacked tree cannot).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LINUX_EXECUTABLE,
  PRODUCT_NAME,
  RELEASE_DIR,
  executable,
  expectedArtifacts,
  flag,
  unpackedDir,
  walk,
} from './package-layout.mjs';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const platform = process.platform;
const arch = flag(argv, '--arch', process.arch);
const version = flag(argv, '--version');
const DEEP = has('--deep');
const LAUNCH_TIMEOUT_MS = Number(flag(argv, '--timeout', DEEP ? '1500' : '300')) * 1000;
// `--work` names a directory CI can upload when a launch fails; it must not
// contain spaces on Windows (NSIS takes its install path unquoted).
const workArg = flag(argv, '--work');
if (workArg) fs.mkdirSync(workArg, { recursive: true });
const work = workArg ? fs.mkdtempSync(path.join(path.resolve(workArg), 'run-')) : fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-smoke-'));

const failures = [];
const summary = [];

function log(message) {
  console.log(message);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} exited ${result.status}: ${(result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 600)}`);
  }
  return result.stdout;
}
function commandExists(name) {
  return spawnSync(platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0;
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
function killTree(child) {
  if (!child.pid) return;
  if (platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One launch with the smoke environment; resolves to what the app reported plus what was seen from outside. */
async function launch(subject, launchNumber, profile) {
  const report = path.join(work, `${subject.id}-launch${launchNumber}.json`);
  fs.rmSync(report, { force: true });
  const env = {
    ...process.env,
    ...subject.env,
    CS3_SMOKE_REPORT: report,
    CS3_SMOKE_USER_DATA: profile,
    CS3_SMOKE_LAUNCH: String(launchNumber),
    CS3_SMOKE_NETWORK: has('--require-network') ? 'require' : 'report',
    ...(DEEP ? { CS3_SMOKE_DEEP: '1' } : {}),
    ELECTRON_ENABLE_LOGGING: '1',
  };
  // A developer's ELECTRON_RUN_AS_NODE would turn the app into a bare Node.
  delete env.ELECTRON_RUN_AS_NODE;

  let command = subject.command;
  let args = [...(subject.args ?? [])];
  if (platform === 'linux') {
    if (has('--no-sandbox')) args.push('--no-sandbox');
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      if (!commandExists('xvfb-run')) throw new Error('no display, and xvfb-run is not installed (apt install xvfb)');
      args = ['-a', '--server-args=-screen 0 1280x800x24', command, ...args];
      command = 'xvfb-run';
    }
  }

  const started = Date.now();
  const child = spawn(command, args, {
    env,
    cwd: work,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: platform !== 'win32',
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      killTree(child);
      resolve({ code: null, timedOut: true });
    }, LAUNCH_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, error: error.message });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  fs.writeFileSync(path.join(work, `${subject.id}-launch${launchNumber}.log`), output);

  const problems = [];
  if (exit.error) problems.push(`could not start: ${exit.error}`);
  if (exit.timedOut) problems.push(`still running after ${LAUNCH_TIMEOUT_MS / 1000}s; killed`);
  if (!exit.timedOut && !exit.error && exit.code !== 0 && !subject.exitCodeUnreliable) {
    problems.push(`exited with ${exit.code ?? exit.signal}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(report, 'utf8'));
  } catch {
    problems.push('wrote no smoke report — the main process never reached its checks');
  }
  if (parsed) {
    for (const check of parsed.checks) {
      const line = `${check.ok ? 'ok  ' : check.required ? 'FAIL' : 'warn'} ${check.id.padEnd(11)} ${check.detail}`;
      log(`      ${line}`);
      if (!check.ok && check.required) problems.push(`${check.id}: ${check.detail}`);
    }
    if (!parsed.packaged) problems.push('the app reports it is not packaged');
    if (version && parsed.appVersion !== version) problems.push(`reports version ${parsed.appVersion}, expected ${version}`);
    if (parsed.sidecarPid) {
      for (let i = 0; i < 20 && alive(parsed.sidecarPid); i++) await sleep(500);
      if (alive(parsed.sidecarPid)) {
        problems.push(`the JVM (pid ${parsed.sidecarPid}) outlived the app by 10s`);
        try {
          process.kill(parsed.sidecarPid, 'SIGKILL');
        } catch {
          /* gone after all */
        }
      }
    }
    for (const file of walk(parsed.logsDir)) {
      if (fs.readFileSync(file, 'utf8').includes('shutdown_timeout')) {
        problems.push(`the shutdown overran its deadline (shutdown_timeout in ${path.basename(file)})`);
      }
    }
  }
  if (problems.length > 0) {
    const tail = output.trim().split('\n').slice(-25).join('\n      | ');
    if (tail) log(`      | ${tail}`);
  }
  return { seconds, problems };
}

/** Two launches against one fresh profile: a cold start, then a restart that must find the first one's data. */
async function smoke(subject) {
  log(`\n▶ ${subject.label}\n    ${subject.command}`);
  const profile = path.join(work, `${subject.id}-profile`);
  const results = [];
  for (const number of [1, 2]) {
    log(`    launch ${number}`);
    const result = await launch(subject, number, profile);
    results.push(result);
    for (const problem of result.problems) failures.push(`${subject.label}, launch ${number}: ${problem}`);
    if (result.problems.length > 0) break;
  }
  const ok = results.every((r) => r.problems.length === 0);
  summary.push(`| ${subject.label} | ${ok ? '✅' : '❌'} | ${results.map((r) => `${r.seconds}s`).join(' / ')} |`);
}

function artifact(name) {
  const file = path.join(RELEASE_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`${name} was not built`);
  return file;
}
function findExecutable(dir, name) {
  return walk(dir).find((file) => path.basename(file) === name) ?? null;
}

/** The ways a user gets this app onto this OS, each turned into something to launch. */
function installedSubjects() {
  if (!version) throw new Error('--installed needs --version, to find the artifacts by their release names');
  const names = expectedArtifacts(version, platform, arch);
  const subjects = [];
  const cleanups = [];

  if (platform === 'win32') {
    const [installer, portable, zip] = names.map(artifact);
    const dir = path.join(work, 'installed');
    // NSIS takes /D unquoted and last, so the path must not contain spaces.
    if (/\s/.test(dir)) throw new Error(`the scratch path has spaces, which NSIS /D cannot take: ${dir}`);
    subjects.push({
      id: 'installer',
      label: `installer (${path.basename(installer)})`,
      prepare: () => {
        run(installer, ['/S', '/currentuser', `/D=${dir}`], { windowsVerbatimArguments: true, timeout: 300_000 });
        return path.join(dir, `${PRODUCT_NAME}.exe`);
      },
    });
    cleanups.push(() => {
      const uninstaller = path.join(dir, `Uninstall ${PRODUCT_NAME}.exe`);
      if (fs.existsSync(uninstaller)) run(uninstaller, ['/S', '/currentuser', `_?=${dir}`], { windowsVerbatimArguments: true, timeout: 120_000 });
    });
    subjects.push({
      id: 'portable',
      label: `portable (${path.basename(portable)})`,
      // The self-extractor waits for the app, but what it exits with is its own business.
      exitCodeUnreliable: true,
      prepare: () => portable,
    });
    subjects.push({
      id: 'zip',
      label: `zip (${path.basename(zip)})`,
      prepare: () => {
        const out = path.join(work, 'zip');
        fs.mkdirSync(out, { recursive: true });
        const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        run(tar, ['-xf', zip, '-C', out]);
        return findExecutable(out, `${PRODUCT_NAME}.exe`);
      },
    });
  } else if (platform === 'darwin') {
    const [dmg, zip] = names.map(artifact);
    subjects.push({
      id: 'dmg',
      label: `dmg (${path.basename(dmg)})`,
      prepare: () => {
        const mount = path.join(work, 'dmg-mount');
        const apps = path.join(work, 'dmg-apps');
        fs.mkdirSync(apps, { recursive: true });
        run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
        try {
          run('ditto', [path.join(mount, `${PRODUCT_NAME}.app`), path.join(apps, `${PRODUCT_NAME}.app`)]);
        } finally {
          run('hdiutil', ['detach', mount, '-force']);
        }
        return executable(path.join(apps, `${PRODUCT_NAME}.app`), platform);
      },
    });
    subjects.push({
      id: 'zip',
      label: `zip (${path.basename(zip)})`,
      prepare: () => {
        const out = path.join(work, 'zip');
        run('ditto', ['-x', '-k', zip, out]);
        return executable(path.join(out, `${PRODUCT_NAME}.app`), platform);
      },
    });
  } else {
    const [appImage, deb, tarball] = names.map(artifact);
    subjects.push({
      id: 'appimage',
      label: `AppImage (${path.basename(appImage)})`,
      // Extract-and-run: the AppImage's own AppRun and payload, without FUSE,
      // which CI runners (and some desktops) do not have.
      env: { APPIMAGE_EXTRACT_AND_RUN: '1' },
      prepare: () => {
        fs.chmodSync(appImage, 0o755);
        return appImage;
      },
    });
    const packageName = run('dpkg-deb', ['-f', deb, 'Package']).trim();
    subjects.push({
      id: 'deb',
      label: `deb (${path.basename(deb)})`,
      prepare: () => {
        run('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', path.resolve(deb)], { timeout: 600_000 });
        return path.join('/opt', PRODUCT_NAME, LINUX_EXECUTABLE);
      },
    });
    cleanups.push(() => run('sudo', ['apt-get', 'remove', '-y', packageName], { timeout: 300_000 }));
    subjects.push({
      id: 'tarball',
      label: `tar.gz (${path.basename(tarball)})`,
      prepare: () => {
        const out = path.join(work, 'tarball');
        fs.mkdirSync(out, { recursive: true });
        run('tar', ['-xzf', tarball, '-C', out]);
        return findExecutable(out, LINUX_EXECUTABLE);
      },
    });
  }
  return { subjects, cleanups };
}

// --- main -------------------------------------------------------------------

const subjects = [];
const cleanups = [];
const appRoot = unpackedDir(platform, arch);
if (fs.existsSync(appRoot)) {
  subjects.push({ id: 'unpacked', label: `unpacked (${path.relative(RELEASE_DIR, appRoot)})`, prepare: () => executable(appRoot, platform) });
} else if (!has('--installed')) {
  failures.push(`no unpacked ${platform}-${arch} app at ${appRoot}`);
}
if (has('--installed')) {
  try {
    const installed = installedSubjects();
    subjects.push(...installed.subjects);
    cleanups.push(...installed.cleanups);
  } catch (error) {
    failures.push(error.message);
  }
}

log(`Smoke-testing ${subjects.length} ${platform}-${arch} subject(s); scratch ${work}`);
for (const subject of subjects) {
  let command;
  try {
    command = subject.prepare();
    if (!command || !fs.existsSync(command)) throw new Error(`nothing to launch (${command ?? 'executable not found'})`);
  } catch (error) {
    failures.push(`${subject.label}: could not be installed or unpacked — ${error.message}`);
    summary.push(`| ${subject.label} | ❌ | install failed |`);
    continue;
  }
  await smoke({ ...subject, command });
}

for (const cleanup of cleanups) {
  try {
    cleanup();
  } catch (error) {
    log(`  (cleanup: ${error.message})`);
  }
}

const table = [`### Smoke test — ${platform}-${arch}`, '', '| Subject | Result | Launch 1 / 2 |', '|---|---|---|', ...summary].join('\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n\n`);

if (!has('--keep')) fs.rmSync(work, { recursive: true, force: true });
else log(`\nKept ${work}`);

if (failures.length > 0) {
  console.error(`\nThe ${platform}-${arch} packages did not pass:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
log(`\nOK — ${subjects.length} subject(s) launched twice, checked themselves and quit cleanly.`);
