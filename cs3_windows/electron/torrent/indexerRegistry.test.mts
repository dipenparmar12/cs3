import assert from 'node:assert/strict';
import type { DatastoreManager } from '../datastore.ts';
import { IndexerRegistry } from './indexerRegistry.ts';
import { IndexerKind, type IndexerConfig } from '../../src/types/torrent.ts';

function fakeDatastore(): DatastoreManager {
  const values = new Map<string, string>();
  return {
    getInt: (key: string, fallback = 0) => {
      const v = values.get(key);
      return v !== undefined ? Number(v) : fallback;
    },
    setInt: (key: string, value: number) => {
      values.set(key, String(value));
    },
    getString: (key: string, fallback = '') => values.get(key) ?? fallback,
    getObject: <T,>(key: string, fallback: T): T =>
      values.has(key) ? (JSON.parse(values.get(key) as string) as T) : fallback,
    setObject: (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value));
    },
  } as unknown as DatastoreManager;
}

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('upsertConfig updates existing config in place without changing its array index', () => {
  const registry = new IndexerRegistry(fakeDatastore());
  const initial = registry.getConfigs();
  assert(initial.length >= 3, 'Expected at least 3 default indexer configs');

  const targetIndex = 1;
  const original = initial[targetIndex];
  const originalIds = initial.map((c) => c.id);

  // Toggle enabled on the target
  const updated: IndexerConfig = {
    ...original,
    enabled: !original.enabled,
  };

  registry.upsertConfig(updated);
  const afterUpsert = registry.getConfigs();

  // Array length must not change
  assert.equal(afterUpsert.length, initial.length);
  // Order of IDs across the entire list must be identical
  assert.deepEqual(afterUpsert.map((c) => c.id), originalIds);
  // Target index must hold the updated config
  assert.equal(afterUpsert[targetIndex].id, original.id);
  assert.equal(afterUpsert[targetIndex].enabled, !original.enabled);
});

test('upsertConfig appends newly added configs to the end of the list', () => {
  const registry = new IndexerRegistry(fakeDatastore());
  const initial = registry.getConfigs();

  const newConfig: IndexerConfig = {
    id: 'torznab-custom-test',
    name: 'Custom Jackett',
    kind: IndexerKind.Torznab,
    enabled: true,
    baseUrl: 'http://localhost:9117',
    apiKey: 'secret',
  };

  registry.upsertConfig(newConfig);
  const after = registry.getConfigs();

  assert.equal(after.length, initial.length + 1);
  assert.equal(after[after.length - 1].id, 'torznab-custom-test');
});

test('saveConfigs replaces configs and persists to datastore', () => {
  const datastore = fakeDatastore();
  const registry = new IndexerRegistry(datastore);
  const initial = registry.getConfigs();

  const disabledAll = initial.map((c) => ({ ...c, enabled: false }));
  registry.saveConfigs(disabledAll);

  const after = registry.getConfigs();
  assert(after.every((c) => !c.enabled));

  // Loading a new registry from same datastore should read saved state
  const reloaded = new IndexerRegistry(datastore);
  assert(reloaded.getConfigs().every((c) => !c.enabled));
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}
console.log(`Passed ${passed}/${tests.length} indexer registry tests`);
