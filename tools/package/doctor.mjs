#!/usr/bin/env node
/**
 * Is this machine ready to run, build or package CS3 — and if not, what exactly
 * is missing and how is it fixed?
 *
 * The two messages a fresh checkout produced most were
 *
 *   Extension sidecar (cs3-sidecar.jar) is missing.
 *   The extension runtime is not provisioned. Click "Install Required Components" …
 *
 * and the second was advice that could not work: that button downloads a Java
 * runtime and copies build outputs, but it cannot *build* the sidecar jar —
 * Maven does, and nothing ran Maven before `bun run dev`. This script is the
 * thing that does, in the order AGENTS.md §3 says is load-bearing, and it says
 * what it could not do in a sentence with the command that does it.
 *
 *   node tools/package/doctor.mjs          # report only
 *   node tools/package/doctor.mjs --fix    # fix what can be fixed (bun run setup)
 *   node tools/package/doctor.mjs --dev    # before `bun run dev` (predev)
 *   node tools/package/doctor.mjs --build  # before `bun run build` (prebuild)
 *   node tools/package/doctor.mjs --dist   # before packaging (preelectron:build)
 *
 * What it will change on its own: `desktop/node_modules` (an install), the
 * Electron binary inside it, and the jars under `sidecar/` (a Maven build) —
 * all inside this checkout, all re-creatable. What it asks first: downloading a
 * JDK (~190 MB) or Maven (~10 MB) into `tools/toolchain/`, which is gitignored
 * and is where the app, the sidecar supervisor and the packager already look
 * before anything else. It never installs anything system-wide, never needs
 * administrator rights and never edits PATH or JAVA_HOME; for those it prints
 * the command.
 *
 * `build-installer.mjs` imports `runDoctor` as its preflight, so the checks are
 * the same whichever way a build starts.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
const APP = path.join(ROOT, 'desktop');
const SIDECAR = path.join(ROOT, 'sidecar');
const TOOLCHAIN = path.join(ROOT, 'tools', 'toolchain');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const REQUIRED_NODE = 20;
const REQUIRED_JAVA = 21;
/** Pinned, and verified against Apache's published SHA-512 before unpacking. */
const MAVEN_VERSION = '3.9.9';

// ── small helpers ────────────────────────────────────────────────────────────

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = color(32);
const red = color(31);
const yellow = color(33);
const bold = color(1);
const dim = color(2);

/** `shell` only for a .cmd/.bat shim — cmd.exe splits an unquoted path on spaces. */
function exec(command, args, options = {}) {
  const shell = isWindows && /\.(cmd|bat)$/i.test(command);
  return spawnSync(shell && /\s/.test(command) ? `"${command}"` : command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: options.stdio ?? 'pipe',
    encoding: 'utf8',
    shell: shell || options.shell,
    env: options.env ?? process.env,
    timeout: options.timeout,
  });
}

function onPath(command) {
  const probe = isWindows ? exec('where', [command]) : exec('sh', ['-c', `command -v ${command}`]);
  if (probe.status !== 0) return null;
  return (probe.stdout ?? '').split(/\r?\n/).find(Boolean)?.trim() ?? null;
}

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
    if (child.isDirectory() && ['node_modules', 'target', 'dist', '.git'].includes(child.name)) continue;
    newest = Math.max(newest, newestMtime(path.join(entry, child.name)));
  }
  return newest;
}

function toolchainDirs(prefix) {
  if (!fs.existsSync(TOOLCHAIN)) return [];
  return fs
    .readdirSync(TOOLCHAIN)
    .filter((entry) => entry.toLowerCase().startsWith(prefix))
    .sort()
    .reverse()
    .map((entry) => path.join(TOOLCHAIN, entry));
}

// ── Java and Maven, resolved the way the app and the packager resolve them ──

function javaVersionOf(javaExe) {
  const probe = exec(javaExe, ['-version']);
  const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(banner);
  if (!match) return null;
  // Java 8 and older report "1.8"; anything that old is simply too old.
  return Number(match[1]) === 1 ? Number(match[2]) : Number(match[1]);
}

