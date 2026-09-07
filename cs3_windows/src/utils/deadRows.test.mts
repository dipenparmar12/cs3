/**
 * Which search results get hidden, and the one kind that must never be.
 *
 *   bun run test:dead-rows
 *   node --experimental-strip-types src/utils/deadRows.test.mts
 *
 * The interesting case here is not the feature, it is the exclusion.
 * `app-error` means *our* runtime or transport failed, and hiding those rows
 * would turn one bug of ours into a catalogue that silently shrinks — reported
 * as "the providers stopped working", by a user with no way to see that a
 * hundred titles were filtered out on our own account. This repository has
 * already had one translation bug come to look like a hundred broken
 * providers; that is the shape being guarded against.
 */
import assert from 'node:assert/strict';
import { partitionDeadRows, type TitleOutcomeLike } from './deadRows.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const row = (url: string) => ({ name: url, url, apiName: 'Test' });
const A = row('cs3ext://ProviderA/one');
const B = row('cs3ext://ProviderB/two');
const C = row('cs3ext://ProviderC/three');

const outcomes = (map: Record<string, TitleOutcomeLike['kind']>) =>
  Object.fromEntries(Object.entries(map).map(([url, kind]) => [url, { kind }]));

test('a row that had no sources is held back', () => {
  const result = partitionDeadRows([A, B], outcomes({ [A.url]: 'no-sources' }));
  assert.deepEqual(result.visible, [B]);
  assert.deepEqual(result.hidden, [A]);
});

test('our own failure is never hidden', () => {
  /**
   * The load-bearing case. `app-error` is our runtime or transport, not the
   * provider's catalogue, and filtering on it makes our bug look like the
   * ecosystem's.
   */
  const result = partitionDeadRows([A, B], outcomes({ [A.url]: 'app-error' }));
  assert.deepEqual(result.visible, [A, B]);
  assert.deepEqual(result.hidden, []);
});

test('a row that played, and a row never opened, both show', () => {
  const result = partitionDeadRows([A, B, C], outcomes({ [A.url]: 'played' }));
  assert.deepEqual(result.visible, [A, B, C]);
});

test('the whole page is never hidden', () => {
  /**
   * A query where everything has failed before is exactly when the list is
   * needed — to try one anyway, or to recognise the title is the problem. An
   * empty page under a search that reported three results is worse than three
   * rows carrying badges.
   */
  const result = partitionDeadRows(
    [A, B],
    outcomes({ [A.url]: 'no-sources', [B.url]: 'no-sources' })
  );
  assert.deepEqual(result.visible, [A, B]);
  assert.deepEqual(result.hidden, []);
});

test('two providers with the same film are judged separately', () => {
  // Outcomes are keyed on the `cs3ext://` address, so one provider having
  // nothing says nothing about the other's copy.
  const result = partitionDeadRows([A, B], outcomes({ [A.url]: 'no-sources' }));
  assert.equal(result.visible.length, 1);
  assert.equal(result.visible[0].url, B.url);
});

test('switching the filter off returns everything, in order', () => {
  const result = partitionDeadRows(
    [A, B, C],
    outcomes({ [A.url]: 'no-sources', [C.url]: 'no-sources' }),
    { hideDeadRows: false }
  );
  assert.deepEqual(result.visible, [A, B, C]);
  assert.deepEqual(result.hidden, []);
});

test('order is preserved among the rows that survive', () => {
  // The list arrives ranked; reordering it here would silently override that.
  const result = partitionDeadRows([A, B, C], outcomes({ [B.url]: 'no-sources' }));
  assert.deepEqual(
    result.visible.map((r) => r.url),
    [A.url, C.url]
  );
});

test('a row with no url is dropped rather than rendered', () => {
  const result = partitionDeadRows(
    [A, { name: 'broken', url: '', apiName: 'Test' }],
    {}
  );
  assert.deepEqual(result.visible, [A]);
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
