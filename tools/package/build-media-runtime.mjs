#!/usr/bin/env node
/**
 * Puts the media engine in the box.
 *
 * The sidecar has shipped inside the app since `build-runtime.mjs` existed, for
 * a reason that applies word for word to playback and had never been applied to
 * it: the target user installs one thing and streams. They do not install a JVM
 * — and they should not install FFmpeg or mpv either.
 *
 * Until this script existed `extraResources` carried exactly one entry, the
 * sidecar, so a freshly installed app had **no ffprobe, no ffmpeg and no mpv**.
 * The consequences were not subtle:
 *
 * - no `ffprobe` → nothing can be inspected, so every stream is attached
 *   unclassified and the compatibility engine has nothing to decide from;
 * - no `ffmpeg` → no remux, no transcode, no embedded-subtitle extraction;
 * - no `mpv` → `MpvEngine.isAvailable()` is false, `shouldRouteToNativeEngine`
 *   returns false for every stream, and **the native engine is never used at
 *   all**. Every 4K HEVC file takes the software transcode path, which is the
 *   0.47x-realtime stall the engine exists to avoid.
 *
 * So the default install was the worst configuration the codebase can be in,
 * and the good one was opt-in behind a download the user had to find. This
 * script is the fix, and it is packaging rather than engineering.
 *
 *   node tools/package/build-media-runtime.mjs            # stage for this platform
 *   node tools/package/build-media-runtime.mjs --verify   # ...and run each binary
 *   node tools/package/build-media-runtime.mjs --allow-missing
 *
 * Output is `cs3_windows/media-runtime/`, which `electron-builder` copies to
 * `resources/media/` and `BinaryDownloader.resolveBinary` looks in first.
 *
 * **One platform per run, into one directory.** The script stages whichever
 * platform it is told about and `extraResources` points at a fixed path, so a
 * single build produces a single target. Cross-building all three in one pass
 * would need the output split per platform and the macro support in the builder
 * config to match; nothing does that today and pretending otherwise would ship
 * a Windows mpv inside a Linux package.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'cs3_windows', 'media-runtime');
const WORK_DIR = path.join(os.tmpdir(), 'cs3-media-runtime');

const args = process.argv.slice(2);
const VERIFY = args.includes('--verify');
const ALLOW_MISSING = args.includes('--allow-missing');
const platformArg = readFlag('--platform') ?? process.platform;
const archArg = readFlag('--arch') ?? process.arch;

function readFlag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

/**
 * Where each binary comes from, per platform.
 *
 * `members` maps a name we resolve at runtime to a predicate over the paths
 * inside the archive, because every publisher lays theirs out differently:
 * gyan and BtbN both nest the tools one directory down, under a versioned
 * folder and then `bin`, while the mpv Windows build puts `mpv.exe` at the
 * archive root beside `mpv.com`. Matching on a suffix rather than a full path
 * is what survives the version number changing.
 *
 * `extras` are files that are not themselves executables but without which the
 * executable does not run or does not print anything — mpv's `mpv.com` console
 * front-end being the one that bites: `mpv.exe` is a GUI-subsystem binary whose
 * stdout goes nowhere, so without `mpv.com` every `--version` and `--hwdec=help`
 * probe comes back empty and the engine reports itself as broken.
 */
