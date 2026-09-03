/**
 * What the shipped repository catalogue is allowed to claim.
 *
 *   bun run test:repositories
 *   node --experimental-strip-types electron/officialRepositories.test.mts
 *
 * This file is data, so nothing about it typechecks beyond its shape, and every
 * mistake it can carry is invisible until a user clicks the row. Two were found
 * by measuring the live indexes on 2026-09-03: `pitipitii`'s document answered
 * 404 on every branch and filename tried, and one bundled entry — `megarepo` —
 * turned out to be a repository-adding plugin whose mechanism this platform
 * deliberately no-ops, so it costs a download and contributes nothing.
 *
 * These rows pin the invariants that a reviewer cannot check by eye across 34
 * entries. They deliberately do **not** fetch anything: a test that fails when a
 * third-party host has a bad afternoon is a test people learn to ignore.
 * Liveness is `tools/research/survey-repositories.mjs`, run deliberately.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Row {
  id: string;
  name: string;
  internalName: string;
  description: string;
  url: string;
  rawRepoUrl: string;
  category: string;
  language: string;
  verified: boolean;
  documentKind: string;
  bundled?: boolean;
  adult?: boolean;
  shortcode?: string;
}

const rows: Row[] = JSON.parse(
  readFileSync(path.join(HERE, 'official_repositories.json'), 'utf8')
);

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const CATEGORIES = new Set([
  'Official', 'Regional', 'Anime', 'Movies & Shows', 'Community', 'Compatibility', 'Adult',
]);
const DOCUMENT_KINDS = new Set(['repository', 'pluginList', 'unknown']);

test('every row carries the fields the UI reads', () => {
  for (const row of rows) {
    for (const field of ['id', 'name', 'internalName', 'description', 'url', 'rawRepoUrl', 'category', 'language'] as const) {
      assert.ok(row[field], `${row.id ?? '(no id)'} is missing ${field}`);
    }
    assert.equal(typeof row.verified, 'boolean', `${row.id} has no verified flag`);
  }
});

test('ids are unique', () => {
  // The id is the install key and the disable key. A duplicate silently makes
  // one of the two rows unreachable.
  const seen = new Set<string>();
  for (const row of rows) {
    assert.ok(!seen.has(row.id), `duplicate id: ${row.id}`);
    seen.add(row.id);
  }
});

test('rawRepoUrl is unique', () => {
  // Two ids pointing at one index install the same extensions twice, each under
  // its own repository, and the enable cascade then disagrees with itself.
  const seen = new Map<string, string>();
  for (const row of rows) {
    const clash = seen.get(row.rawRepoUrl);
    assert.ok(!clash, `${row.id} and ${clash} share a rawRepoUrl`);
    seen.set(row.rawRepoUrl, row.id);
  }
});

test('every address is https', () => {
  for (const row of rows) {
    assert.match(row.rawRepoUrl, /^https:\/\//, `${row.id} rawRepoUrl is not https`);
    assert.match(row.url, /^https:\/\//, `${row.id} url is not https`);
  }
});

test('rawRepoUrl points at a document rather than a project page', () => {
  // The catalogue previously stored project pages, which return HTML: 23 of 26
  // entries were wrong. `pluginManager` can probe for the document, but a
  // catalogued entry should not make it guess.
  for (const row of rows) {
    assert.ok(
      !/^https:\/\/github\.com\//.test(row.rawRepoUrl),
      `${row.id} rawRepoUrl is a github.com page, not a raw document`
    );
  }
});

test('categories and document kinds are ones the app knows', () => {
  for (const row of rows) {
    assert.ok(CATEGORIES.has(row.category), `${row.id} has category ${row.category}`);
    assert.ok(DOCUMENT_KINDS.has(row.documentKind), `${row.id} has documentKind ${row.documentKind}`);
  }
});

test('an adult repository is never bundled, and is categorised Adult', () => {
  // `bundled` installs on first launch, before anyone has been asked. The two
  // flags travelling together is what keeps the gate and the catalogue agreeing.
  for (const row of rows) {
    if (row.adult) {
      assert.notEqual(row.bundled, true, `${row.id} is adult and bundled`);
      assert.equal(row.category, 'Adult', `${row.id} is adult but categorised ${row.category}`);
    }
    if (row.category === 'Adult') {
      assert.equal(row.adult, true, `${row.id} is in the Adult category without the adult flag`);
    }
  }
});

test('a bundled repository is a verified one', () => {
  // `bundled` is a claim that provider-e2e.mjs has driven it end to end.
  // Bundling something the catalogue itself marks unverified is a contradiction
  // a user pays for on first launch.
  for (const row of rows) {
    if (row.bundled) assert.equal(row.verified, true, `${row.id} is bundled but unverified`);
  }
});

test('the bundled set stays small and deliberate', () => {
  // Each entry is ~40 archives to download and translate before the first
  // search. Growing this list is a decision, not a side effect of adding a row.
  const bundled = rows.filter((r) => r.bundled).map((r) => r.id);
  assert.ok(bundled.length <= 5, `bundled set has grown to ${bundled.length}: ${bundled.join(', ')}`);
});

// --- runner ----------------------------------------------------------------

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
