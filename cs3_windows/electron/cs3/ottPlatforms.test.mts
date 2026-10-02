/**
 * Which installed provider counts as which OTT platform.
 *
 *   bun run test:ott
 *   node --experimental-strip-types electron/cs3/ottPlatforms.test.mts
 *
 * Pinned because the expensive failure here is silent. A matcher that is one
 * character too loose does not throw and does not log — it fills the Prime
 * Video page with results from a torrent aggregator called PrimeWire, which
 * looks like working software right up until someone notices the catalogue is
 * wrong. The three false-positive rows below are real provider names from this
 * corpus, and they are the reason the patterns are anchored.
 */
import assert from 'node:assert/strict';
import {
  buildOttPlatformViews,
  normaliseProviderName,
  ottPlatformById,
  ottPlatformForProvider,
  OTT_PLATFORMS,
} from './ottPlatforms.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- discovery: Android's home-screen picker -------------------------------

const detail = (name: string, hasMainPage = true) => ({
  name,
  pluginName: 'Ext',
  hasMainPage,
  supportedTypes: ['Movie'],
});

test('discovers enabled providers with a main page that no listed platform claims', () => {
  const views = buildOttPlatformViews({
    allProviders: ['Hotstar', 'Netflix', 'NoHome', 'Off'],
    enabledProviders: ['Hotstar', 'Netflix', 'NoHome'],
    providerDetails: [detail('Hotstar'), detail('Netflix'), detail('NoHome', false), detail('Off')],
  });
  const discovered = views.filter((v) => v.discovered).map((v) => v.id);
  // Netflix stays on its listed row; no main page and switched-off are not offered.
  assert.deepEqual(discovered, ['provider:Hotstar']);
  assert.deepEqual(views.find((v) => v.id === 'netflix')?.providers, ['Netflix']);
});

test('a provider declaring NSFW is flagged adult; others are not', () => {
  const views = buildOttPlatformViews({
    allProviders: ['AdultSite', 'Hotstar'],
    enabledProviders: ['AdultSite', 'Hotstar'],
    providerDetails: [
      { name: 'AdultSite', pluginName: 'Ext', hasMainPage: true, supportedTypes: ['NSFW'] },
      detail('Hotstar'),
    ],
  });
  assert.equal(views.find((v) => v.name === 'AdultSite')?.adult, true);
  assert.equal(views.find((v) => v.name === 'Hotstar')?.adult, false);
});

test('no provider details means no discovered platforms', () => {
  const views = buildOttPlatformViews({
    allProviders: ['Hotstar'],
    enabledProviders: ['Hotstar'],
  });
  assert.equal(views.some((v) => v.discovered), false);
});

// --- what NetMirror actually registers -------------------------------------

/**
 * Read out of the published archive rather than assumed: the four `MainAPI`
 * subclasses in `Netmirror.cs3` register exactly these display names.
 */
test('the NetMirror provider names land on their own platform', () => {
  assert.equal(ottPlatformForProvider('Netflix')?.id, 'netflix');
  assert.equal(ottPlatformForProvider('Prime Video')?.id, 'primevideo');
  assert.equal(ottPlatformForProvider('Disney Plus')?.id, 'disney');
  /**
   * NetMirror registers a fourth, `Hotstar`, and it deliberately reaches no
   * platform: nothing serves Hotstar a catalogue, so the page was a brand name
   * over a search box. The provider stays installed and searchable.
   */
  assert.equal(ottPlatformForProvider('Hotstar'), null);
});

test('punctuation and case are not identity', () => {
  assert.equal(ottPlatformForProvider('disney plus')?.id, 'disney');
  assert.equal(ottPlatformForProvider('DisneyPlus')?.id, 'disney');
  assert.equal(ottPlatformForProvider('PRIME VIDEO')?.id, 'primevideo');
  assert.equal(normaliseProviderName('Disney+ Hotstar'), 'disneyhotstar');
});

// --- the false positives that exist ----------------------------------------

test('PrimeWire is not Prime Video', () => {
  // A real torrent aggregator. An unanchored /prime/ would file it under
  // Amazon and nothing would ever say so.
  assert.equal(ottPlatformForProvider('PrimeWire'), null);
});

test('Netfilm is not Netflix', () => {
  assert.equal(ottPlatformForProvider('Netfilm'), null);
});

test('Ahashare is not an OTT platform', () => {
  assert.equal(ottPlatformForProvider('Ahashare'), null);
});

test('a provider named after nothing in the table matches nothing', () => {
  for (const name of ['Cinevood', 'AniWorld', 'InternetArchive', 'MovieBox', '']) {
    assert.equal(ottPlatformForProvider(name), null, name);
  }
});

// --- the overlap that would otherwise depend on array order ----------------

test('no Hotstar name leaks onto a neighbouring platform', () => {
  /**
   * This is the assertion that matters now that Hotstar has no row. Both names
   * sit one loosened pattern away from a *wrong* page: `disneyhotstar` starts
   * with `disney`, and `jiohotstar` starts with `jio`. Unmatched is the right
   * answer; either of those pages filling with a Hotstar library is not.
   */
  assert.equal(ottPlatformForProvider('Disney+ Hotstar'), null);
  assert.equal(ottPlatformForProvider('JioHotstar'), null);
  assert.equal(ottPlatformForProvider('JioCinema'), null);
});