const SOURCES = {
  'win32-x64': {
    ffmpeg: {
      required: true,
      archive: 'ffmpeg.zip',
      mirrors: [
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
      ],
      members: {
        'ffmpeg.exe': (p) => /(^|\/)bin\/ffmpeg\.exe$/i.test(p),
        'ffprobe.exe': (p) => /(^|\/)bin\/ffprobe\.exe$/i.test(p),
      },
    },
    mpv: {
      required: true,
      archive: 'mpv.7z',
      // Resolved from the GitHub release API when reachable; this is the floor.
      mirrors: [
        'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-08-18-e7191f2a65/mpv-x86_64-20260818-git-e7191f2a65.7z',
        'https://ghproxy.net/https://github.com/zhongfly/mpv-winbuild/releases/download/2026-08-18-e7191f2a65/mpv-x86_64-20260818-git-e7191f2a65.7z',
      ],
      release: 'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest',
      releaseAsset: (name) => /^mpv-x86_64-\d/.test(name) && !/debug|dev/.test(name),
      members: {
        'mpv.exe': (p) => /(^|\/)mpv\.exe$/i.test(p),
        // Not an executable we resolve; without it mpv prints nothing to stdout.
        'mpv.com': (p) => /(^|\/)mpv\.com$/i.test(p),
      },
      extras: ['mpv.com'],
    },
  },

  'linux-x64': {
    ffmpeg: {
      required: true,
      archive: 'ffmpeg.tar.xz',
      mirrors: [
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
      ],
      members: {
        ffmpeg: (p) => /(^|\/)bin\/ffmpeg$/.test(p),
        ffprobe: (p) => /(^|\/)bin\/ffprobe$/.test(p),
      },
    },
    /**
     * mpv is packaged by every Linux distribution, and the packaged build is
     * the one with that distribution's VA-API / VDPAU wiring. Shipping a
     * generic binary over it is how you end up with a player that cannot open
     * the GPU — so on Linux the app detects the system mpv rather than carrying
     * its own, and this is `required: false` deliberately rather than by
     * omission. A distribution package should declare `mpv` as a dependency;
     * that is the platform's own answer to "the user installs nothing".
     */
    mpv: { required: false, reason: 'use the distribution package (apt/dnf/pacman install mpv)' },
  },

  'darwin-x64': {
    ffmpeg: {
      required: true,
      archive: 'ffmpeg.zip',
      mirrors: ['https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip'],
      members: { ffmpeg: (p) => /(^|\/)ffmpeg$/.test(p) },
    },
    ffprobe: {
      required: true,
      archive: 'ffprobe.zip',
      mirrors: ['https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip'],
      members: { ffprobe: (p) => /(^|\/)ffprobe$/.test(p) },
    },
    mpv: { required: false, reason: 'ship the mpv.app bundle from mpv.io, or `brew install mpv`' },
  },
};

SOURCES['darwin-arm64'] = SOURCES['darwin-x64'];
SOURCES['linux-arm64'] = SOURCES['linux-x64'];

const key = `${platformArg}-${archArg}`;
const plan = SOURCES[key];
if (!plan) {
  fail(`No media runtime sources are defined for ${key}. Add them to SOURCES first.`);
}

// --- helpers ---------------------------------------------------------------

function fail(message) {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

function log(message) {
  console.log(`  ${message}`);
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, { encoding: 'utf8', ...options });
}

function has(command) {
  // An absolute path resolved for us (see bsdTar) is not something `where`
  // will find by name - ask the filesystem instead.
  if (path.isAbsolute(command)) return fs.existsSync(command);
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return run(probe, [command]).status === 0;
}