function javaHomeOf(javaExe) {
  const probe = exec(javaExe, ['-XshowSettings:properties', '-version']);
  const home = /java\.home = (.+)/.exec(`${probe.stdout ?? ''}${probe.stderr ?? ''}`)?.[1]?.trim();
  return home || null;
}

/**
 * Same order as `SidecarSupervisor.resolveJava` / `RuntimeProvisioner`:
 * `tools/toolchain/jdk-*` first (an ordinary machine's JAVA_HOME is very often
 * Java 17, which used to break everything silently), then JAVA_HOME, then PATH.
 * A JDK is required here, not a JRE — the sidecar is compiled — so `javac` must
 * sit beside `java`.
 */
export function findJdk() {
  const exe = isWindows ? 'java.exe' : 'java';
  const javac = isWindows ? 'javac.exe' : 'javac';
  const candidates = [
    ...toolchainDirs('jdk').map((home) => ({ home, source: path.relative(ROOT, home) })),
    ...(process.env.JAVA_HOME ? [{ home: process.env.JAVA_HOME, source: 'JAVA_HOME' }] : []),
  ];
  const seen = [];
  for (const candidate of candidates) {
    const java = path.join(candidate.home, 'bin', exe);
    if (!fs.existsSync(java)) continue;
    const version = javaVersionOf(java);
    seen.push({ ...candidate, version, java });
    if (version && version >= REQUIRED_JAVA && fs.existsSync(path.join(candidate.home, 'bin', javac))) {
      return { javaHome: candidate.home, java, version, source: candidate.source, seen };
    }
  }
  const onPathJava = onPath('java');
  if (onPathJava) {
    const version = javaVersionOf(onPathJava);
    seen.push({ home: null, source: 'PATH', version, java: onPathJava });
    if (version && version >= REQUIRED_JAVA && onPath('javac')) {
      return { javaHome: javaHomeOf(onPathJava), java: onPathJava, version, source: 'PATH', seen };
    }
  }
  return { javaHome: null, java: null, version: null, source: null, seen };
}

/** `tools/toolchain/apache-maven-*` first, then PATH (`mvn.cmd` on Windows). */
export function findMaven() {
  const names = isWindows ? ['mvn.cmd', 'mvn.bat', 'mvn'] : ['mvn'];
  for (const dir of toolchainDirs('apache-maven')) {
    for (const name of names) {
      const candidate = path.join(dir, 'bin', name);
      if (fs.existsSync(candidate)) return { mvn: candidate, source: path.relative(ROOT, dir) };
    }
  }
  // Asked for by its full name: on Windows `where mvn` can answer with Maven's
  // extensionless shell script, which cannot be spawned there.
  for (const name of isWindows ? ['mvn.cmd', 'mvn.bat'] : names) {
    const found = onPath(name);
    if (found) return { mvn: found, source: 'PATH' };
  }
  return { mvn: null, source: null };
}

function mavenEnv(jdk) {
  return { ...process.env, ...(jdk?.javaHome ? { JAVA_HOME: jdk.javaHome } : {}) };
}

// ── downloads into tools/toolchain ───────────────────────────────────────────

function platformKey() {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x64' : null;
  const osName = isWindows ? 'windows' : isMac ? 'macos' : process.platform === 'linux' ? 'linux' : null;
  return arch && osName ? { arch, osName } : null;
}

/**
 * curl first: it honours HTTPS_PROXY and the system's certificate store, both
 * of which Node's own fetch ignores, and it ships with Windows 10+, macOS and
 * almost every Linux. fetch is the fallback for the machine without it.
 */
