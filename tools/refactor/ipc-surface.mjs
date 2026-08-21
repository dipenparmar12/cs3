#!/usr/bin/env node
/**
 * Prints the app's IPC surface as a stable, sorted manifest.
 *
 * This exists for one job: refactoring `main.ts` and `preload.ts` moves hundreds
 * of channel registrations between files, and the compiler cannot see a channel
 * name — it is a string on both sides. A renamed or dropped channel typechecks
 * perfectly and fails at runtime as a feature that silently does nothing, which
 * is exactly the failure a large mechanical refactor is most likely to produce
 * and least likely to notice.
 *
 * So: snapshot before, snapshot after, diff. A clean diff is proof the surface
 * survived; anything else is the refactor having changed the contract.
 *
 *   node tools/refactor/ipc-surface.mjs > before.txt
 *   …refactor…
 *   node tools/refactor/ipc-surface.mjs | diff before.txt -
 *
 * Static extraction rather than loading the modules, because both sides import
 * `electron` and neither can be imported outside it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = path.join(root, 'cs3_windows');

/** Every `.ts` under electron/, excluding the test suites. */
function sources(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) found.push(full);
  }
  return found;
}

/**
 * Channel names are matched allowing a newline between the call and its first
 * argument — the formatter wraps long handler signatures, and roughly a fifth of
 * the registrations in `main.ts` are written that way.
 *
 * Two registration idioms map onto the same `handle` key on purpose. The
 * refactor is replacing bare `ipcMain.handle(…)` with the `handle(…)` /
 * `handleRaw(…)` helpers from `electron/ipc/channel.ts`, and a manifest that
 * distinguished them would report every migrated channel as a removal plus an
 * addition — which is precisely the noise that would hide a genuine one. What
 * matters is that the channel is still registered exactly once, whichever
 * spelling registers it.
 *
 * `handle` and `handleRaw` are anchored to the start of a line because they are
 * module-scope registration statements; anchoring keeps the pattern from
 * matching an unrelated local function that happens to share the name.
 */
const PATTERNS = [
  ['handle  ', /ipcMain\.handle\(\s*['"]([\w:.-]+)['"]/g],
  ['handle  ', /^handle(?:Raw)?\(\s*\n?\s*['"]([\w:.-]+)['"]/gm],
  ['on      ', /ipcMain\.on\(\s*['"]([\w:.-]+)['"]/g],
  ['invoke  ', /ipcRenderer\.invoke\(\s*['"]([\w:.-]+)['"]/g],
  ['listen  ', /ipcRenderer\.on\(\s*['"]([\w:.-]+)['"]/g],
  // `subscribe(channel, callback)` in preload.ts is the same registration with
  // its teardown handled once instead of fourteen times — same key, for the
  // reason given above.
  ['listen  ', /\bsubscribe\(\s*['"]([\w:.-]+)['"]/g],
  ['send    ', /webContents\.send\(\s*['"]([\w:.-]+)['"]/g],
];

const surface = new Map();
for (const file of sources(path.join(appDir, 'electron'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const key = `${kind} ${match[1]}`;
      surface.set(key, (surface.get(key) ?? 0) + 1);
    }
  }
}

// `send` is also reached through a local alias in several services; those are
// counted above only where the literal appears, which is what a diff needs.
const lines = [...surface.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, count]) => (count > 1 ? `${key} ×${count}` : key));

console.log(lines.join('\n'));
console.log(`\n# ${lines.length} distinct registrations`);
