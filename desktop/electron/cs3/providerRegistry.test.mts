/**
 * The provider registry cache — what takes 57 seconds off every launch.
 *
 *   node --experimental-strip-types electron/cs3/providerRegistry.test.mts
 *
 * The measurements this exists for are in the module header. What the tests
 * pin is the part that is dangerous rather than the part that is fast: a cache
 * of *what an archive registered* is a claim that outlives the thing it
 * describes, and every way it can go stale produces a provider the app offers
 * and cannot serve — which reads to a user as a broken source, not a stale
 * cache. So the invalidation rules are what is tested here, not the hit path.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ProviderRegistryCache, type CachedProvider } from './providerRegistry.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-registry-'));
}

const PROVIDERS: CachedProvider[] = [
  {
    name: 'Aniworld',
    mainUrl: 'https://aniworld.to',
    lang: 'de',
    hasMainPage: true,
    hasQuickSearch: false,
    supportedTypes: ['Anime', 'AnimeMovie'],
  },
];

/** An archive stand-in. Only its size and mtime matter to the cache. */
function archive(dir: string, name = 'a.cs3', bytes = 'one'): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

test('a recorded archive is described without asking the JVM', () => {
  const dir = scratch();
  try {
    const file = archive(dir);
    const cache = new ProviderRegistryCache({ file: path.join(dir, 'r.json'), generation: 7 });
    assert.equal(cache.read('Aniworld', file), null, 'nothing is known before a load');
    cache.write('Aniworld', file, PROVIDERS);
    assert.deepEqual(cache.read('Aniworld', file), PROVIDERS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the description survives a restart — that is the entire point', () => {
  const dir = scratch();
  try {
    const file = archive(dir);
    const store = path.join(dir, 'r.json');
    const first = new ProviderRegistryCache({ file: store, generation: 7 });
    first.write('Aniworld', file, PROVIDERS);
    first.flush();

    const second = new ProviderRegistryCache({ file: store, generation: 7 });
    assert.deepEqual(second.read('Aniworld', file), PROVIDERS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a changed archive is not described from the old row', () => {
  /**
   * An update rewrites the archive, so what it registers can change. Serving
   * the previous answer would advertise providers the new version dropped, and
   * hide ones it added — and it would do so on every launch, because the row
   * outlives the process.
   */
  const dir = scratch();
  try {
    const file = archive(dir, 'a.cs3', 'one');
    const cache = new ProviderRegistryCache({ file: path.join(dir, 'r.json'), generation: 7 });
    cache.write('Aniworld', file, PROVIDERS);
    assert.ok(cache.read('Aniworld', file));

    // A different size is a different archive, whatever the name.
    fs.writeFileSync(file, 'one-but-longer');
    assert.equal(cache.read('Aniworld', file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a runtime upgrade invalidates every row', () => {
  /**
   * The shim and the bridge decide what a plugin *can* register — four rounds
   * of shim work in this repo each changed exactly that. So a row recorded
   * under generation 7 is not an answer about generation 8, even though the
   * archive's bytes never moved. Same argument `RuntimeProvisioner` makes for
   * dropping translations when the sidecar changes.
   */
  const dir = scratch();
  try {
    const file = archive(dir);
    const store = path.join(dir, 'r.json');
    const before = new ProviderRegistryCache({ file: store, generation: 7 });
    before.write('Aniworld', file, PROVIDERS);
    before.flush();

    const after = new ProviderRegistryCache({ file: store, generation: 8 });
    assert.equal(after.read('Aniworld', file), null);
    assert.equal(after.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an archive that registers nothing is still recorded', () => {
  /**
   * Extractor-only bundles register no MainAPI at all, and there are plenty of
   * them. Treating an empty list as "no record" would make every one of them
   * pay the full JVM load on every launch forever — the exact cost this cache
   * removes, concentrated on the archives that benefit from it least.
   */
  const dir = scratch();
  try {
    const file = archive(dir);
    const cache = new ProviderRegistryCache({ file: path.join(dir, 'r.json'), generation: 7 });
    cache.write('ExtractorsOnly', file, []);
    assert.deepEqual(cache.read('ExtractorsOnly', file), [], 'must be [] and not null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing archive is a miss, not a throw', () => {
  const dir = scratch();
  try {
    const cache = new ProviderRegistryCache({ file: path.join(dir, 'r.json'), generation: 7 });
    assert.equal(cache.read('Gone', path.join(dir, 'does-not-exist.cs3')), null);
    // Writing one is a no-op rather than an error: `ensureProvidersLoaded`
    // reports ARCHIVE_MISSING, and this is not the layer that should.
    cache.write('Gone', path.join(dir, 'does-not-exist.cs3'), PROVIDERS);
    assert.equal(cache.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a withdrawn row stays withdrawn across a restart', () => {
  /**
   * `forget` is called when activation fails. If it did not persist, an
   * extension that cannot load would be re-advertised on the next launch, fail
   * again, and be forgotten again — rediscovering the same permanent failure
   * once per launch forever.
   */
  const dir = scratch();
  try {
    const file = archive(dir);
    const store = path.join(dir, 'r.json');
    const first = new ProviderRegistryCache({ file: store, generation: 7 });
    first.write('Ultima', file, PROVIDERS);
    first.forget('Ultima');
    first.flush();

    const second = new ProviderRegistryCache({ file: store, generation: 7 });
    assert.equal(second.read('Ultima', file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pruning drops rows for archives that are no longer installed', () => {
  const dir = scratch();
  try {
    const a = archive(dir, 'a.cs3');
    const b = archive(dir, 'b.cs3');
    const cache = new ProviderRegistryCache({ file: path.join(dir, 'r.json'), generation: 7 });
    cache.write('A', a, PROVIDERS);
    cache.write('B', b, PROVIDERS);
    cache.prune(['A']);
    assert.ok(cache.read('A', a));
    assert.equal(cache.read('B', b), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt file starts empty rather than throwing', () => {
  // Same rule as every other store here: the first run and a crash-truncated
  // file mean the same thing, and the response to both is a real load.
  const dir = scratch();
  try {
    const store = path.join(dir, 'r.json');
    fs.writeFileSync(store, '{ not json at all');
    const cache = new ProviderRegistryCache({ file: store, generation: 7 });
    assert.equal(cache.size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- runner ------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
