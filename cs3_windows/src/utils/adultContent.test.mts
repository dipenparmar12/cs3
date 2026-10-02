/**
 * Adult rows inside providers that are not only adult.
 *
 *   bun run test adult-content
 *
 * The row names and titles below are real, read from 9kMovies and Mp4Moviez on
 * 2026-10-02. Both failure directions are pinned: an 18+ row slipping through
 * to someone who turned adult content off, and a general row ("Hotstar
 * Specials", "Hollywood") being hidden for a word it merely contains.
 */
import assert from 'node:assert/strict';
import {
  isSensitiveRow,
  isSensitiveRowLabel,
  isSensitiveTitle,
  providerAdultKind,
  screenLists,
  screenSections,
} from './adultContent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('provider kind: adult-only, mixed and none', () => {
  assert.equal(providerAdultKind(['NSFW']), 'adult');
  assert.equal(providerAdultKind(['NSFW', 'Others']), 'adult'); // KanAV, TaiAV
  assert.equal(providerAdultKind(['Movie', 'TvSeries', 'NSFW']), 'mixed'); // 9kMovies, Mp4Moviez
  assert.equal(providerAdultKind(['NSFW', 'TvSeries']), 'mixed');
  assert.equal(providerAdultKind(['Movie', 'TvSeries']), 'none');
  assert.equal(providerAdultKind(undefined), 'none');
});

test('measured adult rows are recognised', () => {
  for (const name of [
    '18+ Movies',
    'Latest Hindi Hot Web Series',
    'Tagalog Hot Movies Hot',
    'Filipino Hot Movies Hot',
    'New Hindi Short Films Hot',
    'ULLU Web series',
  ]) {
    assert.equal(isSensitiveRowLabel(name), true, name);
  }
});

test('a category path marks a row even when its name does not', () => {
  assert.equal(isSensitiveRow({ name: 'Special', data: '/category/18-movie-hd/' }), true);
});

test('measured general rows are not', () => {
  for (const name of [
    'Latest Movies',
    'Bollywood',
    'Dual Audio',
    'Hindi Dubbed',
    'Hollywood',
    'Web Series',
    'TV Shows & WWE',
    'Old Bollywood Movies',
    'Hotstar Specials',
    'Top 10 Movies in Netflix Today',
    'Horror stories',
  ]) {
    assert.equal(isSensitiveRowLabel(name), false, name);
  }
});

test('explicit titles are recognised; ordinary titles with loaded words are not', () => {
  assert.equal(isSensitiveTitle('18+ Isla 2026 Tagalog VMAX WEB-DL'), true);
  assert.equal(isSensitiveTitle('(18＋) Sabado (2019) UNRATED Filipino Movie'), true);
  assert.equal(isSensitiveTitle('Graduate (2026) Season 1 Part 3 Hindi ULLU Web Series'), true);
  for (const title of ['Hot Fuzz', 'Adult Swim', 'Sardar 2 2026 Hindi', 'Hotstar Specials', 'Top 18 Picks', 'Ocean 18']) {
    assert.equal(isSensitiveTitle(title), false, title);
  }
});

test('a row of mostly explicit titles is adult; one stray title is not', () => {
  const explicit = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `18+ Title ${i}` }));
  const plain = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Film ${i}` }));
  assert.equal(isSensitiveRow({ name: 'New', items: [...explicit(5), ...plain(5)] }), true);
  assert.equal(isSensitiveRow({ name: 'Latest Movies', items: [...explicit(1), ...plain(17)] }), false);
});

const nineK = [
  { name: 'Latest Movies', data: '' },
  { name: 'Bollywood', data: '/category/bollywood-top-movies/' },
  { name: '18+ Movies', data: '/category/18-movie-hd/' },
];

test('mixed provider, adult off: 18+ rows removed and counted, general rows kept', () => {
  const out = screenSections(nineK, 'mixed', false);
  assert.deepEqual(out.sections.map((s) => s.name), ['Latest Movies', 'Bollywood']);
  assert.equal(out.hidden, 1);
});

test('mixed provider, adult on: everything kept, 18+ rows flagged', () => {
  const out = screenSections(nineK, 'mixed', true);
  assert.equal(out.sections.length, 3);
  assert.deepEqual(out.sections.map((s) => s.sensitive), [false, false, true]);
  assert.equal(out.hidden, 0);
});

test('general and adult-only providers pass through untouched', () => {
  assert.equal(screenSections(nineK, 'none', false).sections.length, 3);
  assert.equal(screenSections(nineK, 'adult', false).sections.length, 3);
});

test('adult off: explicit titles leave the general rows that carry them', () => {
  const lists = [{ name: 'Latest Movies', items: [{ name: '18+ Isla 2026' }, { name: 'Sardar 2 2026' }] }];
  const out = screenLists(lists, 'mixed', false);
  assert.deepEqual(out.lists[0].items.map((i) => i.name), ['Sardar 2 2026']);
  assert.equal(screenLists(lists, 'mixed', true).lists[0].items.length, 2);
});

test('a page fetched for an 18+ row is wholly sensitive', () => {
  const lists = [{ name: '', items: [{ name: 'Some Film' }] }];
  assert.equal(screenLists(lists, 'mixed', false, true).lists.length, 0);
  assert.equal(screenLists(lists, 'mixed', true, true).lists[0].sensitive, true);
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