async function download(mirrors, target) {
  for (const url of mirrors) {
    try {
      log(`fetching ${url}`);
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'cloudstream-desktop-packager' },
      });
      if (!response.ok) {
        log(`  ${response.status} ${response.statusText}`);
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(target, bytes);
      log(`  ${(bytes.length / 1048576).toFixed(1)} MB`);
      return true;
    } catch (error) {
      log(`  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return false;
}

/**
 * Resolves the newest asset from a GitHub release, falling back to the pinned
 * mirrors. Pinned URLs go stale — the fallback exists so a build still works
 * when the API is rate-limited or unreachable, not as the normal path.
 */
async function resolveMirrors(component) {
  if (!component.release) return component.mirrors;
  try {
    const response = await fetch(component.release, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cloudstream-desktop-packager' },
    });
    if (response.ok) {
      const release = await response.json();
      const asset = (release.assets ?? []).find((candidate) =>
        component.releaseAsset(candidate.name ?? '')
      );
      if (asset?.browser_download_url) return [asset.browser_download_url, ...component.mirrors];
    }
  } catch {
    /* the pinned mirrors below are exactly for this */
  }
  return component.mirrors;
}

/**
 * Unpacks whatever the publisher chose to ship.
 *
 * `tar` is bsdtar on Windows and macOS and reads zip and 7z; on Linux it is GNU
 * tar and reads neither, so `unzip` and `7z` are tried first there. A build
 * machine that has none of them gets told which one to install rather than a
 * confusing extraction error.
 */
/**
 * Windows ships a libarchive `tar` in System32 that reads 7z; a Git or MSYS
 * install puts GNU tar - which does not - earlier on PATH. `has('tar')`
 * therefore answers yes for a binary that cannot open the archive, and the
 * mpv download fails with "install 7z or bsdtar" on a machine that has had a
 * capable extractor all along. Name the System32 copy explicitly.
 */
function bsdTar() {
  if (process.platform !== 'win32') return 'tar';
  const system32 = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe');
  return fs.existsSync(system32) ? system32 : 'tar';
}

function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const attempts = archive.endsWith('.tar.xz')
    ? [[bsdTar(), ['-xJf', archive, '-C', dest]]]
    : archive.endsWith('.7z')
      ? [
          ['7z', ['x', '-y', `-o${dest}`, archive]],
          ['7za', ['x', '-y', `-o${dest}`, archive]],
          [bsdTar(), ['-xf', archive, '-C', dest]],
        ]
      : [
          ['unzip', ['-qo', archive, '-d', dest]],
          [bsdTar(), ['-xf', archive, '-C', dest]],
        ];

  for (const [command, commandArgs] of attempts) {
    if (!has(command)) continue;
    const result = run(command, commandArgs);
    if (result.status === 0) return true;
  }
  fail(
    `Could not unpack ${path.basename(archive)}. Install one of: ` +
      (archive.endsWith('.7z') ? '7z, or bsdtar' : 'unzip, or bsdtar')
  );
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// --- staging ---------------------------------------------------------------

async function stage(name, component) {
  if (!component.required && !component.archive) {
    log(`${name}: not bundled on this platform — ${component.reason}`);
    return { name, staged: [], skipped: true };
  }

  const scratch = path.join(WORK_DIR, name);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  const archive = path.join(scratch, component.archive);
  const mirrors = await resolveMirrors(component);
  if (!(await download(mirrors, archive))) {
    return { name, staged: [], failed: `every mirror for ${name} was unreachable` };
  }

  const unpacked = path.join(scratch, 'x');
  extract(archive, unpacked);

  const files = walk(unpacked).map((full) => ({
    full,
    rel: path.relative(unpacked, full).split(path.sep).join('/'),
  }));

  const staged = [];
  for (const [target, matches] of Object.entries(component.members)) {
    const found = files.find((file) => matches(file.rel));
    if (!found) {
      return { name, staged, failed: `${target} was not found inside ${component.archive}` };
    }
    const destination = path.join(OUT_DIR, target);
    fs.copyFileSync(found.full, destination);
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);
    staged.push({ target, bytes: fs.statSync(destination).size });
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  return { name, staged };
}

/**
 * Runs each staged binary.
 *
 * A staged file is not a working one: an archive can unpack, the right name can
 * land in the right place, and the binary can still refuse to start for a
 * missing runtime DLL. `build-runtime.mjs --verify` exists for the same reason
 * on the JVM side, and the jlink module list is the precedent — a bundle that
 * builds is not a bundle that runs.
 */
function verify(entries) {
  const versionFlag = { 'mpv.exe': '--version', mpv: '--version' };
  let ok = true;
  for (const { target } of entries) {
    if (path.extname(target) === '.com') continue; // a front-end, not a tool
    const binary = path.join(OUT_DIR, target);
    const flag = versionFlag[target] ?? '-version';
    try {
      const out = execFileSync(binary, [flag], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
      log(`verified ${target}: ${out.split('\n')[0].trim()}`);
    } catch (error) {
      ok = false;
      console.error(`  FAILED  ${target} did not run: ${error instanceof Error ? error.message : error}`);
    }
  }
  return ok;
}

// --- main ------------------------------------------------------------------

console.log(`\nStaging the media runtime for ${key} into cs3_windows/media-runtime/\n`);
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });

const results = [];
for (const [name, component] of Object.entries(plan)) {
  results.push(await stage(name, component));
}

console.log('');
const problems = [];
for (const result of results) {
  if (result.skipped) continue;
  if (result.failed) {
    const required = plan[result.name].required;
    const line = `${result.name}: ${result.failed}`;
    if (required) problems.push(line);
    log(`${required ? 'MISSING ' : 'skipped '}${line}`);
    continue;
  }
  for (const { target, bytes } of result.staged) {
    log(`staged ${target.padEnd(12)} ${(bytes / 1048576).toFixed(1)} MB`);
  }
}

if (VERIFY) {
  console.log('');
  const entries = results.flatMap((result) => result.staged);
  if (!verify(entries)) problems.push('one or more staged binaries did not run');
}

console.log('');
if (problems.length > 0) {
  for (const problem of problems) console.error(`  MISSING  ${problem}`);
  if (!ALLOW_MISSING) {
    fail(
      'The media runtime is incomplete, so this build would ship the app without its ' +
        'playback engine — which is the configuration this script exists to prevent. ' +
        'Pass --allow-missing to build anyway.'
    );
  }
  console.warn('  Continuing anyway because --allow-missing was passed.\n');
} else {
  log('media runtime complete\n');
}