async function download(url, target, log) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (onPath('curl')) {
    log(dim(`downloading ${url}`));
    const result = spawnSync('curl', ['-fL', '--retry', '2', '--connect-timeout', '20', '--progress-bar', '-o', target, url], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (result.status === 0) return;
    throw new Error(`curl could not download ${url} (exit ${result.status})`);
  }
  log(dim(`downloading ${url}`));
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function fetchText(url) {
  if (onPath('curl')) {
    const result = exec('curl', ['-fsSL', '--connect-timeout', '20', url]);
    if (result.status === 0) return result.stdout;
    throw new Error(`could not read ${url}`);
  }
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

function hashFile(file, algorithm) {
  return crypto.createHash(algorithm).update(fs.readFileSync(file)).digest('hex');
}

function unpack(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10+ ships a libarchive `tar` in System32 that reads zip; a Git
  // Bash GNU tar earlier on PATH does not, so it is named explicitly.
  const tar = isWindows
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const result = exec(tar, ['-xf', archive, '-C', dest]);
  if (result.status !== 0) throw new Error(`could not unpack ${path.basename(archive)}: ${result.stderr || result.status}`);
}

/**
 * A scratch directory *inside* tools/toolchain, so the final move is a rename
 * on one filesystem rather than a copy across from the OS temp directory.
 */
function stagingDir() {
  fs.mkdirSync(TOOLCHAIN, { recursive: true });
  return fs.mkdtempSync(path.join(TOOLCHAIN, '.download-'));
}

/** Moves the one directory an archive unpacked into to `tools/toolchain/<name>`. */
function settle(staging, finalName) {
  const [top] = fs.readdirSync(staging);
  if (!top) throw new Error('the archive was empty');
  let home = path.join(staging, top);
  // macOS JDKs are bundles: the JDK itself is Contents/Home.
  if (fs.existsSync(path.join(home, 'Contents', 'Home', 'bin'))) home = path.join(home, 'Contents', 'Home');
  const target = path.join(TOOLCHAIN, finalName ?? top);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(home, target);
  return target;
}

/** Amazon Corretto 21 — the same vendor the app downloads its runtime from. */
async function installJdk(log) {
  const key = platformKey();
  if (!key) throw new Error(`no JDK download is known for ${process.platform}/${process.arch}`);
  const ext = isWindows ? 'zip' : 'tar.gz';
  const name = `amazon-corretto-${REQUIRED_JAVA}-${key.arch}-${key.osName}-jdk.${ext}`;
  const work = stagingDir();
  try {
    const archive = path.join(work, name);
    const expected = (await fetchText(`https://corretto.aws/downloads/latest_sha256/${name}`)).trim().split(/\s+/)[0];
    await download(`https://corretto.aws/downloads/latest/${name}`, archive, log);
    const actual = hashFile(archive, 'sha256');
    if (!/^[0-9a-f]{64}$/i.test(expected) || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`the JDK download did not match its published SHA-256 (got ${actual})`);
    }
    const staging = path.join(work, 'unpacked');
    unpack(archive, staging);
    // Named jdk-* so every resolver in the repo finds it.
    const settled = settle(staging, `jdk-${REQUIRED_JAVA}-corretto`);
    log(green(`installed ${path.relative(ROOT, settled)}`));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function installMaven(log) {
  const name = `apache-maven-${MAVEN_VERSION}-bin.${isWindows ? 'zip' : 'tar.gz'}`;
  const base = `https://archive.apache.org/dist/maven/maven-3/${MAVEN_VERSION}/binaries/${name}`;
  const work = stagingDir();
  try {
    const archive = path.join(work, name);
    const expected = (await fetchText(`${base}.sha512`)).trim().split(/\s+/)[0];
    await download(base, archive, log);
    const actual = hashFile(archive, 'sha512');
    if (!/^[0-9a-f]{128}$/i.test(expected) || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error('the Maven download did not match its published SHA-512');
    }
    const staging = path.join(work, 'unpacked');
    unpack(archive, staging);
    const settled = settle(staging);
    if (!isWindows) fs.chmodSync(path.join(settled, 'bin', 'mvn'), 0o755);
    log(green(`installed ${path.relative(ROOT, settled)}`));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ── the checks ───────────────────────────────────────────────────────────────

const JDK_HINT = isWindows
  ? 'winget install Amazon.Corretto.21.JDK   (or any JDK 21+, then set JAVA_HOME to it)'
  : isMac
    ? 'brew install --cask corretto@21   (or any JDK 21+)'
    : 'sudo apt install openjdk-21-jdk   (or your distribution\'s JDK 21+ package)';
const MAVEN_HINT = isWindows
  ? 'winget install Apache.Maven   (or unpack Maven into tools/toolchain/apache-maven-*)'
  : isMac
    ? 'brew install maven'
    : 'sudo apt install maven   (or unpack Maven into tools/toolchain/apache-maven-*)';

function missingDependencies() {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const wanted = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  return wanted.filter((name) => !fs.existsSync(path.join(APP, 'node_modules', name, 'package.json')));
}

function electronBinaryPresent() {
  const dir = path.join(APP, 'node_modules', 'electron');
  const pathTxt = path.join(dir, 'path.txt');
  if (!fs.existsSync(pathTxt)) return false;
  const relative = fs.readFileSync(pathTxt, 'utf8').trim();
  return Boolean(relative) && fs.existsSync(path.join(dir, 'dist', relative));
}

const sidecarJar = path.join(SIDECAR, 'target', 'cs3-sidecar.jar');
const runtimeDir = path.join(SIDECAR, 'runtime');

function runtimeJars() {
  const files = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : [];
  return {
    libraryJvm: files.some((f) => f.startsWith('library-jvm') && f.endsWith('.jar')),
    bridge: files.includes('cs3-provider-bridge.jar'),
  };
}

/**
 * Each check says what it found, whether that blocks the current mode, and —
 * when it can — how to fix it: `safe` fixes stay inside this checkout and run
 * on their own when fixing; `confirm` fixes download a toolchain and are asked
 * about first.
 */
function buildChecks(ctx) {
  return [
    {
      id: 'node',
      label: `Node.js ${REQUIRED_NODE}+`,
      modes: ['check', 'setup', 'dev', 'build', 'dist'],
      inspect() {
        const major = Number(process.versions.node.split('.')[0]);
        return major >= REQUIRED_NODE
          ? { ok: true, detail: `Node ${process.versions.node}` }
          : { ok: false, detail: `Node ${process.versions.node} is too old` };
      },
      hint: isWindows ? 'winget install OpenJS.NodeJS.LTS' : 'Install Node 20 or newer from https://nodejs.org',
    },
    {
      id: 'deps',
      label: 'App dependencies (desktop/node_modules)',
      modes: ['check', 'setup', 'dev', 'build', 'dist'],
      inspect() {
        if (!fs.existsSync(path.join(APP, 'node_modules'))) return { ok: false, detail: 'not installed' };
        const missing = missingDependencies();
        return missing.length === 0
          ? { ok: true, detail: 'installed' }
          : { ok: false, detail: `missing ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}` };
      },
      fix: {
        kind: 'safe',
        describe: () => (onPath('bun') ? 'bun install' : 'npm install --no-package-lock'),
        run() {
          // bun.lock is the lockfile. Without Bun, npm installs without
          // writing a package-lock.json beside it.
          const [command, args] = onPath('bun')
            ? ['bun', ['install']]
            : [isWindows ? 'npm.cmd' : 'npm', ['install', '--no-package-lock']];
          const result = exec(command, args, { cwd: APP, stdio: 'inherit' });
          if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
        },
      },
      hint: 'cd desktop && bun install   (Bun: https://bun.sh — npm install also works)',
    },
    {
      id: 'electron',
      label: 'Electron binary',
      modes: ['check', 'setup', 'dev'],
      inspect() {
        if (!fs.existsSync(path.join(APP, 'node_modules', 'electron'))) return { ok: false, detail: 'electron is not installed' };
        return electronBinaryPresent()
          ? { ok: true, detail: 'downloaded' }
          : { ok: false, detail: 'the package is installed but its binary was never downloaded' };
      },
      fix: {
        kind: 'safe',
        describe: () => 'node node_modules/electron/install.js',
        run() {
          const result = exec(process.execPath, ['--experimental-require-module', 'node_modules/electron/install.js'], {
            cwd: APP,
            stdio: 'inherit',
          });
          if (result.status !== 0) throw new Error('the Electron download failed');
        },
      },
      hint: 'cd desktop && node node_modules/electron/install.js',
    },
    {
      id: 'java',
      label: `Java ${REQUIRED_JAVA}+ JDK`,
      modes: ['check', 'setup', 'dev', 'dist'],
      needsJvm: true,
      inspect() {
        const jdk = findJdk();
        ctx.jdk = jdk;
        if (jdk.java) return { ok: true, detail: `Java ${jdk.version} (${jdk.source})` };
        const tooOld = jdk.seen.find((s) => s.version && s.version < REQUIRED_JAVA);
        return {
          ok: false,
          detail: tooOld
            ? `found Java ${tooOld.version} at ${tooOld.source}; the sidecar needs ${REQUIRED_JAVA}+ (class file 65)`
            : 'no JDK found in tools/toolchain, JAVA_HOME or PATH',
        };
      },
      fix: {
        kind: 'confirm',
        describe: () => `download Amazon Corretto ${REQUIRED_JAVA} (~190 MB) into tools/toolchain/`,
        run: (log) => installJdk(log),
      },
      hint: JDK_HINT,
    },
    {
      id: 'maven',
      label: 'Maven',
      modes: ['check', 'setup', 'dev', 'dist'],
      needsJvm: true,
      inspect() {
        const maven = findMaven();
        ctx.maven = maven;
        return maven.mvn ? { ok: true, detail: `${maven.source}` } : { ok: false, detail: 'mvn not found in tools/toolchain or PATH' };
      },
      fix: {
        kind: 'confirm',
        describe: () => `download Apache Maven ${MAVEN_VERSION} (~10 MB) into tools/toolchain/`,
        run: (log) => installMaven(log),
      },
      hint: MAVEN_HINT,
    },
    {
      id: 'sidecar',
      label: 'Extension sidecar (sidecar/target/cs3-sidecar.jar)',
      modes: ['check', 'setup', 'dev'],
      needsJvm: true,
      inspect() {
        if (!fs.existsSync(sidecarJar)) return { ok: false, detail: 'not built — extensions cannot run without it' };
        const built = fs.statSync(sidecarJar).mtimeMs;
        const stale = [path.join(SIDECAR, 'src'), path.join(SIDECAR, 'pom.xml')].some((input) => newestMtime(input) > built);
        return stale ? { ok: false, detail: 'older than its sources — rebuild it' } : { ok: true, detail: 'built and current' };
      },
      fix: {
        kind: 'safe',
        requires: ['java', 'maven'],
        describe: () => 'mvn -f sidecar/pom.xml package -DskipTests',
        run() {
          const result = exec(ctx.maven.mvn, ['-q', '-f', path.join(SIDECAR, 'pom.xml'), 'package', '-DskipTests'], {
            stdio: 'inherit',
            env: mavenEnv(ctx.jdk),
          });
          if (result.status !== 0) throw new Error('the sidecar build failed (see the Maven output above)');
        },
      },
      hint: 'cd desktop && bun run setup   (builds it with Maven)',
    },
    {
      id: 'runtime',
      label: 'Provider runtime (sidecar/runtime: library-jvm + bridge)',
      modes: ['check', 'setup', 'dev'],
      needsJvm: true,
      inspect() {
        const { libraryJvm, bridge } = runtimeJars();
        if (!libraryJvm) return { ok: false, detail: 'library-jvm is missing' };
        if (!bridge) return { ok: false, detail: 'cs3-provider-bridge.jar is missing' };
        // Both are vendored. Only the bridge's own sources make it stale here;
        // the packager also rebuilds it after a sidecar change.
        const bridgeBuilt = fs.statSync(path.join(runtimeDir, 'cs3-provider-bridge.jar')).mtimeMs;
        const stale = [path.join(SIDECAR, 'bridge', 'src'), path.join(SIDECAR, 'bridge', 'pom.xml')].some(
          (input) => newestMtime(input) > bridgeBuilt,
        );
        return stale ? { ok: false, detail: 'the bridge is older than its sources' } : { ok: true, detail: 'present' };
      },
      fix: {
        kind: 'safe',
        requires: ['java', 'maven', 'sidecar'],
        describe: () => 'mvn runtime-deps (if needed), then the bridge',
        run(log) {
          const env = mavenEnv(ctx.jdk);
          if (!runtimeJars().libraryJvm) {
            const deps = exec(ctx.maven.mvn, ['-q', '-f', path.join(SIDECAR, 'runtime-deps', 'pom.xml'), 'package'], { stdio: 'inherit', env });
            if (deps.status !== 0) throw new Error('resolving library-jvm failed (it comes from jitpack.io, which some networks block)');
          }
          const bridge = exec(ctx.maven.mvn, ['-q', '-f', path.join(SIDECAR, 'bridge', 'pom.xml'), 'package'], { stdio: 'inherit', env });
          if (bridge.status !== 0) {
            log('the Maven build of the bridge failed; compiling it against sidecar/runtime instead');
            const fallback = exec(process.execPath, [path.join(here, 'build-bridge.mjs')], { stdio: 'inherit', env });
            if (fallback.status !== 0) throw new Error('the provider bridge could not be built');
          }
        },
      },
      hint: 'node tools/package/build-bridge.mjs   (or mvn -f sidecar/bridge/pom.xml package)',
    },
    {
      id: 'tar',
      label: 'Archive extractor (System32\\tar.exe)',
      modes: ['dist'],
      needsMedia: true,
      platforms: ['win32'],
      inspect() {
        const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        return fs.existsSync(tar) ? { ok: true, detail: 'present' } : { ok: false, detail: 'missing — mpv ships as .7z' };
      },
      hint: 'Windows 10 1803+ includes it; otherwise install 7-Zip and put 7z on PATH',
    },
  ];
}

// ── running them ─────────────────────────────────────────────────────────────

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
    return /^y(es)?$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
}

/**
 * @param {object} options
 * @param {'check'|'setup'|'dev'|'build'|'dist'} options.mode
 * @param {boolean} [options.assumeYes]  answer yes to toolchain downloads
 * @param {boolean} [options.skipJvm]    packaging without extensions: no Java/Maven needed
 * @param {boolean} [options.skipMedia]
 * @param {(line: string, meta?: { routine?: boolean }) => void} [options.log]
 * @returns {Promise<{ ok: boolean, javaHome: string|null, mvn: string|null, problems: string[] }>}
 */
export async function runDoctor({ mode = 'check', assumeYes = false, skipJvm = false, skipMedia = false, log = (line) => console.log(`    ${line}`) } = {}) {
  const ctx = { jdk: null, maven: null };
  const fixing = mode !== 'check';
  // `dev` never stops for a question: it runs on every `bun run dev`, and a
  // prompt there is a prompt every time someone says no.
  const interactive = mode !== 'dev' && process.stdin.isTTY && process.stdout.isTTY;
  // In dev the app still runs without extensions, so JVM gaps warn rather than block.
  const blocking = (check) => !(mode === 'dev' && check.needsJvm);

  let checks = buildChecks(ctx).filter(
    (check) =>
      check.modes.includes(mode) &&
      (!check.platforms || check.platforms.includes(process.platform)) &&
      !(skipJvm && check.needsJvm) &&
      !(skipMedia && check.needsMedia),
  );

  // In dev, a JDK and Maven are only needed to *build* the jars — the app
  // provisions its own Java to run them — so with both jars current they are
  // not worth a line on every start.
  if (mode === 'dev') {
    const jarsCurrent = checks.filter((check) => check.id === 'sidecar' || check.id === 'runtime').every((check) => check.inspect().ok);
    if (jarsCurrent) checks = checks.filter((check) => check.id !== 'java' && check.id !== 'maven');
  }

  const state = new Map();
  const problems = [];
  const warnings = [];

  for (const check of checks) {
    let result = check.inspect();
    let fixed = false;

    if (!result.ok && fixing && check.fix) {
      const unmet = (check.fix.requires ?? []).filter((id) => !state.get(id)?.ok);
      let allowed = check.fix.kind === 'safe';
      if (check.fix.kind === 'confirm' && unmet.length === 0) {
        if (assumeYes) allowed = true;
        else if (interactive) {
          log(`${yellow('!')} ${check.label}: ${result.detail}`);
          allowed = await ask(`    Fix it now — ${check.fix.describe()}?`);
        }
      }
      if (allowed && unmet.length === 0) {
        log(`${yellow('…')} ${check.label}: ${result.detail} — running ${check.fix.describe()}`);
        try {
          await check.fix.run(log);
        } catch (error) {
          log(red(`  ${error instanceof Error ? error.message : String(error)}`));
        }
        // Re-inspected rather than assumed: a fix that exited 0 and changed
        // nothing is the failure this whole script exists to name.
        result = check.inspect();
        fixed = result.ok;
      }
    }

    state.set(check.id, result);
    if (result.ok) {
      // A routine pass is the one line a quiet run leaves out; a fix is not.
      log(`${green('✓')} ${check.label} ${dim(`— ${result.detail}`)}${fixed ? green(' (fixed)') : ''}`, { routine: !fixed });
      continue;
    }

    const isBlocking = blocking(check);
    log(`${isBlocking ? red('✗') : yellow('!')} ${check.label} — ${result.detail}`);
    const fixLine =
      check.fix && check.fix.kind === 'confirm'
        ? `Fix: cd desktop && bun run setup   (${check.fix.describe()})`
        : null;
    if (fixLine) log(`    ${fixLine}`);
    log(`    ${fixLine ? 'Or: ' : 'Fix: '}${check.hint}`);
    (isBlocking ? problems : warnings).push(`${check.label}: ${result.detail}`);
  }

  if (mode === 'dev' && warnings.length > 0) {
    log(yellow('The app will start, but extensions will not run until the items marked ! are fixed:'));
    log(`    ${bold('cd desktop && bun run setup')}`);
  }

  return {
    ok: problems.length === 0,
    javaHome: ctx.jdk?.javaHome ?? null,
    mvn: ctx.maven?.mvn ?? null,
    problems,
  };
}

// ── command line ─────────────────────────────────────────────────────────────

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Check (and with --fix, prepare) the environment CS3 is developed and built in.

  (no flag)    report what is missing; change nothing
  --fix        install dependencies, build the sidecar, and offer to download a JDK/Maven
  --dev        what \`bun run dev\` needs; JVM gaps warn instead of failing
  --build      what \`bun run build\` needs
  --dist       what packaging needs
  --yes        download a JDK/Maven without asking (for scripts and CI)
  --skip-jvm   ignore Java, Maven and the sidecar
`);
    process.exit(0);
  }
  const mode = argv.includes('--fix')
    ? 'setup'
    : argv.includes('--dev')
      ? 'dev'
      : argv.includes('--build')
        ? 'build'
        : argv.includes('--dist')
          ? 'dist'
          : 'check';
  // Under predev/prebuild a clean report is noise: passing lines are dropped,
  // and the heading appears with the first line that is not one.
  const quiet = mode === 'dev' || mode === 'build';
  let headed = !quiet;
  if (!quiet) console.log(bold(`\nCS3 environment — ${mode}`));
  const report = await runDoctor({
    mode,
    assumeYes: argv.includes('--yes') || process.env.CS3_AUTO_INSTALL === '1',
    skipJvm: argv.includes('--skip-jvm'),
    log: (line, meta) => {
      if (quiet && meta?.routine) return;
      if (!headed) {
        console.log(bold(`\nCS3 environment — ${mode}`));
        headed = true;
      }
      console.log(`    ${line}`);
    },
  });
  if (!report.ok) {
    console.error(red(`\nNot ready: ${report.problems.length} problem${report.problems.length === 1 ? '' : 's'} above.`));
    if (mode !== 'setup') console.error(`Run ${bold('cd desktop && bun run setup')} to fix what can be fixed automatically.`);
    process.exit(1);
  }
  if (!quiet) console.log(green('\nReady.'));
}
