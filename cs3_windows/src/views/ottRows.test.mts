/**
 * Streaming-service rows: what each provider answer does to them.
 *
 *   bun run test ott-rows
 *
 * Pinned because the failure that prompted it was silent: NetMirror, CNC Verse
 * and OttSource each answer one unnamed row with 18 named lists, and the page
 * showed nothing. Every case here would otherwise fail as "the row is empty".
 */
import assert from 'node:assert/strict';
import type { ProviderCatalogPage, SearchResponse } from '../types/api.ts';
import { applyPage, itemsForRow, rowsFromCatalog, type CatalogueRow } from './ottRows.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const item = (id: string, name = ''): SearchResponse => ({ name, url: `cs3ext://P/${id}`, apiName: 'P' });

const page = (lists: Array<[string, SearchResponse[]]>, extra: Partial<ProviderCatalogPage> = {}): ProviderCatalogPage => ({
  provider: 'P',
  section: '',
  page: 1,
  items: lists.flatMap(([, items]) => items),
  lists: lists.map(([name, items]) => ({ name, horizontalImages: false, items })),
  hasNext: false,
  fetchedAt: 1000,
  ...extra,
});

const unnamedRows = (): CatalogueRow[] =>
  rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: '', data: '' }] });

test('an unnamed row answered with many lists becomes one row per list, in order', () => {
  const [row] = unnamedRows();
  const out = applyPage([row], row.key, 1, page([['Top 10', [item('1')]], ['Only on Netflix', [item('2'), item('3')]]]));
  assert.deepEqual(out.map((r) => r.name), ['Top 10', 'Only on Netflix']);
  assert.deepEqual(out.map((r) => r.items.length), [1, 2]);
  assert.ok(out.every((r) => r.fetched && !r.loading && r.parent === row.key));
});

test('empty lists are not shown as rows', () => {
  const [row] = unnamedRows();
  const out = applyPage([row], row.key, 1, page([['A', [item('1')]], ['Empty', []]]));
  assert.deepEqual(out.map((r) => r.name), ['A']);
});

test('an unnamed row answered with one list takes the list name', () => {
  const [row] = unnamedRows();
  const out = applyPage([row], row.key, 1, page([['Trending', [item('1')]]]));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Trending');
});

test('a named row answered with one list stays one row', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const out = applyPage(rows, rows[0].key, 1, page([['Movies', [item('1'), item('2')]]], { hasNext: true }));
  assert.equal(out.length, 1);
  assert.equal(out[0].items.length, 2);
  assert.equal(out[0].hasNext, true);
});

test('page 2 appends without duplicating titles', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const first = applyPage(rows, rows[0].key, 1, page([['Movies', [item('1'), item('2')]]]));
  const second = applyPage(first, rows[0].key, 2, page([['Movies', [item('2'), item('3')]]]));
  assert.deepEqual(second[0].items.map((i) => i.url), ['cs3ext://P/1', 'cs3ext://P/2', 'cs3ext://P/3']);
});

test('a failed request on an empty row says so', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const out = applyPage(rows, rows[0].key, 1, { error: 'SocketTimeoutException' });
  assert.equal(out[0].error, 'SocketTimeoutException');
  assert.equal(out[0].loading, false);
});

test('a provider-reported error on the page is an error, not an empty row', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const out = applyPage(rows, rows[0].key, 1, { ...page([]), error: 'HTTP 403' });
  assert.equal(out[0].error, 'HTTP 403');
});

test('a quiet refresh that fails keeps what is on screen', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const loaded = applyPage(rows, rows[0].key, 1, page([['Movies', [item('1')]]]));
  const after = applyPage(loaded, rows[0].key, 1, { error: 'timeout' }, { quiet: true });
  assert.equal(after[0].items.length, 1);
  assert.equal(after[0].error, undefined);
});

test('a quiet refresh that comes back empty does not blank a row', () => {
  const rows = rowsFromCatalog({ provider: 'P', hasMainPage: true, sections: [{ name: 'Movies', data: '/m' }] });
  const loaded = applyPage(rows, rows[0].key, 1, page([['Movies', [item('1')]]]));
  const after = applyPage(loaded, rows[0].key, 1, page([['Movies', []]]), { quiet: true });
  assert.equal(after[0].items.length, 1);
});

test('refreshing one split row refreshes all its siblings from the one answer', () => {
  const [row] = unnamedRows();
  const split = applyPage([row], row.key, 1, page([['A', [item('1')]], ['B', [item('2')]]]));
  const refreshed = applyPage(split, split[1].key, 1, page([['A', [item('9')]], ['B', [item('8')]]]), { quiet: true });
  assert.deepEqual(refreshed.map((r) => r.items[0].url), ['cs3ext://P/9', 'cs3ext://P/8']);
});

test('itemsForRow picks a split row out of a later page answer', () => {
  const answer = page([['A', [item('1')]], ['B', [item('2')]]]);
  assert.deepEqual(itemsForRow({ list: 'B' }, answer).map((i) => i.url), ['cs3ext://P/2']);
  assert.equal(itemsForRow({ list: undefined }, answer).length, 2);
  assert.equal(itemsForRow({ list: 'Missing' }, answer).length, 0);
});

test('repeated list names get distinct keys', () => {
  const [row] = unnamedRows();
  const out = applyPage([row], row.key, 1, page([['Top', [item('1')]], ['Top', [item('2')]]]));
  assert.equal(new Set(out.map((r) => r.key)).size, 2);
});

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
