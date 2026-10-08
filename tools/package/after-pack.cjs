/**
 * electron-builder afterPack hook.
 *
 * Hook implementation lives in cs3_windows/scripts/after-pack.cjs because
 * electron-builder requires hook module paths to resolve within the workspace root.
 * ---
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
module.exports = require('../../cs3_windows/scripts/after-pack.cjs')
