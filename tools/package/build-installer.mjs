#!/usr/bin/env node
/**
 * One command that turns a checkout into a distributable Windows installer.
 *
 * The pieces have existed for a while and had to be run by hand, in an order
 * that is not guessable and whose failure is silent in the worst way: skip the
 * sidecar build and you ship an app with no extension capability at all, and
 * nothing about the package says so. `build-runtime.mjs` deliberately does not
 * run Maven — it verifies what Maven produced — so something above it has to
 * own the sequence. This is that thing.
 *
 * Order is load-bearing (AGENTS.md §3): the sidecar build emits the android
 * shim the bridge compiles against, runtime-deps puts library-jvm in place,
 * and the bridge needs both.
 *
 *   node tools/package/build-installer.mjs
 *   node tools/package/build-installer.mjs --fast        # reuse existing jars
 *   node tools/package/build-installer.mjs --target nsis
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const app = path.join(root, 'cs3_windows');
const toolchain = path.join(root, 'tools', 'toolchain');
const isWindows = process.platform === 'win32';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
function flagValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

if (has('--help') || has('-h')) {
  console.log(`Build a distributable Windows package.

  --clean               rebuild every stage, even one nothing has invalidated
  --fast                trust whatever is already staged, without checking it
  --quick               store the payload instead of compressing it (test builds)
  --target nsis|portable|both   default: both
  --skip-jvm            do not build the sidecar (the package will run no extensions)
  --skip-media          do not bundle ffmpeg/mpv (they are then fetched on first use)
  --allow-missing-media stage whatever media binaries are present instead of failing
  --skip-typecheck      skip \`tsc -b\`
`);
  process.exit(0);
}

const FAST = has('--fast');
const CLEAN = has('--clean');
const QUICK = has('--quick');
const SKIP_JVM = has('--skip-jvm');
const SKIP_MEDIA = has('--skip-media');
const SKIP_TYPECHECK = has('--skip-typecheck');
const ALLOW_MISSING_MEDIA = has('--allow-missing-media');
// nsis is the installer people expect; portable is the unzip-and-run copy.
// Both are cheap once the heavy staging is done, so both is the default.
const TARGETS = flagValue('--target', 'both');

let step = 0;
const started = Date.now();

/**
 * How long each stage took, printed at the end.
 *
 * "The build takes too long" is not actionable and "the media runtime took
 * 4m20s of a 6m build" is. It also makes a reused stage visibly free, which is
 * the evidence that the incremental checks are doing anything at all.
 */
const timings = [];
let stepStartedAt = Date.now();

function closeStep() {
  if (timings.length > 0) timings[timings.length - 1].ms = Date.now() - stepStartedAt;
}

