/**
 * Turning the ranking into a word, without inventing a verdict.
 *
 *   bun run test provider-health
 *   node --experimental-strip-types src/components/search/providerHealth.test.mts
 *
 * The rule the whole module exists to hold: **unmeasured is not average.** On a
 * fresh install every provider has near-zero evidence, and printing "Average"
 * over two hundred of them is a claim nothing supports — in the direction that
 * does harm, since the ranking's fourth rule is that it is never silently
 * punitive and a label that reads as mediocre is that punishment by suggestion.
 */
import assert from 'node:assert/strict';
import type { ProviderScore, RecommendationBand } from '../../types/analytics.ts';
import { healthIndex, healthOf, isWorthShowing } from './providerHealth.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const scoreOf = (
  band: RecommendationBand,
  extra: Partial<ProviderScore> = {}
): ProviderScore => ({
  provider: 'TestProvider',
  score: 70,
  confidence: 0.8,
  samples: 40,
  band,
  criteria: [],
  ...extra,
});

// --- the rule ----------------------------------------------------------------

test('an unproven provider reads as unmeasured, never as average', () => {
  const health = healthOf(scoreOf('unproven', { samples: 4, confidence: 0.1 }));
  assert.equal(health.level, 'unknown');
  assert.notEqual(health.level, 'average');
});

test('a provider with no record at all is unmeasured', () => {
  assert.equal(healthOf(undefined).level, 'unknown');
});

test('unmeasured is not put on screen', () => {
  assert.equal(isWorthShowing(healthOf(undefined)), false);
  assert.equal(isWorthShowing(healthOf(scoreOf('unproven'))), false);
});

test('a measured verdict is put on screen', () => {
  for (const band of ['strong', 'good', 'weak', 'failing'] as const) {
    assert.equal(isWorthShowing(healthOf(scoreOf(band))), true, band);
  }
});

// --- the translation ------------------------------------------------------------

test('every band maps to exactly one level, and they are all distinct', () => {
  const seen = new Map<RecommendationBand, string>();
  for (const band of ['strong', 'good', 'weak', 'failing', 'unproven'] as const) {
    seen.set(band, healthOf(scoreOf(band)).level);
  }
  assert.deepEqual(
    [...seen.entries()],
    [
      ['strong', 'excellent'],
      ['good', 'good'],
      ['weak', 'average'],
      ['failing', 'poor'],
      ['unproven', 'unknown'],
    ]
  );
});

/**
 * A translation, not a second opinion. Two places computing "is this any good"
 * is how the settings panel and the source list come to disagree in front of
 * the same user.
 */
test('the band decides, not the number', () => {
  // A score of 95 that the ranking called `failing` stays poor. The ranking
  // gates its own label on confidence and preference; re-deriving one here
  // would silently override that.
  assert.equal(healthOf(scoreOf('failing', { score: 95 })).level, 'poor');
  assert.equal(healthOf(scoreOf('strong', { score: 12 })).level, 'excellent');
});

// --- how much evidence -------------------------------------------------------------

/**
 * "Poor" from six searches and "Poor" from four hundred are different claims,
 * and someone deciding whether to switch a source off is entitled to know which
 * one they are looking at.
 */
test('the detail always says how much evidence it rests on', () => {
  assert.match(healthOf(scoreOf('failing', { samples: 6 })).detail, /6 recorded outcomes/);
  assert.match(healthOf(scoreOf('failing', { samples: 400 })).detail, /400 recorded outcomes/);
});

test('one outcome is not "1 outcomes"', () => {
  assert.match(healthOf(scoreOf('good', { samples: 1 })).detail, /1 recorded outcome\b/);
});

// --- a choice is not a measurement ----------------------------------------------------

test('a pinned provider is described as pinned, not as excellent', () => {
  const health = healthOf(scoreOf('strong', { preference: 'preferred' }));
  assert.match(health.label, /preferred/i);
  assert.match(health.detail, /you pinned/i);
});

test('a blocked provider says so rather than reporting a quality', () => {
  const health = healthOf(scoreOf('failing', { preference: 'blocked' }));
  assert.match(health.label, /you/i);
  assert.match(health.detail, /nothing here is a measurement/i);
});

// --- the index ---------------------------------------------------------------------------

test('the index keys on provider name and holds every entry', () => {
  const index = healthIndex([
    scoreOf('strong', { provider: 'A' }),
    scoreOf('failing', { provider: 'B' }),
  ]);
  assert.equal(index.size, 2);
  assert.equal(index.get('A')?.level, 'excellent');
  assert.equal(index.get('B')?.level, 'poor');
  assert.equal(index.get('C'), undefined, 'and answers nothing for a provider it never saw');
});

test('an empty leaderboard is an empty index, not an error', () => {
  assert.equal(healthIndex([]).size, 0);
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
