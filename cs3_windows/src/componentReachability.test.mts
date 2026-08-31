import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every component has to be reachable, and nothing else checks that.
 *
 * `ExtensionUpdates` was found this way. It is a complete feature — check for
 * updates, update one, update all, set the auto-update policy, live progress
 * driven by the `extension:update*` events — and it was imported by nothing at
 * all. Every channel it needs was registered in `main.ts` and exposed in
 * `preload.ts`, so `ipcSurface.test.mts` was perfectly satisfied: the IPC
 * surface agreed with itself and simply had no caller.
 *
 * That is the third direction this same failure has arrived from. A channel
 * invoked and never registered, a channel registered and never invoked, and now
 * a component built and never mounted — all invisible to `tsc`, all invisible
 * to the tests, and all with the same user-visible form: a feature that exists
 * and cannot be reached.
 *
 * Lexical rather than a render, for the same reason the IPC test is: what is
 * being checked is whether one file names another, and rendering the tree would
 * need a DOM, a preload bridge and a running main process to prove something
 * the import graph already says.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Files that are legitimately imported by nothing.
 *
 * Add to this only with the reason, and only when the reason is real. "I will
 * wire it later" is not one — an entry here is indistinguishable from a working
 * feature to everyone who reads the code, which is the exact failure this test
 * exists to end.
 */
const ALLOWED_ORPHANS = new Map<string, string>([
  ['main.tsx', 'The Vite entry point. Named in index.html, not imported.'],
  ['App.tsx', 'Mounted by main.tsx through a path this scan does resolve; kept for clarity.'],
  [
    'components/MediaComponentsCard.tsx',
    'Superseded by UnifiedComponentManager, which covers ffmpeg alongside the runtime and the ' +
      'download binaries. Mounting both would give the same install two screens that can disagree.',
  ],
  [
    'components/RuntimeProvisionerCard.tsx',
    'Superseded by UnifiedComponentManager, same reason: it owns the runtime row now.',
  ],
  [
    'components/ProviderSelector.tsx',
    'Superseded by SearchScopePicker, which is the one that enforces `effectivelyEnabled` rather ' +
      'than the provider’s own switch — see the extensions-screen notes in AGENTS.md.',
  ],
]);

/** Every `.tsx` under `src`, relative to `src`. */
function componentFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...componentFiles(full, base));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Basenames named by an import anywhere in the renderer or the main process.
 *
 * Matched on the specifier's last segment rather than on a resolved path.
 * Resolving properly would mean reimplementing module resolution — extensions,
 * index files, the `.ts` specifiers `electron/media` uses — to answer a
 * question a basename already answers, and the failure mode of the loose match
 * is a false *pass*, never a false failure.
 */
function importedBasenames(roots: string[]): Set<string> {
  const names = new Set<string>();
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        visit(full);
        continue;
      }
      if (!/\.(ts|tsx|mts)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) continue;
        const basename = specifier.split('/').pop() ?? '';
        // Only self-imports are excluded, so a file importing itself cannot
        // vouch for itself.
        if (basename.replace(/\.(ts|tsx)$/, '') === entry.name.replace(/\.(ts|tsx)$/, '')) {
          if (path.resolve(path.dirname(full), specifier).startsWith(full.replace(/\.\w+$/, ''))) {
            continue;
          }
        }
        names.add(basename.replace(/\.(ts|tsx)$/, ''));
      }
    }
  };
  for (const root of roots) visit(root);
  return names;
}

test('every component is imported by something', () => {
  const srcDir = path.join(here);
  const files = componentFiles(srcDir);
  const imported = importedBasenames([srcDir, path.join(here, '..', 'electron')]);

  const orphans = files.filter((file) => {
    const basename = path.basename(file, '.tsx');
    if (imported.has(basename)) return false;
    return !ALLOWED_ORPHANS.has(file);
  });

  assert.deepEqual(
    orphans,
    [],
    `These components are built and mounted nowhere:\n  ${orphans.join('\n  ')}\n` +
      'Either mount them, delete them, or add them to ALLOWED_ORPHANS with a real reason.'
  );
});

test('the orphan allow-list has no stale entries', () => {
  /**
   * An allow-list that outlives its reason is worse than none: the next
   * component to be quietly orphaned lands beside four entries that look like
   * precedent. So an entry naming a file that is now imported — or that no
   * longer exists — fails.
   */
  const srcDir = path.join(here);
  const files = new Set(componentFiles(srcDir));
  const imported = importedBasenames([srcDir, path.join(here, '..', 'electron')]);

  for (const [file, reason] of ALLOWED_ORPHANS) {
    assert.ok(files.has(file), `ALLOWED_ORPHANS names ${file}, which does not exist.`);
    assert.ok(reason.length > 20, `ALLOWED_ORPHANS entry for ${file} needs a real reason.`);
    if (file === 'main.tsx' || file === 'App.tsx') continue;
    assert.ok(
      !imported.has(path.basename(file, '.tsx')),
      `${file} is imported now — remove it from ALLOWED_ORPHANS.`
    );
  }
});
