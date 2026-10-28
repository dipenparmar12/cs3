import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declaration, judgeCatalogue, judgeDetail, judgeLinks, judgeLoad, judgeSearch, rowStatus } from './stageEvidence.ts';

const reply = (json: unknown) => ({ ok: true, result: { json: JSON.stringify(json) } });

test('load: providers registered, none, or a refusal', () => {
  assert.equal(judgeLoad({ ok: true, result: { tier: 'T1_DROPIN', providers: [{ name: 'A' }] } }).outcome, 'pass');
  assert.equal(judgeLoad({ ok: true, result: { providers: [] } }).outcome, 'fail');
  const refused = judgeLoad({ ok: false, error: 'NoClassDefFoundError: android/webkit/WebView' });
  assert.equal(refused.outcome, 'fail');
  assert.match(refused.message!, /NoClassDefFoundError/);
});

test('declaration: adult-only is NSFW with no general type', () => {
  assert.equal(declaration({ name: 'A', supportedTypes: ['NSFW'] }).adultOnly, true);
  assert.equal(declaration({ name: 'A', supportedTypes: ['NSFW', 'Others'] }).adultOnly, true);
  assert.equal(declaration({ name: 'A', supportedTypes: ['Movie', 'NSFW'] }).adultOnly, false);
  assert.equal(declaration({ name: 'A' }).adultOnly, false);
});

test('catalogue rows are classed as catalogue-e2e names them', () => {
  assert.equal(rowStatus(reply({ ok: true, sections: [{ items: [{ url: 'u', name: 'n' }] }] })).status, 'OK');
  assert.equal(rowStatus(reply({ ok: true, sections: [{ items: [{ url: 'u' }] }, { items: [] }] })).status, 'MULTI');
  assert.equal(rowStatus(reply({ ok: true, sections: [] })).status, 'EMPTY');
  assert.equal(rowStatus(reply({ ok: true, sections: [{ items: [{ name: 'no url' }] }] })).status, 'DROPPED');
  assert.equal(rowStatus(reply({ ok: false, error: 'HTTP 503' })).status, 'ERROR');
  assert.equal(rowStatus({ ok: false, error: 'timed out' }).status, 'ERROR');
});

test('a provider that wants the viewer to sign in is skipped, never broken', () => {
  const login = judgeCatalogue(true, [reply({ ok: false, error: 'ErrorLoadingException: Not logged in. Open Cinemacity addon settings and login.' })]);
  assert.equal(login.outcome, 'skipped');
  assert.equal(login.reason, 'needs-credentials');
  assert.equal(judgeLoad({ ok: false, error: 'This provider requires an API key.' }).outcome, 'skipped');
});

test('catalogue: one usable row passes; no main page is a capability, not a failure', () => {
  const good = reply({ ok: true, sections: [{ items: [{ url: 'u' }] }] });
  const bad = reply({ ok: false, error: 'HTTP 503' });
  assert.equal(judgeCatalogue(true, [bad, good]).outcome, 'pass');
  assert.equal(judgeCatalogue(true, [bad]).outcome, 'fail');
  assert.equal(judgeCatalogue(true, []).outcome, 'fail');
  assert.equal(judgeCatalogue(false, []).outcome, 'unsupported');
});

test('search: results, none, and "does not implement" as a capability', () => {
  const byProvider = (json: unknown) => ({ ok: true, result: { byProvider: { P: JSON.stringify(json) } } });
  assert.equal(judgeSearch(byProvider({ ok: true, results: [{ url: 'u', name: 'n' }] }), 'P').outcome, 'pass');
  assert.equal(judgeSearch(byProvider({ ok: true, results: [{ name: 'no url' }] }), 'P').outcome, 'fail');
  const unsupported = judgeSearch(byProvider({ ok: false, error: 'This provider does not implement that operation.' }), 'P');
  assert.equal(unsupported.outcome, 'unsupported');
  assert.equal(judgeSearch({ ok: true, result: { byProvider: {} } }, 'P').outcome, 'fail');
});

test("detail: the handle loadLinks gets, and what kind it is", () => {
  const film = judgeDetail(reply({ ok: true, detail: { dataUrl: '{"id":1}', type: 'Movie', year: 2020 } }), 'https://p/f');
  assert.equal(film.handle, '{"id":1}');
  assert.equal(film.evidence.handle, 'json');
  const series = judgeDetail(reply({ ok: true, detail: { episodes: [{ data: 'https://p/e1', season: 1 }, { data: 'x', season: 2 }] } }), 'f');
  assert.equal(series.handle, 'https://p/e1');
  assert.equal(series.evidence.seasons, 2);
  assert.equal(judgeDetail(reply({ ok: true, found: false }), 'f').outcome, 'fail');
  assert.equal(judgeDetail(reply({ ok: true, detail: {} }), 'https://p/fallback').handle, 'https://p/fallback');
});

test('links: evidence is redacted, quirks are named, nothing is a failure that is not', () => {
  const judged = judgeLinks(
    reply({
      ok: true,
      links: [
        { url: 'https://cdn.x/v/abc123def/720.m3u8?token=SECRET', source: 'Ext', quality: 720, isM3u8: true, headers: { Referer: 'https://p/', Cookie: 'c' } },
        { url: 'magnet:?xt=urn:btih:abc', source: 'T', linkType: 'MAGNET' },
      ],
      subtitles: [{ lang: 'en', url: 'https://s/x.srt' }],
    })
  );
  assert.equal(judged.outcome, 'pass');
  assert.equal(judged.evidence.links, 2);
  assert.ok(!JSON.stringify(judged.evidence).includes('SECRET'));
  assert.deepEqual((judged.evidence.described as Array<{ headers: string[] }>)[0].headers, ['Referer', 'Cookie']);
  assert.ok(judged.quirks.includes('N-9'));
  assert.equal(judgeLinks(reply({ ok: true, links: [] })).outcome, 'fail');
  assert.equal(judgeLinks({ ok: false, error: 'timed out' }).outcome, 'fail');
});
