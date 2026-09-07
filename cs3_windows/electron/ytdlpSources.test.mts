/**
 * What yt-dlp's answer is allowed to become.
 *
 *   bun run test:ytdlp
 *   node --experimental-strip-types electron/ytdlpSources.test.mts
 *
 * This lane shipped with two defects and no caller, which is why both are
 * pinned here rather than described in a comment. The transport was read from
 * the URL string with `protocol` unread in the same object, and any format with
 * *either* a video or an audio stream was offered — so on every DASH site the
 * top rows were video-only, and a video-only row plays perfectly, in silence,
 * with no error event. That is the exact failure signature the AC-3 work in
 * AGENTS.md §5 spent weeks on; a viewer reads it as a broken app.
 */
import assert from 'node:assert/strict';

import { looksLikeWebPage, mapYtDlpInfo, MAX_ROWS, type YtDlpInfo } from './ytdlpSources.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const PAGE = 'https://example.com/watch/123';

const info = (formats: YtDlpInfo['formats'], extra: Partial<YtDlpInfo> = {}): YtDlpInfo => ({
  title: 'Some Film',
  extractor_key: 'Example',
  formats,
  ...extra,
});

// --- the silent-video defect ----------------------------------------------

test('a video-only format is never offered', () => {
  // It plays, it looks right, and it has no sound. Offering it is worse than
  // offering nothing, because the viewer blames the app rather than the format.
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/v.mp4', protocol: 'https', vcodec: 'avc1', acodec: 'none', height: 1080 }]),
    PAGE
  );
  assert.equal(rows.length, 0);
});

test('an audio-only format is never offered', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/a.m4a', protocol: 'https', vcodec: 'none', acodec: 'mp4a', height: 0 }]),
    PAGE
  );
  assert.equal(rows.length, 0);
});

test('a muxed format is offered', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/m.mp4', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 720 }]),
    PAGE
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].directUrl, 'https://cdn/m.mp4');
});

test('a manifest is offered even though its codec fields are unset', () => {
  // An HLS or DASH format names its tracks inside the manifest, so demanding
  // both codecs here would drop every adaptive site.
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/master.m3u8', protocol: 'm3u8_native', height: 1080 }]),
    PAGE
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isM3u8, true);
});

test('a storyboard is not a video', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/sb.mhtml', protocol: 'mhtml', ext: 'mhtml', vcodec: 'none', acodec: 'none' }]),
    PAGE
  );
  assert.equal(rows.length, 0);
});

// --- the transport-from-the-URL defect ------------------------------------

test('the transport comes from protocol, not from the address', () => {
  // The address says nothing; `protocol` says HLS. The old mapper matched
  // `.m3u8` in the URL and would have called this progressive.
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/stream.php?id=9', protocol: 'm3u8_native', height: 720 }]),
    PAGE
  );
  assert.equal(rows[0].isM3u8, true);
  assert.equal(rows[0].isDash, undefined);
});

test('DASH is recognised by protocol', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/x', protocol: 'http_dash_segments', height: 2160 }]),
    PAGE
  );
  assert.equal(rows[0].isDash, true);
  assert.equal(rows[0].isM3u8, undefined);
});

test('a progressive file whose URL happens to contain m3u8 is not a playlist', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/m3u8/movie.mp4', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 1080 }]),
    PAGE
  );
  assert.equal(rows[0].isM3u8, undefined);
  assert.equal(rows[0].isDash, undefined);
});

// --- shape -----------------------------------------------------------------

test('rows are ordered best first and deduped by height and transport', () => {
  const rows = mapYtDlpInfo(
    info([
      { url: 'https://cdn/a', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 720, tbr: 800 },
      { url: 'https://cdn/b', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 1080, tbr: 4000 },
      { url: 'https://cdn/c', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 1080, tbr: 2500 },
    ]),
    PAGE
  );
  assert.deepEqual(rows.map((r) => r.parsed.resolution), [1080, 720]);
  // Of two 1080p rows the higher bitrate survives; six renderings of one choice
  // push the genuine fallback off the screen.
  assert.equal(rows[0].directUrl, 'https://cdn/b');
});

test('a single-format extractor reports at the top level and still maps', () => {
  const rows = mapYtDlpInfo(
    {
      title: 'Live Channel',
      url: 'https://cdn/live.m3u8',
      protocol: 'm3u8_native',
      http_headers: { Referer: 'https://example.com/' },
    },
    PAGE
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].directHeaders, { Referer: 'https://example.com/' });
});

test('per-format headers win over the top-level ones', () => {
  // A manifest and its segments are frequently served by different hosts.
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/x.m3u8', protocol: 'm3u8_native', http_headers: { Referer: 'https://cdn/' } }],
      { http_headers: { Referer: 'https://page/' } }),
    PAGE
  );
  assert.deepEqual(rows[0].directHeaders, { Referer: 'https://cdn/' });
});

test('the row count is bounded', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    url: `https://cdn/${i}`, protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 100 + i,
  }));
  assert.equal(mapYtDlpInfo(info(many), PAGE).length, MAX_ROWS);
});

test('every row is a direct source and none is a torrent', () => {
  const rows = mapYtDlpInfo(
    info([{ url: 'https://cdn/m.mp4', protocol: 'https', vcodec: 'avc1', acodec: 'mp4a', height: 720 }]),
    PAGE
  );
  assert.equal(rows[0].magnet, '');
  assert.match(rows[0].infoHash, /^ext-[0-9a-f]{20}$/);
  assert.equal(rows[0].fileIndex, undefined);
  // `minSeeders` defaults to 1 and would otherwise hard-reject the row.
  assert.ok(rows[0].seeders >= 1);
});

test('a page with no formats produces no rows rather than an invented one', () => {
  assert.deepEqual(mapYtDlpInfo(info([]), PAGE), []);
  assert.deepEqual(mapYtDlpInfo({}, PAGE), []);
});

// --- what counts as a page -------------------------------------------------

test('a page address is recognised', () => {
  assert.equal(looksLikeWebPage('https://example.com/watch/1'), true);
  assert.equal(looksLikeWebPage('http://example.co.uk/v?id=2'), true);
  assert.equal(looksLikeWebPage('  https://example.com/x  '), true);
});

test('a search term is not a page address', () => {
  // The search box routes on this, so a false positive turns a real search into
  // a yt-dlp call that can only fail.
  assert.equal(looksLikeWebPage('dune part two'), false);
  assert.equal(looksLikeWebPage('magnet:?xt=urn:btih:abc'), false);
  assert.equal(looksLikeWebPage('cs3ext://Provider/handle'), false);
  assert.equal(looksLikeWebPage('http://localhost'), false);
  assert.equal(looksLikeWebPage('https://'), false);
  assert.equal(looksLikeWebPage(''), false);
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
