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

// --- what NetMirror actually registers -------------------------------------

/**
 * Read out of the published archive rather than assumed: the four `MainAPI`
 * subclasses in `Netmirror.cs3` register exactly these display names.
 */
test('the four NetMirror provider names each land on their own platform', () => {
  assert.equal(ottPlatformForProvider('Netflix')?.id, 'netflix');
  assert.equal(ottPlatformForProvider('Prime Video')?.id, 'primevideo');
  assert.equal(ottPlatformForProvider('Hotstar')?.id, 'hotstar');
  assert.equal(ottPlatformForProvider('Disney Plus')?.id, 'disney');
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

test('Disney+ Hotstar goes to Hotstar, not Disney+', () => {
  /**
   * The one genuine ambiguity in the table. `disneyhotstar` starts with
   * `disney`, so an unanchored Disney pattern would claim it and which page it
   * landed on would become a property of declaration order.
   */
  assert.equal(ottPlatformForProvider('Disney+ Hotstar')?.id, 'hotstar');
  assert.equal(ottPlatformForProvider('JioHotstar')?.id, 'hotstar');
});

test('JioCinema does not swallow JioHotstar', () => {
  assert.equal(ottPlatformForProvider('JioCinema')?.id, 'jiocinema');
  assert.equal(ottPlatformForProvider('JioHotstar')?.id, 'hotstar');
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
  assert.equal(ottPlatformForProvider('HotstarM')?.id, 'hotstar');
});

test('the Disney suffix relaxation did not reach Disney+ Hotstar', () => {
  // `disneym` and `disneyhotstar` both start with `disney`; only the first is
  // Disney+. This is the assertion that fails if the pattern loses its anchor.
  assert.equal(ottPlatformForProvider('Disney+ Hotstar')?.id, 'hotstar');
  assert.equal(ottPlatformForProvider('Disneyland'), null);
});

test('a renamed mirror still matches by pattern', () => {
  assert.equal(ottPlatformForProvider('NetflixMirror v2')?.id, 'netflix');
  assert.equal(ottPlatformForProvider('PrimeVideoMirror')?.id, 'primevideo');
});

// --- availability ----------------------------------------------------------

const EMPTY = { allProviders: [], enabledProviders: [], installedExtensions: [] };

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
    installedExtensions: ['Netmirror'],
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
    allProviders: ['Hotstar'],
    enabledProviders: [],
    installedExtensions: ['Netmirror'],
  });
  const hotstar = views.find((v) => v.id === 'hotstar')!;
  assert.equal(hotstar.availability, 'disabled');
  assert.deepEqual(hotstar.disabledProviders, ['Hotstar']);
  assert.deepEqual(hotstar.providers, []);
});

test('a platform with no provider of its own is carried by an aggregate extension', () => {
  const views = buildOttPlatformViews({
    allProviders: [],
    enabledProviders: [],
    installedExtensions: ['MovieBoxProvider'],
  });
  const sony = views.find((v) => v.id === 'sonyliv')!;
  assert.equal(sony.availability, 'aggregate');
  assert.deepEqual(sony.carriedBy, ['MovieBoxProvider']);
});

test('a real provider outranks an aggregate', () => {
  // Both are true at once; the page should offer the one that can be browsed.
  const views = buildOttPlatformViews({
    allProviders: ['SonyLIV'],
    enabledProviders: ['SonyLIV'],
    installedExtensions: ['MovieBoxProvider'],
  });
  const sony = views.find((v) => v.id === 'sonyliv')!;
  assert.equal(sony.availability, 'ready');
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
