/**
 * A screen name is never a provider.
 *
 *   node --experimental-strip-types src/utils/originName.test.mts
 *
 * Library and Continue watching rows opened the detail page with
 * `apiName: 'Library'`, and the page printed it as the provider. Pinned because
 * the failure is silent: the label renders, it is just the wrong one.
 */
import assert from 'node:assert/strict';
import { isPlaceholderOrigin, originNameFor, providerFromAddress } from './originName.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('an extension address names its provider', () => {
  assert.equal(providerFromAddress('cs3ext://Hindmoviez/https%3A%2F%2Fx.example%2Fa'), 'Hindmoviez');
  assert.equal(providerFromAddress('cs3ext://Net%20Mirror/abc'), 'Net Mirror');
});

test('anything else names nothing rather than guessing', () => {
  assert.equal(providerFromAddress('https://example.com/film'), undefined);
  assert.equal(providerFromAddress('magnet:?xt=urn:btih:abc'), undefined);
  assert.equal(providerFromAddress(undefined), undefined);
});

test('screen labels are placeholders, real providers are not', () => {
  for (const label of ['Library', 'Continue watching', 'saved', ' History ']) {
    assert.equal(isPlaceholderOrigin(label), true, label);
  }
  assert.equal(isPlaceholderOrigin('Cinemeta'), false);
  assert.equal(isPlaceholderOrigin(undefined), true);
});

test('a real apiName wins; a placeholder defers to the address', () => {
  assert.equal(originNameFor('UHDmovies', 'cs3ext://Other/x'), 'UHDmovies');
  assert.equal(originNameFor('Library', 'cs3ext://Hindmoviez/x'), 'Hindmoviez');
  assert.equal(originNameFor('Library', 'https://example.com'), undefined);
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