test('the CNC Verse provider names, measured, land on the right pages', () => {
  /**
   * Read off a real `--plugins 20` harness run, not invented. The `CNC Verse`
   * extension registers `Netflix, Prime Video, Hotstar, Disney, …` and
   * `CNC Verse Mobile` registers the same set suffixed with `M`. `DisneyM` is
   * the case that broke the first version of the Disney pattern.
   */
  assert.equal(ottPlatformForProvider('Disney')?.id, 'disney');
  assert.equal(ottPlatformForProvider('DisneyM')?.id, 'disney');
  assert.equal(ottPlatformForProvider('NetflixM')?.id, 'netflix');
  assert.equal(ottPlatformForProvider('PrimeVideoM')?.id, 'primevideo');
  assert.equal(ottPlatformForProvider('HotstarM'), null);
});

test('the Disney suffix relaxation did not reach Disney+ Hotstar', () => {
  // `disneym` and `disneyhotstar` both start with `disney`; only the first is
  // Disney+. This is the assertion that fails if the pattern loses its anchor.
  assert.equal(ottPlatformForProvider('Disney+ Hotstar'), null);
  assert.equal(ottPlatformForProvider('Disneyland'), null);
});

test('a renamed mirror still matches by pattern', () => {
  assert.equal(ottPlatformForProvider('NetflixMirror v2')?.id, 'netflix');
  assert.equal(ottPlatformForProvider('PrimeVideoMirror')?.id, 'primevideo');
});

// --- availability ----------------------------------------------------------

const EMPTY = { allProviders: [], enabledProviders: [] };

test('nothing installed reports every platform as missing, with somewhere to go', () => {
  const views = buildOttPlatformViews(EMPTY);
  assert.equal(views.length, OTT_PLATFORMS.length);
  for (const view of views) {
    assert.equal(view.availability, 'missing', view.id);
    assert.ok(view.suggestedRepositories.length > 0, view.id);
  }
});

test('an enabled provider makes its platform ready', () => {
  const views = buildOttPlatformViews({
    allProviders: ['Netflix', 'Cinevood'],
    enabledProviders: ['Netflix', 'Cinevood'],
  });
  const netflix = views.find((v) => v.id === 'netflix')!;
  assert.equal(netflix.availability, 'ready');
  assert.deepEqual(netflix.providers, ['Netflix']);
});

test('installed but switched off is `disabled`, never `missing`', () => {
  /**
   * The distinction the whole view exists for. Reporting a provider the user
   * turned off as absent sends them to reinstall an extension they already
   * have, and the switch that would actually fix it is never mentioned.
   */
  const views = buildOttPlatformViews({
    allProviders: ['Netflix'],
    enabledProviders: [],
  });
  const netflix = views.find((v) => v.id === 'netflix')!;
  assert.equal(netflix.availability, 'disabled');
  assert.deepEqual(netflix.disabledProviders, ['Netflix']);
  assert.deepEqual(netflix.providers, []);
});

test('only Netflix, Prime Video and Disney+ are hand-listed', () => {
  // Everything else must come from discovery, never from a row written here.
  assert.deepEqual(OTT_PLATFORMS.map((p) => p.id).sort(), ['disney', 'netflix', 'primevideo']);
});

test('a ZEE5 provider is discovered, not hardcoded or "carried by" anything', () => {
  const views = buildOttPlatformViews({
    allProviders: ['ZEE5', 'MovieBoxProvider'],
    enabledProviders: ['ZEE5', 'MovieBoxProvider'],
    providerDetails: [detail('ZEE5'), detail('MovieBoxProvider')],
  });
  const zee5 = views.find((v) => v.name === 'ZEE5')!;
  assert.equal(zee5.discovered, true);
  assert.deepEqual(zee5.providers, ['ZEE5']);
  assert.equal(views.some((v) => v.id === 'zee5'), false);
});

test('every platform id resolves back to its definition', () => {
  for (const platform of OTT_PLATFORMS) {
    assert.equal(ottPlatformById(platform.id)?.name, platform.name);
  }
  assert.equal(ottPlatformById('nope'), null);
});

test('no two platforms claim the same provider name', () => {
  /**
   * A duplicate would be invisible: the exact index keeps the first and the
   * second platform simply never lights up, with nothing saying why.
   */
  const seen = new Map<string, string>();
  for (const platform of OTT_PLATFORMS) {
    for (const name of platform.providerNames) {
      const key = normaliseProviderName(name);
      assert.equal(seen.get(key), undefined, `${name} claimed by ${seen.get(key)} and ${platform.id}`);
      seen.set(key, platform.id);
    }
  }
});

test('every declared provider name matches its own platform', () => {
  // Catches a name added to one platform that a different platform's pattern
  // reaches first — the same order-dependence the Disney/Hotstar case has.
  for (const platform of OTT_PLATFORMS) {
    for (const name of platform.providerNames) {
      assert.equal(ottPlatformForProvider(name)?.id, platform.id, name);
    }
  }
});

// --- runner ----------------------------------------------------------------

// --- which platforms ship switched on ------------------------------------------

test('the three listed platforms ship switched on', () => {
  const on = OTT_PLATFORMS.filter((p) => p.defaultEnabled).map((p) => p.id).sort();
  assert.deepEqual(on, ['disney', 'netflix', 'primevideo']);
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

console.log(failed === 0 ? `
${tests.length} passed` : `
${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
