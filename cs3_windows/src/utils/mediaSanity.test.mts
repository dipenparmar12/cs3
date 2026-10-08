/**
 * A two-minute stream for a two-hour film is not the film — and nothing else
 * is ever called wrong.
 *
 *   node --experimental-strip-types src/utils/mediaSanity.test.mts
 */
import assert from 'node:assert/strict';
import { looksLikeWrongMedia, wrongMediaReason } from './mediaSanity.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('a short clip for a feature film is flagged', () => {
  assert.equal(looksLikeWrongMedia({ actualSeconds: 45, expectedSeconds: 136 * 60 }), true);
  assert.equal(looksLikeWrongMedia({ actualSeconds: 4 * 60, expectedSeconds: 100 * 60 }), true);
});

test('a genuinely short title is never judged', () => {
  assert.equal(looksLikeWrongMedia({ actualSeconds: 60, expectedSeconds: 8 * 60 }), false);
});

test('nothing is judged without both lengths, or for live streams', () => {
  assert.equal(looksLikeWrongMedia({ actualSeconds: 30 }), false);
  assert.equal(looksLikeWrongMedia({ actualSeconds: 0, expectedSeconds: 7200 }), false);
  assert.equal(looksLikeWrongMedia({ actualSeconds: Infinity, expectedSeconds: 7200 }), false);
  assert.equal(looksLikeWrongMedia({ actualSeconds: 30, expectedSeconds: 7200, isLive: true }), false);
});

test('a different cut or a long recap is not flagged', () => {
  // A 22-minute episode where the catalogue says 45: a different broadcast
  // length, not an advert.
  assert.equal(looksLikeWrongMedia({ actualSeconds: 22 * 60, expectedSeconds: 45 * 60 }), false);
  // Seven minutes is past the placeholder ceiling, whatever the ratio.
  assert.equal(looksLikeWrongMedia({ actualSeconds: 7 * 60, expectedSeconds: 180 * 60 }), false);
});

test('the reason states both lengths', () => {
  assert.match(wrongMediaReason(45, 136 * 60), /45 s clip, not the 136 min title/);
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
