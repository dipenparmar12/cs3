#!/usr/bin/env node
/**
 * Checks a built package carries what it needs to run, on any OS.
 *
 * A package built without the sidecar installs fine and runs no extensions,
 * with nothing on screen saying so (AGENTS.md §3, "Skipping a step fails
 * silently"); one without its JRE fails on first launch. electron-builder
 * reports success either way, so the release workflow asks this instead.
 *
 *   node tools/package/verify-package.mjs [--arch x64|arm64] [--version 1.2.3]
 *
 * Beyond "the file is there", each executable is checked for what makes it
 * *run* on the target: built for the target's CPU (read from its header — an
 * x86-64 ffmpeg in an arm64 package, or a native module built for the wrong
 * machine, installs fine and fails on first use) and, off Windows, marked
 * executable. With `--version`, every artifact the release expects from this
 * target must exist under its release name.
 *
 * Exits non-zero, naming what is wrong, so the release is not published.
 * Whether those binaries actually start is `smoke-package.mjs`'s question.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  RELEASE_DIR,
  binaryArchs,
  bundledTools,
  executable,
  expectedArtifacts,
  flag,
  resourcesDir,
  unpackedDir,
  walk,
} from './package-layout.mjs';

const argv = process.argv.slice(2);
const platform = process.platform;
const arch = flag(argv, '--arch', process.arch);
const version = flag(argv, '--version');
const exe = (name) => (platform === 'win32' ? `${name}.exe` : name);

const appRoot = unpackedDir(platform, arch);
if (!fs.existsSync(appRoot)) {
  console.error(`No unpacked ${platform}-${arch} app at ${path.relative(process.cwd(), appRoot)}.`);
  process.exit(1);
}
const resources = resourcesDir(appRoot, platform);
console.log(`Checking ${path.relative(process.cwd(), appRoot)} for ${platform}-${arch}`);

const problems = [];
const checked = [];

/** A file that must exist, run on this CPU and (off Windows) be executable. */
function expectBinary(file, what) {
  const shown = path.relative(appRoot, file);
  if (!fs.existsSync(file)) {
    problems.push(`${what} is missing (${shown})`);
    return;
  }
  const archs = binaryArchs(file);
  if (!archs) problems.push(`${what} is not a native executable (${shown})`);
  else if (!archs.includes(arch)) problems.push(`${what} is built for ${archs.join('+')}, not ${arch} (${shown})`);
  if (platform !== 'win32') {
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch {
      problems.push(`${what} is not marked executable (${shown})`);
    }
  }
  checked.push(what);
}

function expectFile(file, what) {
  if (!fs.existsSync(file)) problems.push(`${what} is missing (${path.relative(appRoot, file)})`);
  else checked.push(what);
}

expectBinary(executable(appRoot, platform), 'the app executable');
expectFile(path.join(resources, 'app.asar'), 'the app bundle (app.asar)');

// The extension runtime: sidecar, its classpath, and a JRE for this machine.
const sidecar = path.join(resources, 'sidecar');
expectFile(path.join(sidecar, 'cs3-sidecar.jar'), 'the extension sidecar');
expectBinary(path.join(sidecar, 'jre', 'bin', exe('java')), 'the bundled Java runtime');
// The JVM forks processes through jspawnhelper on macOS and Linux; without its
// exec bit every ProcessBuilder call fails with "error=13".
if (platform !== 'win32') expectBinary(path.join(sidecar, 'jre', 'lib', 'jspawnhelper'), 'the JRE process helper');
const runtimeDir = path.join(sidecar, 'runtime');
const jars = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir).filter((f) => f.endsWith('.jar')).length : 0;
if (jars < 50) problems.push(`the extension classpath has ${jars} jars in sidecar/runtime, expected 50+`);
else checked.push(`${jars} runtime jars`);
for (const required of ['library-jvm', 'cs3-provider-bridge']) {
  if (!fs.existsSync(runtimeDir) || !fs.readdirSync(runtimeDir).some((f) => f.startsWith(required) && f.endsWith('.jar'))) {
    problems.push(`sidecar/runtime has no ${required} jar`);
  }
}

// The media runtime, where this target bundles one.
const tools = bundledTools(platform, arch);
const media = path.join(resources, 'media');
if (tools.ffmpeg) {
  expectBinary(path.join(media, exe('ffmpeg')), 'ffmpeg');
  expectBinary(path.join(media, exe('ffprobe')), 'ffprobe');
}
if (tools.mpv) {
  expectBinary(path.join(media, 'mpv.exe'), 'mpv');
  // The console front-end: without it every mpv diagnostic comes back empty.
  expectFile(path.join(media, 'mpv.com'), 'mpv.com');
}
// A stray binary from another platform's staging run is shipped dead weight
// at best, and the one `resolveBinary` finds first at worst.
for (const file of walk(media)) {
  const archs = binaryArchs(file);
  if (archs && !archs.includes(arch)) problems.push(`media/${path.basename(file)} is built for ${archs.join('+')}, not ${arch}`);
  if (platform !== 'win32' && /\.exe$|\.com$/i.test(file)) problems.push(`media/${path.basename(file)} is a Windows binary`);
}

// Native Node modules: unpacked from the asar, and built for this target.
const unpacked = path.join(resources, 'app.asar.unpacked', 'node_modules');
expectFile(path.join(unpacked, 'node-datachannel'), 'node-datachannel, unpacked from the asar');
for (const file of walk(path.join(unpacked, 'node-datachannel'))) {
  if (!file.endsWith('.node')) continue;
  const archs = binaryArchs(file);
  if (!archs || !archs.includes(arch)) {
    problems.push(`${path.relative(unpacked, file)} is built for ${archs?.join('+') ?? 'nothing recognisable'}, not ${arch}`);
  } else checked.push('node-datachannel native module');
}

if (version) {
  for (const name of expectedArtifacts(version, platform, arch)) {
    const file = path.join(RELEASE_DIR, name);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) problems.push(`the release artifact ${name} was not produced`);
    else checked.push(name);
  }
}

if (problems.length > 0) {
  console.error(`The ${platform}-${arch} package is not releasable:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`OK — ${checked.join(', ')}.`);
