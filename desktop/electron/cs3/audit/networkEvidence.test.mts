import { test } from 'node:test';
import assert from 'node:assert/strict';

import { judgeReach, judgeSite, type WorkerAnswer } from './networkEvidence.ts';

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const mp4 = Uint8Array.from([0, 0, 0, 0x20, ...ascii('ftypisom'), ...new Array(32).fill(0)]);
const ok = (over: Partial<WorkerAnswer> = {}): WorkerAnswer => ({ ok: true, status: 200, headers: {}, url: 'https://site.example/', redirects: [], body: new Uint8Array(0), ...over });

test('a site that answers passes; a dead, parked or failing one does not', () => {
  assert.equal(judgeSite(ok({ body: ascii('<html><body>Movies</body></html>') })).outcome, 'pass');
  assert.equal(judgeSite({ ok: false, error: 'net::ERR_NAME_NOT_RESOLVED' }).outcome, 'fail');
  assert.equal(judgeSite(ok({ body: ascii('<html>This domain is for sale!</html>') })).outcome, 'fail');
  assert.equal(judgeSite(ok({ status: 503 })).outcome, 'fail');
  assert.equal(judgeSite(ok({ status: 404 })).outcome, 'fail');
});

test('a wall makes the site inconclusive, never dead', () => {
  const cloudflare = judgeSite(ok({ status: 403, headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' } }));
  assert.deepEqual([cloudflare.outcome, cloudflare.reason], ['inconclusive', 'challenge']);
  const limited = judgeSite(ok({ status: 429 }));
  assert.deepEqual([limited.outcome, limited.reason], ['inconclusive', 'rate-limited']);
  assert.equal(judgeSite(ok({ status: 403 })).outcome, 'inconclusive');
});

const steps = (read: WorkerAnswer, extra: Partial<Parameters<typeof judgeReach>[0]> = {}) =>
  judgeReach({
    url: 'https://cdn.example/v/film.mp4?token=SECRET',
    head: ok({ headers: { 'content-type': 'video/mp4', 'content-length': '100' } }),
    probe: ok({ status: 206, headers: { 'content-range': 'bytes 0-0/1000000' } }),
    read,
    ...extra,
  });

test('a source whose body is media is reachable, and its range and length are recorded', () => {
  const judged = steps(ok({ status: 206, headers: { 'content-type': 'video/mp4' }, body: mp4 }));
  assert.equal(judged.outcome, 'pass');
  assert.equal(judged.range, 'honoured');
  assert.equal(judged.evidence.totalBytes, 1000000);
  assert.equal(judged.evidence.head, 'supported');
  assert.ok(!JSON.stringify(judged.evidence).includes('SECRET'));
  assert.deepEqual(judged.quirks, []);
});

test("the body decides, not the URL's claim, and a lie is named", () => {
  const judged = judgeReach({ url: 'https://cdn.example/poster.jpg', read: ok({ headers: { 'content-type': 'image/jpeg' }, body: mp4 }) });
  assert.equal(judged.outcome, 'pass');
  assert.ok(judged.quirks.includes('N-1') && judged.quirks.includes('N-2'));
  assert.equal(steps(ok({ body: ascii('<!DOCTYPE html><html>') })).outcome, 'fail');
  assert.equal(steps(ok({ body: ascii('{"url":"https://x"}') })).outcome, 'fail');
});

test('range ignored is recorded; an expired link says so', () => {
  const ignored = steps(ok({ body: mp4 }), { probe: ok({ status: 200 }) });
  assert.equal(ignored.range, 'ignored');
  assert.ok(ignored.quirks.includes('N-12'));
  const expired = judgeReach({ url: 'https://cdn.example/f.mp4?Expires=1000000000', read: ok({ status: 403 }) });
  assert.equal(expired.outcome, 'fail');
  assert.match(expired.message!, /expired/);
});

test('torrents and other schemes are not fetched; walls are inconclusive', () => {
  assert.equal(judgeReach({ url: 'magnet:?xt=urn:btih:abc' }).outcome, 'skipped');
  assert.equal(judgeReach({ url: 'https://x/a', declared: { torrent: true } }).reason, 'torrent-lane');
  assert.equal(judgeReach({ url: 'rtmp://live.example/a' }).outcome, 'unsupported');
  assert.equal(steps(ok({ status: 403, headers: { 'cf-mitigated': 'challenge' } })).reason, 'challenge');
  assert.equal(steps({ ok: false, error: 'net::ERR_CONNECTION_RESET' }).outcome, 'fail');
});

test('nothing recognisable is left to the inspector only when the server says media', () => {
  const unknown = ascii('\u0000\u0001\u0002\u0003 binary');
  assert.equal(steps(ok({ headers: { 'content-type': 'application/octet-stream' }, body: unknown })).outcome, 'pass');
  assert.equal(steps(ok({ headers: { 'content-type': 'text/plain' }, body: unknown })).outcome, 'inconclusive');
});