function heading(text) {
  closeStep();
  step += 1;
  stepStartedAt = Date.now();
  timings.push({ label: text, ms: 0 });
  console.log(`\n\x1b[1m[${step}] ${text}\x1b[0m`);
}
function info(text) {
  console.log(`    ${text}`);
}
function die(message, hint) {
  console.error(`\n\x1b[31mBuild failed:\x1b[0m ${message}`);
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/**
 * Windows has no `mvn`; it has `mvn.cmd`, and spawnSync without a shell will
 * not find it. That exact ENOENT was once reported as "is mvn on PATH?" when
 * it was. Resolve the spellings explicitly, and prefer the checked-in
 * toolchain for the same reason SidecarSupervisor prefers the checked-in JDK:
 * an ordinary machine's JAVA_HOME is very often Java 17.
 */
function resolveTool(name, prefix) {
  if (!fs.existsSync(toolchain)) return null;
  const dirs = fs.readdirSync(toolchain).filter((e) => e.startsWith(prefix)).sort().reverse();
  const exts = isWindows ? ['.cmd', '.bat', '.exe', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(toolchain, dir, 'bin', name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const MVN = resolveTool('mvn', 'apache-maven') ?? (isWindows ? 'mvn.cmd' : 'mvn');
const JAVA_HOME_DIR = (() => {
  if (!fs.existsSync(toolchain)) return process.env.JAVA_HOME;
  const jdk = fs.readdirSync(toolchain).filter((e) => e.startsWith('jdk-')).sort().reverse()[0];
  return jdk ? path.join(toolchain, jdk) : process.env.JAVA_HOME;
})();

/**
 * `shell: true` is needed for a .cmd/.bat shim and is actively harmful for
 * anything else: cmd.exe splits an unquoted path on its spaces, so a plain
 * `C:\Program Files\nodejs\node.exe` runs as `C:\Program`. Ask for a shell only
 * where one is required, and quote the command when we do.
 */
function needsShell(command) {
  return isWindows && !/\.exe$/i.test(command);
}

function exec(command, args, options = {}) {
  const shell = needsShell(command);
  return spawnSync(shell && /[\s]/.test(command) ? `"${command}"` : command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
    shell,
    env: { ...process.env, ...(JAVA_HOME_DIR ? { JAVA_HOME: JAVA_HOME_DIR } : {}) },
  });
}

function run(command, args, options = {}) {
  const shown = `${path.basename(command)} ${args.join(' ')}`;
  info(`$ ${shown}`);
  const result = exec(command, args, options);
  if (result.error) die(`could not run ${shown}: ${result.error.message}`, options.hint);
  if (result.status !== 0) die(`${shown} exited with ${result.status}`, options.hint);
}

function node(script, args = [], options = {}) {
  run(process.execPath, [script, ...args], options);
}

/**
 * Resolve a local dev-dependency executable. bun and npm write different shims
 * for the same package - bun emits `tsc.exe`, npm emits `tsc.cmd` - so probing
 * one spelling reports a perfectly installed toolchain as missing, which is
 * exactly what a "run bun install" message sends the reader to do twice.
 */
function bin(name) {
  const dir = path.join(app, 'node_modules', '.bin');
  for (const ext of isWindows ? ['.exe', '.cmd', '.bat', ''] : ['']) {
    const candidate = path.join(dir, name + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function requireBin(name) {
  const resolved = bin(name);
  if (!resolved) {
    die(`${name} is not installed in cs3_windows/node_modules.`, 'Run: cd cs3_windows && bun install');
  }
  return resolved;
}

/**
 * The newest modification time under a path, or 0 for one that does not exist.
 *
 * Directories are walked, because a module's inputs are its whole source tree
 * and a jar that predates one edited file is stale however new the rest is.
 * `node_modules`, `target` and `dist` are skipped: they are outputs, and a tree
 * that includes its own output is newer than itself after every build.
 */
const IGNORED_DIRS = new Set(['node_modules', 'target', 'dist', '.git', 'release']);
function newestMtime(entry) {
  let stat;
  try {
    stat = fs.statSync(entry);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
    if (child.isDirectory() && IGNORED_DIRS.has(child.name)) continue;
    newest = Math.max(newest, newestMtime(path.join(entry, child.name)));
  }
  return newest;
}

/**
 * Whether a stage can be skipped, decided from the files rather than a flag.
 *
 * Reuse used to be `--fast` and nothing else, so the ordinary `dist:portable`
 * rebuilt the sidecar, re-resolved the provider classpath, recompiled the
 * bridge, relinked a JRE and **re-downloaded ~140 MB of ffmpeg and mpv** on
 * every run, however little had changed. A packaging script that repeats work
 * nobody invalidated is one people stop running.
 *
 * So the default is now incremental and the test is ordinary: every output
 * exists, and every one of them is newer than every input. `--clean` forces the
 * work; `--fast` skips the comparison and trusts whatever is on disk, which is
 * the right answer when the inputs are known-good and the clock is not (a fresh
 * clone checks out with today's timestamps).
 */
function upToDate(label, outputs, inputs = [], stamp = null) {
  const targets = [outputs].flat();
  if (CLEAN) return false;
  if (!targets.every((target) => fs.existsSync(target))) return false;
  if (stamp && !fs.existsSync(stamp)) return false;
  if (FAST) {
    info(`reusing ${label} (--fast)`);
    return true;
  }

  /*
   * With a stamp, that file *is* when the stage finished — which is the only
   * honest reading once a stage copies nothing it does not have to. Without
   * one, the oldest output is the conservative answer.
   */
  const built = stamp
    ? newestMtime(stamp)
    : Math.min(...targets.map((target) => newestMtime(target)));
  const changed = [inputs].flat().filter((input) => newestMtime(input) > built);
  if (changed.length > 0) {
    info(`rebuilding ${label} — ${path.relative(root, changed[0])} is newer`);
    return false;
  }
  info(`reusing ${label} (up to date)`);
  return true;
}

// ── 1. Preflight ─────────────────────────────────────────────────────────────
heading('Preflight');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) die(`Node ${process.versions.node} is too old; 20 or newer is required.`);
info(`node ${process.versions.node} on ${process.platform}/${process.arch}`);

if (!SKIP_JVM) {
  const javaExe = JAVA_HOME_DIR
    ? path.join(JAVA_HOME_DIR, 'bin', isWindows ? 'java.exe' : 'java')
    : 'java';
  const probe = exec(javaExe, ['-version'], { stdio: 'pipe', encoding: 'utf8' });
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const version = Number(/version "(\d+)/.exec(banner)?.[1] ?? 0);
  if (!version) {
    die(
      'no JDK was found.',
      'The sidecar is compiled to class file 65, so this needs Java 21 or newer.\n' +
        'Point JAVA_HOME at one, or drop a JDK into tools/toolchain/jdk-*.\n' +
        'To package without extension support, pass --skip-jvm.',
    );
  }
  if (version < 21) {
    die(
      `Java ${version} cannot build the sidecar (class file 65 needs 21 or newer).`,
      'tools/toolchain/jdk-* is preferred when present; otherwise point JAVA_HOME at a JDK 21.',
    );
  }
  info(`java ${version} (${JAVA_HOME_DIR ?? 'PATH'})`);
}

if (!fs.existsSync(path.join(app, 'node_modules'))) {
  die(
    'cs3_windows/node_modules is missing.',
    'Install the app dependencies first:\n    cd cs3_windows && bun install',
  );
}
for (const tool of ['electron-builder', 'vite', 'tsc']) requireBin(tool);

// ── The JVM side ─────────────────────────────────────────────────────────────
if (SKIP_JVM) {
  heading('Sidecar — skipped (--skip-jvm)');
  info('the package will have no extension capability');
} else {
  heading('Sidecar (android shim + cs3-sidecar.jar)');
  const sidecarJar = path.join(root, 'sidecar', 'target', 'cs3-sidecar.jar');
  if (!upToDate('the sidecar jar', sidecarJar, [
    path.join(root, 'sidecar', 'src'),
    path.join(root, 'sidecar', 'pom.xml'),
  ])) {
    run(MVN, ['-q', '-f', path.join(root, 'sidecar', 'pom.xml'), 'package', '-DskipTests']);
  }

  heading('Provider runtime classpath (library-jvm and its transitive runtime)');
  const runtimeDir = path.join(root, 'sidecar', 'runtime');
  const libraryJvm =
    (fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : []).find((f) =>
      f.startsWith('library-jvm'),
    );
  /*
   * The classpath is resolved from `runtime-deps/pom.xml` and from nothing else
   * — upstream declares every third-party version, so the only thing that can
   * change what lands in `sidecar/runtime/` is that file. Re-resolving it on an
   * unchanged pom is a jitpack round trip for 56 jars that are already there,
   * and jitpack is the flakiest dependency in this whole chain.
   */
  if (
    libraryJvm &&
    upToDate('sidecar/runtime', path.join(runtimeDir, libraryJvm), [
      path.join(root, 'sidecar', 'runtime-deps', 'pom.xml'),
    ])
  ) {
    /* nothing to do */
  } else {
    run(MVN, ['-q', '-f', path.join(root, 'sidecar', 'runtime-deps', 'pom.xml'), 'package'], {
      hint:
        'This resolves library-jvm from jitpack.io, which some networks cannot reach — the\n' +
        'failure then appears as a 403 on a POM with nothing about the build at fault.\n' +
        'The jars are vendored in sidecar/runtime/, so --fast will use those instead.',
    });
  }

  heading('Provider bridge (cs3-provider-bridge.jar)');
  const bridgeJar = path.join(runtimeDir, 'cs3-provider-bridge.jar');
  if (
    !upToDate('the bridge jar', bridgeJar, [
      path.join(root, 'sidecar', 'bridge', 'src'),
      path.join(root, 'sidecar', 'bridge', 'pom.xml'),
      // The bridge compiles against the shim, so a rebuilt sidecar invalidates it.
      sidecarJar,
    ])
  ) {
    // The pom is the reference; build-bridge.mjs compiles the same jar against
    // sidecar/runtime/ for sessions that cannot reach jitpack. Falling back is
    // a workaround for the network, not for the build.
    const viaMaven = exec(MVN, ['-q', '-f', path.join(root, 'sidecar', 'bridge', 'pom.xml'), 'package']);
    if (viaMaven.status !== 0) {
      info('the maven build of the bridge failed; falling back to build-bridge.mjs');
      node(path.join(root, 'tools', 'package', 'build-bridge.mjs'));
    }
    if (!fs.existsSync(bridgeJar)) die('cs3-provider-bridge.jar was not produced.');
  }

  heading('Staging sidecar/dist (sidecar + classpath + jlinked JRE)');
  // build-runtime clears sidecar/dist before relinking. On Windows a java.exe
  // from a previous verification or dev session still running against sidecar/dist
  // holds jre/bin/java.dll locked; terminate it before unlinking.
  if (isWindows) {
    try {
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Process -Name java -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*sidecar\\dist\\*" } | Stop-Process -Force',
        ],
        { timeout: 5000 }
      );
    } catch {
      // Best-effort
    }
  }

  const staged = path.join(root, 'sidecar', 'dist');
  /*
   * Relinking a JRE takes the better part of a minute and produces the same
   * ~90 MB tree whenever its inputs have not moved. The inputs are exactly the
   * two things copied into it plus the module list in `build-runtime.mjs`
   * itself — that list is curated, and a change to it (`jdk.crypto.ec` and
   * friends) has to relink or the package ships a JRE missing a module nothing
   * will notice until TLS fails site by site.
   */
  if (
    upToDate(
      'sidecar/dist',
      [
        path.join(staged, 'cs3-sidecar.jar'),
        path.join(staged, 'jre', 'bin', isWindows ? 'java.exe' : 'java'),
        path.join(staged, 'runtime'),
      ],
      [sidecarJar, runtimeDir, path.join(root, 'tools', 'package', 'build-runtime.mjs')],
      // Written last by build-runtime.mjs. The staged files themselves cannot
      // answer this: `copyDir` deliberately leaves a jar whose bytes are
      // already right untouched, so the oldest of them is older than the
      // inputs after every successful run, and the stage would restage — while
      // copying nothing — forever.
      path.join(staged, '.staged'),
    )
  ) {
    /* nothing to do */
  } else {
    node(path.join(root, 'tools', 'package', 'build-runtime.mjs'), ['--verify'], {
      hint:
        'An EPERM on jre/bin/java.dll means a java.exe from a previous verification is\n' +
        'still running. Close it, or rerun with --fast to reuse the staged copy.',
    });
  }
}

// ── Media runtime ────────────────────────────────────────────────────────────
if (SKIP_MEDIA) {
  heading('Media runtime — skipped (--skip-media)');
  info('ffmpeg and mpv will be fetched on first use, which is the worst configuration to ship');
} else {
  heading('Staging media runtime (ffmpeg, ffprobe, mpv)');
  // build-media-runtime re-fetches unconditionally, and its mirrors are the
  // flakiest dependency in the whole chain - a gyan.dev timeout would otherwise
  // fail a release build whose binaries are already staged and correct. Under
  // --fast, having all three on disk is the answer.
  const mediaDir = path.join(app, 'media-runtime');
  /*
   * ~140 MB over three mirrors, the flakiest dependency here and the slowest
   * step in the build. It is also the one whose inputs almost never move: the
   * component table lives in `build-media-runtime.mjs`, so that file is the
   * input, and the staged binaries are the output. `--clean` re-fetches; the
   * script's own archive cache means even that rarely touches the network.
   */
  if (
    upToDate(
      'cs3_windows/media-runtime',
      ['ffmpeg', 'ffprobe', 'mpv'].map((name) =>
        path.join(mediaDir, isWindows ? `${name}.exe` : name),
      ),
      [path.join(root, 'tools', 'package', 'build-media-runtime.mjs')],
    )
  ) {
    /* nothing to do */
  } else {
    node(
      path.join(root, 'tools', 'package', 'build-media-runtime.mjs'),
      ALLOW_MISSING_MEDIA ? ['--allow-missing'] : ['--verify'],
      {
        hint:
          'The ffmpeg and mpv mirrors are frequently unreachable. If cs3_windows/media-runtime\n' +
          'already holds ffmpeg, ffprobe and mpv, rerun with --fast to use them.',
      },
    );
  }
}

// ── Typecheck ────────────────────────────────────────────────────────────────
// Plain `tsc` on the solution-style root config is a no-op; `tsc -b` is the
// only spelling that gives a real signal (AGENTS.md §3).
if (SKIP_TYPECHECK) {
  heading('Typecheck — skipped (--skip-typecheck)');
} else {
  heading('Typecheck (tsc -b)');
  run(requireBin('tsc'), ['-b'], { cwd: app });
}

// ── Renderer + main bundle ───────────────────────────────────────────────────
heading('Building renderer and main process (vite)');
run(requireBin('vite'), ['build'], { cwd: app });

// The vendored Inter subsets exist so a packaged desktop app does not phone a
// third party on every launch. A stray @import would reintroduce that
// invisibly, so the built CSS is checked rather than trusted.
const assets = path.join(app, 'dist', 'assets');
if (fs.existsSync(assets)) {
  const leaks = fs
    .readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .filter((f) => /https:\/\/fonts\./.test(fs.readFileSync(path.join(assets, f), 'utf8')));
  if (leaks.length) {
    die(
      `the built CSS still fetches fonts from a third party: ${leaks.join(', ')}`,
      'Inter is vendored in src/assets/fonts. Remove the @import from src/index.css.',
    );
  }
  info('no third-party font requests in the built CSS');
}

// ── Package ──────────────────────────────────────────────────────────────────
heading(`Packaging for Windows (${TARGETS})`);
// electron-builder extracts Electron into release/win-unpacked.tmp and renames
// it into place. A run interrupted between those two steps leaves the .tmp
// behind, and the next rename then fails with EPERM naming a path that looks
// like a permissions problem and is really our own debris.
const releaseDir = path.join(app, 'release');
if (fs.existsSync(releaseDir)) {
  for (const entry of fs.readdirSync(releaseDir)) {
    if (!entry.endsWith('.tmp')) continue;
    info(`removing stale ${entry}`);
    fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
  }
}
const targets = TARGETS === 'both' ? ['nsis', 'portable'] : [TARGETS];
/**
 * `compression: maximum` is right for something people download and wrong for
 * something you are about to run once.
 *
 * Measured, portable, this tree: packaging is **304s of a 425s build** — every
 * other stage put together is under two minutes — and almost all of it is
 * squeezing a payload dominated by a jlinked JRE, ffmpeg and mpv. `--quick`
 * stores it instead. The artifact is larger and installs identically; what it
 * must never be is the thing shipped, so it is a flag rather than a default and
 * the report names it.
 */
if (QUICK) info('compression: store (--quick) — larger artifact, for testing rather than release');
run(
  requireBin('electron-builder'),
  ['--win', ...targets, '--publish', 'never', ...(QUICK ? ['-c.compression=store'] : [])],
  { cwd: app },
);

// ── Report ───────────────────────────────────────────────────────────────────
closeStep();
console.log(`\n\x1b[1mWhere the time went\x1b[0m`);
for (const entry of timings) {
  const seconds = entry.ms / 1000;
  console.log(`    ${seconds < 1 ? '  ~0s' : `${seconds.toFixed(0).padStart(4)}s`}  ${entry.label}`);
}

const produced = fs.existsSync(releaseDir)
  ? fs
      .readdirSync(releaseDir)
      .filter((f) => /\.(exe|msi)$/.test(f))
      .map((f) => ({ name: f, mb: (fs.statSync(path.join(releaseDir, f)).size / 1024 / 1024).toFixed(1) }))
  : [];

console.log(`\n\x1b[32mDone\x1b[0m in ${Math.round((Date.now() - started) / 1000)}s — ${releaseDir}`);
for (const file of produced) console.log(`    ${file.name}  (${file.mb} MB)`);
if (!produced.length) console.log('    (no installer found — check the electron-builder output above)');
if (SKIP_JVM) {
  console.log('\n\x1b[33mNote:\x1b[0m built with --skip-jvm — extensions will not work in this package.');
}
if (QUICK) {
  console.log('[33mNote:[0m built with --quick — the payload is stored, not compressed.');
}
if (SKIP_MEDIA) {
  console.log('\x1b[33mNote:\x1b[0m built with --skip-media — ffmpeg and mpv are not bundled.');
}
