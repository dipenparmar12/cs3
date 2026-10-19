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
  evaluateAdultSessionState,
  filterAdultItems,
  isAdultGenreOrTag,
  isAdultMedia,
  isSensitiveDescription,
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

test('adult genre, tag, description, and media classification across sources', () => {
  assert.equal(isAdultGenreOrTag('NSFW'), true);
  assert.equal(isAdultGenreOrTag('Hentai'), true);
  assert.equal(isAdultGenreOrTag('Erotica'), true);
  assert.equal(isAdultGenreOrTag('Action'), false);
  assert.equal(isAdultGenreOrTag('Drama'), false);

  assert.equal(isSensitiveDescription('An explicit XXX pornographic film.'), true);
  assert.equal(isSensitiveDescription('A thriller about a detective solving a murder.'), false);

  // Ordinary films whose synopses name the subject. With adult content off these
  // must stay visible, so a plot is trusted only for an explicit mark (18+, XXX, NSFW).
  assert.equal(
    isAdultMedia({ name: 'Boogie Nights', plot: 'A young man is drawn into the pornography industry of 1970s Los Angeles.' }),
    false
  );
  assert.equal(
    isAdultMedia({ name: 'Basic Instinct', description: 'A detective investigates a murder linked to an erotic thriller novelist.' }),
    false
  );

  const adultProviders = new Set(['KanAV', 'TaiAV']);
  assert.equal(isAdultMedia({ name: 'Ordinary Title', apiName: 'KanAV' }, adultProviders), true);
  assert.equal(isAdultMedia({ name: 'Ordinary Title', adult: true }), true);
  assert.equal(isAdultMedia({ name: 'Ordinary Title', type: 'NSFW' }), true);
  assert.equal(isAdultMedia({ name: 'Ordinary Title', tags: ['Sci-Fi', 'Hentai'] }), true);
  assert.equal(isAdultMedia({ name: 'Dune: Part Two', apiName: 'Cinemeta', genres: ['Sci-Fi', 'Adventure'] }, adultProviders), false);

  const sample = [
    { name: 'Dune: Part Two', apiName: 'Cinemeta' },
    { name: '18+ Isla 2026', apiName: '9kMovies' },
    { name: 'Sample Clip', apiName: 'KanAV' },
  ];
  assert.deepEqual(
    filterAdultItems(sample, false, adultProviders).map((i) => i.name),
    ['Dune: Part Two']
  );
  assert.equal(filterAdultItems(sample, true, adultProviders).length, 3);
});

test('PRD Update: saved preference enabled, startup prompt not suppressed asks Blur vs Unblur', () => {
  // On launch: prompt is pending for visual presentation choice, adult content remains available per saved setting, visual blur starts active.
  const onLaunch = evaluateAdultSessionState({
    savedEnabled: true,
    doNotAskAgain: false,
    sessionDecision: 'pending',
    sessionBlurred: true,
  });
  assert.equal(onLaunch.promptPending, true);
  assert.equal(onLaunch.allowed, true);
  assert.equal(onLaunch.blurred, true);
  assert.equal(onLaunch.mode, 'ask');

  // User chooses Unblur for the session: allowed remains true, visual assets are unblurred.
  const afterUnblur = evaluateAdultSessionState({
    savedEnabled: true,
    doNotAskAgain: false,
    sessionDecision: 'enabled',
    sessionBlurred: false,
  });
  assert.equal(afterUnblur.promptPending, false);
  assert.equal(afterUnblur.allowed, true);
  assert.equal(afterUnblur.blurred, false);

  // User chooses Keep Blurred for the session: allowed remains true, visual assets remain blurred.
  const afterKeepBlurred = evaluateAdultSessionState({
    savedEnabled: true,
    doNotAskAgain: false,
    sessionDecision: 'disabled',
    sessionBlurred: true,
  });
  assert.equal(afterKeepBlurred.promptPending, false);
  assert.equal(afterKeepBlurred.allowed, true);
  assert.equal(afterKeepBlurred.blurred, true);
});

test('PRD Update: saved preference enabled, startup prompt suppressed (Do Not Ask Again)', () => {
  // On launch: prompt does not appear, adult content is permitted, and visual assets start blurred.
  const onLaunch = evaluateAdultSessionState({
    savedEnabled: true,
    doNotAskAgain: true,
    sessionDecision: 'pending',
    sessionBlurred: true,
  });
  assert.equal(onLaunch.promptPending, false);
  assert.equal(onLaunch.allowed, true);
  assert.equal(onLaunch.blurred, true);
  assert.equal(onLaunch.mode, 'on');

  // User clicks Unblur in top navbar during session: blurred becomes false, persistent prefs unchanged.
  const unblurredInSession = evaluateAdultSessionState({
    savedEnabled: true,
    doNotAskAgain: true,
    sessionDecision: 'pending',
    sessionBlurred: false,
  });
  assert.equal(unblurredInSession.allowed, true);
  assert.equal(unblurredInSession.blurred, false);
  assert.equal(unblurredInSession.savedEnabled, true);
  assert.equal(unblurredInSession.doNotAskAgain, true);
});

test('PRD Update: saved preference disabled (NSFW off) never shows visual blur startup prompt', () => {
  // When adult content is disabled, do not show visual blur prompt on startup.
  const scenarioDisabled = evaluateAdultSessionState({
    savedEnabled: false,
    doNotAskAgain: false,
    sessionDecision: 'pending',
    sessionBlurred: true,
  });
  assert.equal(scenarioDisabled.promptPending, false);
  assert.equal(scenarioDisabled.allowed, false);
  assert.equal(scenarioDisabled.blurred, true);

  const scenarioSuppressed = evaluateAdultSessionState({
    savedEnabled: false,
    doNotAskAgain: true,
    sessionDecision: 'pending',
    sessionBlurred: true,
  });
  assert.equal(scenarioSuppressed.promptPending, false);
  assert.equal(scenarioSuppressed.allowed, false);
  assert.equal(scenarioSuppressed.mode, 'off');
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

