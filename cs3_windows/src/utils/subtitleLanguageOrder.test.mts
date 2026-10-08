/**
 * Subtitle languages ordered by the viewer's regions — never filtered by them.
 *
 *   node --experimental-strip-types src/utils/subtitleLanguageOrder.test.mts
 */
import assert from 'node:assert/strict';
import { languageKey, orderLanguageChips, preferredLanguageKeys } from './subtitleLanguageOrder.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('codes and names meet on one key', () => {
  assert.equal(languageKey('hi'), 'hin');
  assert.equal(languageKey('hin'), 'hin');
  assert.equal(languageKey('Hindi'), 'hin');
  assert.equal(languageKey('deu'), 'ger');
  assert.equal(languageKey('Portuguese (BR)'), 'por');
});

test('English first, then the region languages in order, then the rest by count', () => {
  const chips = [
    { code: 'spa', name: 'Spanish', count: 40 },
    { code: 'tam', name: 'Tamil', count: 2 },
    { code: 'eng', name: 'English', count: 10 },
    { code: 'hin', name: 'Hindi', count: 3 },
    { code: 'fre', name: 'French', count: 12 },
  ];
  const preferred = preferredLanguageKeys(['hi', 'ta', 'te']);
  assert.deepEqual(orderLanguageChips(chips, preferred).map((c) => c.code), ['eng', 'hin', 'tam', 'spa', 'fre']);
});

test('no region selection still puts English first and keeps every language', () => {
  const chips = [
    { code: 'ger', name: 'German', count: 5 },
    { code: 'eng', name: 'English', count: 1 },
  ];
  const ordered = orderLanguageChips(chips, preferredLanguageKeys([]));
  assert.deepEqual(ordered.map((c) => c.code), ['eng', 'ger']);
  assert.equal(ordered.length, chips.length);
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
