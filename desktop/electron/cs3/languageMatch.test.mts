import { test } from 'node:test';
import assert from 'node:assert/strict';

import { languageScore } from './languageMatch.ts';

test('an extension in one of the viewer\'s languages scores high, another language low', () => {
  assert.equal(languageScore('hi', ['hi', 'en']).score, 1);
  assert.equal(languageScore('TR', ['hi', 'en']).score, 0.2);
});

test('undeclared or many languages are neither raised nor lowered', () => {
  for (const declared of [undefined, '', 'multi', 'Multilingual']) {
    assert.equal(languageScore(declared, ['hi']).score, null, String(declared));
  }
});

test('a viewer who wants every language changes no ranking', () => {
  assert.equal(languageScore('tr', null).score, null);
  assert.equal(languageScore('tr', []).score, null);
});
