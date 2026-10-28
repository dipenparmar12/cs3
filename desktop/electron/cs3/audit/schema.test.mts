import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_SCHEMA_VERSION, auditHeaders, auditUrl, parseJournalLine, printable, shapeFingerprint } from './schema.ts';

const record = {
  schema: AUDIT_SCHEMA_VERSION,
  runId: 'r1',
  providerId: 'Ext/Provider',
  stage: 'S6',
  outcome: 'pass',
  evidence: {},
  bytes: 0,
  ms: 12,
  retries: 0,
  at: '2026-10-28T00:00:00Z',
};

test('a current record is read back; a torn line, a newer schema or an unknown value is not', () => {
  assert.deepEqual(parseJournalLine(JSON.stringify(record)), record);
  assert.equal(parseJournalLine(''), null);
  assert.equal(parseJournalLine('{"schema":1,"runId":"r1"'), null);
  assert.equal(parseJournalLine(JSON.stringify({ ...record, schema: AUDIT_SCHEMA_VERSION + 1 })), null);
  assert.equal(parseJournalLine(JSON.stringify({ ...record, stage: 'S11' })), null);
  assert.equal(parseJournalLine(JSON.stringify({ ...record, outcome: 'ok' })), null);
  assert.equal(parseJournalLine(JSON.stringify({ ...record, reason: 'because' })), null);
  assert.equal(parseJournalLine(JSON.stringify({ ...record, owner: 'someone' })), null);
});

test('a stored URL keeps its shape and parameter names, never the values', () => {
  const raw = 'https://cdn.example.com/v/9f8a7b6c5d/1080.m3u8?token=SECRET&expires=1700000000&token=again';
  const { shape, fingerprint } = auditUrl(raw);
  assert.equal(shape, 'https://cdn.example.com/a/h/n.m3u8?expires&token');
  assert.ok(!shape.includes('SECRET') && !shape.includes('1700000000'));
  assert.equal(fingerprint, auditUrl(raw).fingerprint);
  assert.notEqual(fingerprint, auditUrl(raw.replace('SECRET', 'OTHER')).fingerprint);
  assert.equal(auditUrl('not a url').shape, '<unparseable>');
});

test('a provider message is kept printable, short, and without link secrets', () => {
  const png = 'Marker not found in response: \u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\u0000\u0000';
  assert.equal(printable(png), 'Marker not found in response: PNG IHDR');
  assert.equal(printable('x'.repeat(500)).length, 200);
  assert.equal(printable('HTTP 403 at https://cdn.x/v/1080.mp4?sig=SECRET'), 'HTTP 403 at https://cdn.x/a/n.mp4?sig');
});

test('headers keep names only; Referer and Origin keep their host', () => {
  assert.deepEqual(
    auditHeaders({ Referer: 'https://site.example/watch/1?x=2', Cookie: 'sid=abc', Authorization: 'Bearer t' }),
    { Referer: 'site.example', Cookie: '', Authorization: '' }
  );
  assert.deepEqual(auditHeaders(undefined), {});
});

test('a reply shape is hashed from keys and types, not values', () => {
  const a = shapeFingerprint({ links: [{ url: 'x', quality: 720 }], subtitles: [] });
  assert.equal(a, shapeFingerprint({ subtitles: [], links: [{ quality: 1080, url: 'y' }, { url: 'z', quality: 1 }] }));
  assert.notEqual(a, shapeFingerprint({ links: [{ url: 'x', quality: '720' }], subtitles: [] }));
  assert.notEqual(a, shapeFingerprint({ links: [{ url: 'x' }], subtitles: [] }));
});
