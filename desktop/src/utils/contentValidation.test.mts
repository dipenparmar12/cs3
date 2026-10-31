import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateContent } from './contentValidation.ts';

const MIN = 60;

test('a 3-minute stream for a 2-hour film is a confirmed mismatch', () => {
  const r = validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, expectedConfidence: 'catalogue', detectedSeconds: 3 * MIN });
  assert.equal(r.identity, 'confirmed-mismatch');
  assert.deepEqual(r.reasons, ['SUSPICIOUS_DURATION']);
  assert.match(r.summary, /3 min clip, not the 120 min title/);
});

test('a few minutes off the catalogue runtime is validated, not rejected', () => {
  assert.equal(validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, detectedSeconds: 116 * MIN }).identity, 'validated');
  assert.equal(validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, detectedSeconds: 140 * MIN }).identity, 'validated');
});

test('a 25-minute stream for a 2-hour film is only a possible mismatch (it may be part one)', () => {
  const r = validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, detectedSeconds: 25 * MIN });
  assert.equal(r.identity, 'possible-mismatch');
});

test('a show average can warn but never confirm', () => {
  const r = validateContent({ kind: 'episode', expectedSeconds: 45 * MIN, expectedConfidence: 'average', detectedSeconds: 2 * MIN });
  assert.equal(r.identity, 'possible-mismatch');
});

test('missing metadata or an unmeasured length is unverified, never a rejection', () => {
  assert.equal(validateContent({ kind: 'movie', detectedSeconds: 3 * MIN }).identity, 'unverified');
  assert.deepEqual(validateContent({ kind: 'movie', detectedSeconds: 3 * MIN }).reasons, ['METADATA_UNAVAILABLE']);
  assert.equal(validateContent({ kind: 'movie', expectedSeconds: 120 * MIN }).identity, 'unverified');
});

test('short films, trailers and live streams are never judged on length', () => {
  for (const kind of ['short', 'trailer', 'live'] as const) {
    assert.equal(validateContent({ kind, expectedSeconds: 120 * MIN, detectedSeconds: 2 * MIN }).identity, 'unverified', kind);
  }
  assert.equal(validateContent({ kind: 'movie', expectedSeconds: 12 * MIN, detectedSeconds: 2 * MIN }).identity, 'unverified', 'a 12-minute film is too short to judge');
});

test('a hit already judged another title is a confirmed mismatch whatever its length', () => {
  const r = validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, detectedSeconds: 118 * MIN, hitVerdict: 'mismatch' });
  assert.equal(r.identity, 'confirmed-mismatch');
  assert.ok(r.reasons.includes('CONTENT_MISMATCH'));
});

test('identity and playability are separate answers', () => {
  const login = validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, response: 'login' });
  assert.equal(login.playability, 'restricted');
  assert.equal(login.identity, 'unverified');
  const html = validateContent({ kind: 'movie', response: 'html' });
  assert.equal(html.playability, 'invalid');
  assert.ok(html.reasons.includes('INVALID_MEDIA_RESPONSE'));
});

test('tolerances are configurable per kind', () => {
  const strict = validateContent({ kind: 'movie', expectedSeconds: 120 * MIN, detectedSeconds: 90 * MIN, tolerances: { movie: { consistentRatio: 0.1 } } });
  assert.equal(strict.identity, 'likely-match');
});
