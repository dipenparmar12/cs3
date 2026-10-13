/**
 * "Will this work here?" without the bytecode.
 *
 *   bun run test compatibilityVerdict
 *   node --experimental-strip-types src/components/extensions/compatibilityVerdict.test.mts
 *
 * Two rules carry the module, and both are about being wrong in the safe
 * direction:
 *
 * 1. **`Unsupported` is an absence of evidence, never the bottom of the
 *    scale.** Its score is 0 by default rather than by measurement, and the
 *    cross-platform jar lane spent a release being reported exactly that way —
 *    `Unsupported`, 0% — for the one lane that needs no translation at all.
 * 2. **Nothing here says an extension *will* work.** The analyser reads the
 *    archive and never runs it, so a perfect score and a dead site look
 *    identical from where it stands.
 */
import assert from 'node:assert/strict';
import type { PluginCompatibilityReport } from '../../types/plugin.ts';
import { toneFor, verdictFor, type VerdictLevel } from './compatibilityVerdict.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const reportOf = (
  compatibilityScore: number,
  extra: Partial<PluginCompatibilityReport> = {}
): PluginCompatibilityReport => ({
  pluginName: 'TestProvider',
  internalName: 'TestProvider',
  format: 'CS3',
  compatibilityScore,
  confidence: 'High',
  recommendedTier: 'T1_DROPIN' as PluginCompatibilityReport['recommendedTier'],
  androidApiReferences: 3,
  hasNativeLibs: false,
  hasReflection: false,
  networkStack: 'NiceHttp',
  htmlParser: 'jsoup',
  details: [],
  ...extra,
});

// --- the rules ---------------------------------------------------------------

test('an unreadable archive is unknown, never the bottom of the scale', () => {
  const verdict = verdictFor(reportOf(0, { confidence: 'Unsupported' }));
  assert.equal(verdict.level, 'unknown');
  assert.notEqual(verdict.level, 'unlikely');
});

test('unsupported wins over the score, whatever the score says', () => {
  // The analyser scores an archive it could not classify at 0 by default. A
  // high score alongside `Unsupported` is contradictory input; the honest
  // answer is still that we do not know.
  assert.equal(verdictFor(reportOf(95, { confidence: 'Unsupported' })).level, 'unknown');
});

test('nothing promises that an extension will work', () => {
  // A prediction read from bytecode cannot know that the site went down. Every
  // band hedges, or the first high-scoring extension that finds nothing reads
  // as the app having lied.
  for (const score of [100, 90, 80, 70, 60, 50, 30, 0]) {
    const { label, detail } = verdictFor(reportOf(score));
    const sentence = `${label} ${detail}`.toLowerCase();
    assert.ok(
      !/\bwill work\b|\bworks\b|\bguarantee/.test(sentence),
      `"${sentence}" promises more than the analyser measured`
    );
  }
});

test('no band names a tier, a format or anything about bytecode', () => {
  const jargon =
    /tier|dropin|degraded|blocked|dex|bytecode|jvm|jar|android api|classpath|linkage|\.cs3/i;
  const reports = [
    reportOf(95),
    reportOf(70),
    reportOf(55),
    reportOf(10),
    reportOf(0, { confidence: 'Unsupported' }),
  ];
  for (const report of reports) {
    const { label, detail } = verdictFor(report);
    assert.ok(!jargon.test(`${label} ${detail}`), `"${label} — ${detail}" leaks internals`);
  }
});

// --- the bands ---------------------------------------------------------------

test('the bands run in order and cover the whole scale', () => {
  const seen: VerdictLevel[] = [100, 80, 79, 65, 64, 50, 49, 0].map(
    (score) => verdictFor(reportOf(score)).level
  );
  assert.deepEqual(seen, [
    'ready',
    'ready',
    'likely',
    'likely',
    'limited',
    'limited',
    'unlikely',
    'unlikely',
  ]);
});

test('the boundaries are the ones the score badge is already coloured by', () => {
  // 80 and 50 are `CompatibilityReport`'s own thresholds. Re-choosing them here
  // is how the badge and the sentence beside it come to disagree on one row.
  assert.equal(verdictFor(reportOf(80)).level, 'ready');
  assert.equal(verdictFor(reportOf(79)).level, 'likely');
  assert.equal(verdictFor(reportOf(50)).level, 'limited');
  assert.equal(verdictFor(reportOf(49)).level, 'unlikely');
});

test('every band has a label and a sentence', () => {
  for (const score of [100, 70, 55, 10]) {
    const verdict = verdictFor(reportOf(score));
    assert.ok(verdict.label.length > 0);
    assert.ok(verdict.detail.length > 0);
    assert.notEqual(verdict.label, verdict.detail);
  }
});

// --- the tone ----------------------------------------------------------------

test('a warning is never drawn in the neutral tone', () => {
  // `Badge` falls back to neutral for an undefined tone, and neutral reads as
  // "nothing to see here" — which is the one thing "May not work" must not say.
  assert.equal(toneFor('limited'), 'warning');
  assert.equal(toneFor('unlikely'), 'danger');
});

test('a good verdict is drawn as one, and only unknown is neutral', () => {
  assert.equal(toneFor('ready'), 'success');
  assert.equal(toneFor('likely'), 'success');
  assert.equal(toneFor('unknown'), undefined);
});

// --- runner ------------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
