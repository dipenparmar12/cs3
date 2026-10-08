#!/usr/bin/env node
/**
 * Checks a built package carries what it needs to run, on any OS.
 *
 * A package built without the sidecar installs fine and runs no extensions,
 * with nothing on screen saying so (AGENTS.md §3, "Skipping a step fails
 * silently"); one without its JRE fails on first launch. electron-builder
 * reports success either way, so the release workflow asks this instead.
 *
 *   node tools/package/verify-package.mjs [--arch x64|arm64]
 *
 * Exits non-zero, naming what is missing, so the release is not published.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(here, '..', '..', 'cs3_windows', 'release');
const platform = process.platform;
const exe = (name) => (platform === 'win32' ? `${name}.exe` : name);

/** The unpacked app's resources folder: `<os>-unpacked/resources`, or `Contents/Resources` in a .app. */
function findResources(dir, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if ((entry.name === 'resources' || entry.name === 'Resources') && fs.existsSync(path.join(full, 'sidecar'))) {
      return full;
    }
    const found = findResources(full, depth + 1);
    if (found) return found;
  }
  return null;
}

const problems = [];
const resources = findResources(release);
if (!resources) {
  console.error(`No unpacked app with a sidecar was found under ${release}.`);
  process.exit(1);
}
console.log(`Checking ${path.relative(process.cwd(), resources)}`);

const sidecar = path.join(resources, 'sidecar');
const expect = (relative, what) => {
  if (!fs.existsSync(path.join(resources, relative))) problems.push(`${what} (${relative})`);
};
expect(path.join('sidecar', 'cs3-sidecar.jar'), 'the extension sidecar');
expect(path.join('sidecar', 'jre', 'bin', exe('java')), 'the bundled Java runtime');
const runtimeDir = path.join(sidecar, 'runtime');
const jars = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir).filter((f) => f.endsWith('.jar')).length : 0;
if (jars < 50) problems.push(`the extension classpath (${jars} jars in sidecar/runtime, expected 50+)`);

// ffmpeg ships everywhere except Apple silicon, which uses Homebrew's.
const ffmpegBundled = !(platform === 'darwin' && (process.argv.includes('arm64') || process.arch === 'arm64'));
if (ffmpegBundled) {
  expect(path.join('media', exe('ffmpeg')), 'ffmpeg');
  expect(path.join('media', exe('ffprobe')), 'ffprobe');
}
if (platform === 'win32') expect(path.join('media', 'mpv.exe'), 'mpv');

if (problems.length > 0) {
  console.error('The package is missing:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`OK — sidecar, Java runtime, ${jars} runtime jars${ffmpegBundled ? ', ffmpeg' : ''}${platform === 'win32' ? ', mpv' : ''}.`);
