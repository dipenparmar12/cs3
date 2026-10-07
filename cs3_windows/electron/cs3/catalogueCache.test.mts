/**
 * The streaming-service catalogue cache.
 *
 *   bun run test catalogue-cache
 *
 * What it must never do is the thing a cache usually gets blamed for: hand back
 * an empty or failed answer over a good one, or scrape a site twice because two
 * rows asked at once.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderCatalogPage } from '../../src/types/api.ts';
import { CatalogueCache } from './catalogueCache.ts';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-cat-')), 'cache.json');
const section = { name: 'Movies', data: '/m' };
const page = (items: number, error?: string): ProviderCatalogPage => ({
  provider: 'P',
  section: 'Movies',
  page: 1,
  items: Array.from({ length: items }, (_, i) => ({ name: `T${i}`, url: `u${i}`, apiName: 'P' })),
  lists: [],
  hasNext: false,
  error,
});

test('a second read is answered from cache without asking the provider', async () => {
  const cache = new CatalogueCache(tempFile());
  let calls = 0;
  const fetch = async () => (calls++, page(3));
  await cache.page('P', section, 1, {}, fetch);
  const second = await cache.page('P', section, 1, {}, fetch);
  assert.equal(calls, 1);
  assert.equal(second.items.length, 3);
});

test('refresh asks the provider and replaces the entry', async () => {
  const cache = new CatalogueCache(tempFile());
  await cache.page('P', section, 1, {}, async () => page(1));
  const fresh = await cache.page('P', section, 1, { refresh: true }, async () => page(5));
  assert.equal(fresh.items.length, 5);
  assert.equal((await cache.page('P', section, 1, {}, async () => page(0))).items.length, 5);
});

test('a failed refresh hands back the cached page', async () => {
  const cache = new CatalogueCache(tempFile());
  await cache.page('P', section, 1, {}, async () => page(2));
  const after = await cache.page('P', section, 1, { refresh: true }, async () => page(0, 'timeout'));
  assert.equal(after.items.length, 2);
  assert.equal(after.error, undefined);
});

test('an empty refresh never replaces a good page', async () => {
  const cache = new CatalogueCache(tempFile());
  await cache.page('P', section, 1, {}, async () => page(2));
  await cache.page('P', section, 1, { refresh: true }, async () => page(0));
  assert.equal((await cache.page('P', section, 1, {}, async () => page(0))).items.length, 2);
});

test('errors are not cached', async () => {
  const cache = new CatalogueCache(tempFile());
  await cache.page('P', section, 1, {}, async () => page(0, 'HTTP 403'));
  let calls = 0;
  await cache.page('P', section, 1, {}, async () => (calls++, page(1)));
  assert.equal(calls, 1);
});

test('identical requests in flight share one fetch', async () => {
  const cache = new CatalogueCache(tempFile());
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetch = async () => {
    calls++;
    await gate;
    return page(1);
  };
  const a = cache.page('P', section, 1, {}, fetch);
  const b = cache.page('P', section, 1, {}, fetch);
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('the cache survives a restart', async () => {
  const file = tempFile();
  const first = new CatalogueCache(file);
  await first.page('P', section, 1, {}, async () => page(4));
  first.flush();
  const second = new CatalogueCache(file);
  let calls = 0;
  const read = await second.page('P', section, 1, {}, async () => (calls++, page(0)));
  assert.equal(calls, 0);
  assert.equal(read.items.length, 4);
});

test('a catalogue with no rows is not cached', async () => {
  const cache = new CatalogueCache(tempFile());
  await cache.catalog('P', {}, async () => ({ provider: 'P', hasMainPage: false, sections: [] }));
  let calls = 0;
  await cache.catalog('P', {}, async () => (calls++, { provider: 'P', hasMainPage: true, sections: [section] }));
  assert.equal(calls, 1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
