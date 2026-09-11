/**
 * A module that only its own test imports is not finished.
 *
 *   bun run test module-reachability
 *   node --experimental-strip-types electron/moduleReachability.test.mts
 *
 * This repo has now found the same failure in four directions, each invisible to
 * `tsc` and to every passing test:
 *
 *  1. an IPC channel **invoked and never registered** — the first-run installer
 *     always failed (`ipcSurface.test.mts`);
 *  2. a channel **registered and never invoked** — the runtime repair path was
 *     unreachable (same test);
 *  3. a component **built and never mounted** — `ExtensionUpdates`
 *     (`src/componentReachability.test.mts`);
 *  4. and this one: a module **built, tested, and never constructed.**
 *
 * The fourth is the most deceptive of the four, because the test suite is the
 * thing hiding it. `sourceLease.ts` has a passing suite covering expiry, refresh
 * budget and retry policy, so the feature reads as done in every report — while
 * `MediaProxy.wrapLease` has no caller, `this.leases` is never written, and the
 * 403-refresh branch beneath it cannot execute. Green tests over an unreachable
 * module are worse than no tests: they answer "is this correct?" when the
 * question was "does this run?".
 *
 * Two checks, because there are two ways to be unreachable:
 *
 *  - **No production importer at all.**
 *  - **Only `import type` importers.** A type-only import is erased at build
 *    time, so a module whose every production reference is a type annotation
 *    contributes no behaviour. That is exactly `sourceLease`'s shape: the class
 *    is named in `MediaProxy`'s field types and constructed nowhere.
 *
 * Entries in {@link ALLOWED} must say *why*, and a stale entry fails — an
 * allow-list that outlives its reason becomes precedent for the next one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/**
 * Modules with no production caller, and the reason each is tolerated.
 *
 * Keep this list short. "I'll wire it later" is not a reason; a PRD section that
 * says so is.
 */
const ALLOWED = new Map<string, string>([
  [
    'media/sourceLease.ts',
    'PRD-40.1 §4.1 Tier 1, approved and frozen for implementation, built but not ' +
      'yet integrated: `MediaProxy.wrapLease` exists and has no caller, so signed-URL ' +
      'refresh never runs. Its Definition-of-Done boxes are unchecked. Remove this ' +
      'entry when `wrapLease` is called on the prepare path.',
  ],
  [
    'media/playbackTelemetry.ts',
    'PRD-40.1 §4.3 Tier 1, same state: the per-session record is defined and tested, ' +
      'and nothing emits one. `PlaybackEngine` keeps its own diagnostics ring buffer, ' +
      'which is what `media:getPlaybackDiagnostics` returns. Remove this entry when a ' +
      'session emits exactly one record on terminal state.',
  ],
]);

/** Every `.ts` under `electron/`, relative to it, excluding tests and build output. */
function moduleFiles(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...moduleFiles(full, base));
      continue;
    }
    if (!/\.ts$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue;
    out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Source files that can import a module: everything under `electron/` and `src/`. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(appRoot, 'electron'));
  walk(path.join(appRoot, 'src'));
  return out;
}

interface Reference {
  /** The importing file, absolute. */
  from: string;
  /** `import type { … }` — erased at build time, so it carries no behaviour. */
  typeOnly: boolean;
}

/**
 * Resolves every relative import in the tree to an `electron/`-relative module
 * path, recording whether the reference was type-only.
 */
function referencesByModule(): Map<string, Reference[]> {
  const electronRoot = path.join(appRoot, 'electron');
  const found = new Map<string, Reference[]>();

  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /import\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (!resolved.startsWith(electronRoot)) continue;
      const key = path
        .relative(electronRoot, resolved)
        .split(path.sep)
        .join('/')
        .replace(/\.(ts|mts|js)$/, '');
      const list = found.get(key + '.ts') ?? [];
      list.push({ from: file, typeOnly: Boolean(match[1]) });
      found.set(key + '.ts', list);
    }
  }
  return found;
}

const isTest = (file: string) => /\.test\.mts$/.test(file);

/** Reached by `main.ts`'s own wiring or by the build, not by an import we can see. */
const ENTRY_POINTS = new Set(['main.ts', 'preload.ts']);

function unreachable(): Array<{ module: string; why: string }> {
  const modules = moduleFiles(path.join(appRoot, 'electron'), path.join(appRoot, 'electron'));
  const refs = referencesByModule();
  const out: Array<{ module: string; why: string }> = [];

  for (const module of modules) {
    if (ENTRY_POINTS.has(module)) continue;
    const all = refs.get(module) ?? [];
    const production = all.filter((r) => !isTest(r.from));

    if (production.length === 0) {
      out.push({
        module,
        why: all.length ? 'imported only by its own test' : 'imported by nothing at all',
      });
      continue;
    }
    if (production.every((r) => r.typeOnly)) {
      out.push({ module, why: 'every production import is `import type`, which is erased at build time' });
    }
  }
  return out;
}

test('every module under electron/ has a production caller', () => {
  const offenders = unreachable().filter((o) => !ALLOWED.has(o.module));
  assert.deepEqual(
    offenders.map((o) => `${o.module} — ${o.why}`),
    [],
    'These modules are built and never run:\n  ' +
      offenders.map((o) => `${o.module} — ${o.why}`).join('\n  ') +
      '\nEither wire them, delete them, or add them to ALLOWED with a real reason.'
  );
});

test('the allow-list has no stale entries', () => {
  const current = new Set(unreachable().map((o) => o.module));
  for (const [module, reason] of ALLOWED) {
    assert.ok(
      fs.existsSync(path.join(appRoot, 'electron', module)),
      `ALLOWED names ${module}, which no longer exists — remove the entry.`
    );
    assert.ok(reason.length > 40, `ALLOWED entry for ${module} needs a real reason.`);
    assert.ok(
      current.has(module),
      `${module} has a production caller now — remove it from ALLOWED.`
    );
  }
});

test('a type-only import is recognised as carrying no behaviour', () => {
  /**
   * The check above is only worth having if it can tell the two kinds of import
   * apart, so this pins the parse rather than the codebase: `import type` is
   * erased, a plain `import` is not.
   */
  const refs = referencesByModule();
  const lease = refs.get('media/sourceLease.ts') ?? [];
  const production = lease.filter((r) => !isTest(r.from));
  assert.ok(production.length > 0, 'expected mediaProxy to reference SourceLease');
  assert.ok(
    production.every((r) => r.typeOnly),
    'SourceLease is reached only as a type today; if that changed, the allow-list entry should go'
  );
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
