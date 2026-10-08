/**
 * electron-builder afterPack hook.
 *
 * macOS on Apple silicon refuses to launch a bundle whose code signature is
 * invalid, and electron-builder rewrites the bundle (Info.plist, resources)
 * after Electron's own ad-hoc signature was made. With no Developer ID
 * available (`identity: null`, no CSC_LINK) the bundle is re-signed ad hoc
 * here, which is enough for it to run once Gatekeeper's quarantine is lifted.
 * With a real identity electron-builder signs after this hook and nothing here
 * runs.
 *
 * Every other platform: nothing to do.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`  • ad-hoc signing ${appName} (no Developer ID configured)`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
