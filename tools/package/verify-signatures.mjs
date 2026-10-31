#!/usr/bin/env node
/**
 * Checks the finished release artifacts are signed, after packaging (PRD §126.2,
 * §126.6) — the state a user downloads, not an intermediate one.
 *
 *   node tools/package/verify-signatures.mjs [--require] [--downloads-only]
 *
 * Windows: every top-level `.exe` in `desktop/release` (installer, portable) and
 * the app executable in `win-unpacked` must have a *Valid* Authenticode
 * signature. `--downloads-only` skips `win-unpacked`: SignPath signs the files
 * after electron-builder made them, so the unpacked copy is never signed. macOS: the `.app` must pass `codesign --verify --deep --strict`
 * and Gatekeeper's `spctl --assess`; a stapled notarization ticket is reported.
 * Linux has no OS-level signature to check; its integrity is SHA256SUMS.txt.
 *
 * Without `--require` it reports and exits 0, so unsigned development and
 * preview builds still package. With it, anything unsigned or invalid fails the
 * job — the release workflow passes it when signing is configured, so a signing
 * failure can never become a published release. Writes `signed=true|false` to
 * `$GITHUB_OUTPUT` when present, which the publish job reads.
 *
 * Commands are run with argument arrays, never through a shell.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(here, '..', '..', 'desktop', 'release');
const require = process.argv.includes('--require');
const downloadsOnly = process.argv.includes('--downloads-only');

function run(command, args) {
  try {
    return { ok: true, out: execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || String(error.message) };
  }
}

function windowsTargets() {
  const top = fs.existsSync(release)
    ? fs.readdirSync(release).filter((f) => f.endsWith('.exe')).map((f) => path.join(release, f))
    : [];
  const unpacked = path.join(release, 'win-unpacked');
  const app = !downloadsOnly && fs.existsSync(unpacked)
    ? fs.readdirSync(unpacked).filter((f) => f.endsWith('.exe') && !/^elevate\.exe$/i.test(f)).map((f) => path.join(unpacked, f))
    : [];
  return [...top, ...app];
}

function checkWindows(file) {
  // The path travels as an environment variable, so PowerShell never parses it.
  const result = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$s = Get-AuthenticodeSignature -LiteralPath $env:CS3_FILE; "$($s.Status)|$($s.SignerCertificate.Subject)"',
    ],
    { encoding: 'utf8', env: { ...process.env, CS3_FILE: file } }
  ).trim();
  const [status, subject] = result.split('|');
  return { file, ok: status === 'Valid', detail: status === 'Valid' ? subject : status };
}

function macTargets() {
  const dir = ['mac', 'mac-arm64', 'mac-universal'].map((d) => path.join(release, d)).find((d) => fs.existsSync(d));
  if (!dir) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.app')).map((f) => path.join(dir, f));
}

function checkMac(app) {
  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const gatekeeper = run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  const stapled = run('xcrun', ['stapler', 'validate', app]);
  return {
    file: app,
    ok: verify.ok && gatekeeper.ok,
    detail: [
      verify.ok ? 'signature valid' : `codesign: ${verify.out.split('\n').pop()}`,
      gatekeeper.ok ? 'Gatekeeper accepts' : `spctl: ${gatekeeper.out.split('\n').pop()}`,
      stapled.ok ? 'notarization stapled' : 'no stapled ticket',
    ].join('; '),
  };
}

let results = [];
if (process.platform === 'win32') results = windowsTargets().map(checkWindows);
else if (process.platform === 'darwin') results = macTargets().map(checkMac);
else {
  console.log('Linux: no OS signature to check; artifacts are covered by SHA256SUMS.txt.');
}

for (const r of results) console.log(`${r.ok ? 'signed  ' : 'UNSIGNED'}  ${path.relative(release, r.file)}  — ${r.detail}`);
const signed = results.length > 0 && results.every((r) => r.ok);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `signed=${signed}\n`);

if (process.platform !== 'linux' && results.length === 0) {
  console.log('No artifacts found to check.');
  if (require) process.exit(1);
}
if (require && !signed) {
  console.error('\nSigning is required for this build and the artifacts above are not validly signed.');
  process.exit(1);
}
