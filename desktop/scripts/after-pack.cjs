/**
 * electron-builder afterPack hook.
 *
 * macOS on Apple silicon refuses to launch a bundle whose code signature is
 * invalid, and electron-builder rewrites the bundle (Info.plist, resources)
 * after Electron's own ad-hoc signature was made. With no Developer ID
 * available (no CSC_LINK/CSC_NAME) the bundle is re-signed ad hoc here, which
 * is enough for it to run once Gatekeeper's quarantine is lifted. With a real
 * identity electron-builder signs after this hook — every Mach-O in the
 * bundle, Resources included — and nothing here runs.
 *
 * Inside out, not just `--deep`: `codesign --deep` signs nested code only where
 * Apple expects it (Frameworks, Helpers, PlugIns, MacOS). The JRE, ffmpeg and
 * native modules live under Contents/Resources, where it treats them as data
 * and seals their bytes without signing them, so an arm64 binary whose own
 * signature does not hold is killed the moment the app spawns it — which for
 * the JRE is every extension. Each one is signed first, then the bundle.
 *
 * Every other platform: nothing to do.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Mach-O, thin or universal (a universal header is also a Java class file's; class files have a version where slices are counted). */
function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    if (fs.readSync(fd, head, 0, 8, 0) < 8) return false;
    const le = head.readUInt32LE(0);
    if (le === 0xfeedfacf || le === 0xfeedface) return true;
    const be = head.readUInt32BE(0);
    return (be === 0xcafebabe || be === 0xcafebabf) && head.readUInt32BE(4) < 16;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function machOFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) machOFiles(full, out);
    else if (entry.isFile() && isMachO(full)) out.push(full);
  }
  return out;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const nested = machOFiles(path.join(appPath, 'Contents', 'Resources'));
  console.log(`  • ad-hoc signing ${appName} and ${nested.length} binaries under Resources (no Developer ID configured)`);
  for (const file of nested) {
    execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
