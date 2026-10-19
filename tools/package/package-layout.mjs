/**
 * Where electron-builder puts things for each OS and architecture, what a
 * release must contain, and which CPU a binary was built for.
 *
 * Shared by `verify-package.mjs`, `smoke-package.mjs` and the release workflow,
 * so the three cannot disagree about what "the Linux arm64 package" is. The
 * artifact names are the ones `desktop/electron-builder.yml` (and, for Linux,
 * `build-installer.mjs`) produce; this file is the check, not the source.
 *
 * Platform and architecture are Node's spellings (`win32`/`darwin`/`linux`,
 * `x64`/`arm64`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const APP_DIR = path.join(ROOT, 'desktop');
export const RELEASE_DIR = path.join(APP_DIR, 'release');

/** `productName` and `linux.executableName`, read from the builder config rather than repeated here. */
function builderNames() {
  const yml = fs.readFileSync(path.join(APP_DIR, 'electron-builder.yml'), 'utf8');
  const productName = /^productName:\s*(.+?)\s*$/m.exec(yml)?.[1];
  const executableName = /^\s+executableName:\s*(.+?)\s*$/m.exec(yml)?.[1];
  if (!productName || !executableName) throw new Error('electron-builder.yml has no productName/executableName');
  return { productName, executableName };
}
export const { productName: PRODUCT_NAME, executableName: LINUX_EXECUTABLE } = builderNames();

/** The release's name for an OS: the word in every artifact name. */
export const OS_LABEL = { win32: 'windows', darwin: 'macos', linux: 'linux' };

/** electron-builder's unpacked app directory under `release/`. */
export function unpackedDir(platform, arch, release = RELEASE_DIR) {
  const suffix = arch === 'x64' ? '' : `-${arch}`;
  if (platform === 'win32') return path.join(release, `win${suffix}-unpacked`);
  if (platform === 'linux') return path.join(release, `linux${suffix}-unpacked`);
  if (platform === 'darwin') return path.join(release, arch === 'x64' ? 'mac' : `mac-${arch}`, `${PRODUCT_NAME}.app`);
  throw new Error(`no package layout for ${platform}`);
}

/** The app's `resources` folder inside an unpacked or installed app. */
export function resourcesDir(appRoot, platform) {
  return platform === 'darwin' ? path.join(appRoot, 'Contents', 'Resources') : path.join(appRoot, 'resources');
}

/** The executable that starts the app. */
export function executable(appRoot, platform) {
  if (platform === 'win32') return path.join(appRoot, `${PRODUCT_NAME}.exe`);
  if (platform === 'darwin') return path.join(appRoot, 'Contents', 'MacOS', PRODUCT_NAME);
  return path.join(appRoot, LINUX_EXECUTABLE);
}

/**
 * What one build job must upload, by name. A release is these, for every
 * target, plus `SHA256SUMS.txt` and the SBOM — nothing fewer.
 */
export function expectedArtifacts(version, platform, arch) {
  const base = `CS3-${version}-${OS_LABEL[platform]}-${arch}`;
  if (platform === 'win32') return [`${base}-installer.exe`, `${base}-portable.exe`, `${base}-portable.zip`];
  if (platform === 'darwin') return [`${base}.dmg`, `${base}.zip`];
  if (platform === 'linux') return [`${base}.AppImage`, `${base}.deb`, `${base}.tar.gz`];
  throw new Error(`no artifacts defined for ${platform}`);
}

/** Every target the release workflow builds, as `[platform, arch]`. */
export const RELEASE_TARGETS = [
  ['win32', 'x64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
];

/**
 * The tools a package for this target carries itself: ffmpeg everywhere but
 * Apple silicon (no static arm64 build; Homebrew's is used), mpv only on
 * Windows (elsewhere the distribution's or Homebrew's, wired to the GPU).
 * The same table as `electron/smokeTest.ts` `bundledTools`.
 */
export function bundledTools(platform, arch) {
  return { ffmpeg: !(platform === 'darwin' && arch === 'arm64'), mpv: platform === 'win32' };
}

const ELF_MACHINE = { 0x03: 'ia32', 0x28: 'arm', 0x3e: 'x64', 0xb7: 'arm64' };
const MACHO_CPU = { 0x7: 'ia32', 0x01000007: 'x64', 0xc: 'arm', 0x0100000c: 'arm64' };
const PE_MACHINE = { 0x14c: 'ia32', 0x8664: 'x64', 0xaa64: 'arm64', 0x1c4: 'arm' };

/**
 * The architectures a native binary runs on, read from its header: ELF, PE or
 * Mach-O (thin or universal). `null` for anything that is not one of those.
 *
 * Because "the file is there" says nothing about whether it runs: an x86-64
 * ffmpeg in an arm64 package, or a native module that was built for the
 * machine that packaged it rather than the one it ships for, installs fine and
 * fails on first use.
 */
export function binaryArchs(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read < 64) return null;

    if (head.readUInt32BE(0) === 0x7f454c46) {
      const machine = head[5] === 2 ? head.readUInt16BE(18) : head.readUInt16LE(18);
      return [ELF_MACHINE[machine] ?? `elf-0x${machine.toString(16)}`];
    }
    if (head.readUInt16LE(0) === 0x5a4d) {
      const peOffset = head.readUInt32LE(0x3c);
      const pe = Buffer.alloc(6);
      fs.readSync(fd, pe, 0, 6, peOffset);
      if (pe.readUInt32BE(0) !== 0x50450000) return null;
      const machine = pe.readUInt16LE(4);
      return [PE_MACHINE[machine] ?? `pe-0x${machine.toString(16)}`];
    }
    const thin = head.readUInt32LE(0);
    if (thin === 0xfeedfacf || thin === 0xfeedface) {
      const cpu = head.readUInt32LE(4);
      return [MACHO_CPU[cpu] ?? `macho-0x${cpu.toString(16)}`];
    }
    const fat = head.readUInt32BE(0);
    // 0xcafebabe is also a Java class file; a universal binary has a handful
    // of slices where a class file has its version number in the same place.
    if ((fat === 0xcafebabe || fat === 0xcafebabf) && head.readUInt32BE(4) < 16) {
      const count = head.readUInt32BE(4);
      const stride = fat === 0xcafebabf ? 32 : 20;
      const archs = [];
      for (let i = 0; i < count; i++) {
        const cpu = head.readUInt32BE(8 + i * stride);
        archs.push(MACHO_CPU[cpu] ?? `macho-0x${cpu.toString(16)}`);
      }
      return archs;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Every file under `dir`, depth-first. */
export function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Reads `--name value` from an argument list. */
export function flag(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
