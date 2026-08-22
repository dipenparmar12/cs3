/**
 * What the torrent-index parser is allowed to conclude from a page.
 *
 *   bun run test:extto
 *   node --experimental-strip-types electron/extensions/providers/extToParser.test.mts
 *
 * These matter more than usual because **the live site could not be reached
 * from the environment this was written in** — `ext.to` is blocked by the
 * egress policy here. So the parser is written to the structure every torrent
 * index shares rather than to one site's class names, and these fixtures are
 * what pin that claim: the same rows in a table layout, a card layout, with and
 * without magnets, with and without seeder classes.
 *
 * A parser failure on a site like this is silent — zero rows reads exactly like
 * a site with nothing for that title — which is why "a page that parses to
 * nothing is a failure, not an answer" is enforced by the provider and pinned
 * here.
 */
import assert from 'node:assert/strict';
import {
  displayNameFromMagnet,
  parseDetailMagnet,
  parseSearchResults,
} from './extToParser.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const BASE = 'https://ext.to';
const HASH = 'a'.repeat(40);
const HASH2 = 'b'.repeat(40);

const magnet = (hash: string, name: string) =>
  `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}&tr=udp%3A%2F%2Ftracker.example%3A80`;

/** The shape every one of these sites has used for twenty years. */
const TABLE = `<!doctype html><html><body>
<table>
  <thead><tr><th>Name</th><th>Size</th><th>S</th><th>L</th></tr></thead>
  <tbody>
    <tr>
      <td><a href="${magnet(HASH, 'Dune Part Two 2024 2160p WEB-DL x265 10bit HDR-GROUP')}">magnet</a>
          <a href="/torrent/12345/dune-part-two/" title="Dune Part Two 2024 2160p WEB-DL x265 10bit HDR-GROUP">Dune Part Two 2024 2160p…</a></td>
      <td>18.4 GB</td><td>1,204</td><td>88</td>
    </tr>
    <tr>
      <td><a href="/torrent/67890/dune-2021/" title="Dune 2021 1080p BluRay x264-OTHER">Dune 2021 1080p BluRay…</a></td>
      <td>2.1 GB</td><td>430</td><td>12</td>
    </tr>
  </tbody>
</table></body></html>`;

// --- the ordinary case -----------------------------------------------------

test('a table of results is read', () => {
  const rows = parseSearchResults(TABLE, BASE);
  assert.equal(rows.length, 2);
});

test('the magnet and its infohash are taken from the row', () => {
  const [first] = parseSearchResults(TABLE, BASE);
  assert.ok(first.magnet?.startsWith('magnet:?'));
  assert.equal(first.infoHash, HASH);
});

test('the title comes from the magnet rather than the truncated link text', () => {
  // `releaseParser` reads quality, codec and group out of this string, and the
  // visible anchor was cut with an ellipsis — losing exactly the tail where the
  // group and often the resolution live.
  const [first] = parseSearchResults(TABLE, BASE);
  assert.equal(first.title, 'Dune Part Two 2024 2160p WEB-DL x265 10bit HDR-GROUP');
});

test('the title falls back to the link title attribute, not its truncated text', () => {
  const rows = parseSearchResults(TABLE, BASE);
  assert.equal(rows[1].title, 'Dune 2021 1080p BluRay x264-OTHER');
});

test('size, seeders and leechers come out of the cells beside it', () => {
  const [first] = parseSearchResults(TABLE, BASE);
  assert.equal(first.sizeBytes, 18.4 * 1e9);
  assert.equal(first.seeders, 1204);
  assert.equal(first.leechers, 88);
});

test('a row with no magnet keeps its detail page for the second hop', () => {
  const rows = parseSearchResults(TABLE, BASE);
  assert.equal(rows[1].magnet, undefined);
  assert.equal(rows[1].detailUrl, 'https://ext.to/torrent/67890/dune-2021/');
});

test('a header row is not a result', () => {
  // It sits in the same table and parses into plausible-looking garbage if the
  // "must point at a torrent" rule is dropped.
  const rows = parseSearchResults(TABLE, BASE);
  assert.ok(!rows.some((row) => row.title.toLowerCase() === 'name'));
});

// --- the layouts that are not tables --------------------------------------

test('a card layout is read the same way', () => {
  const html = `<!doctype html><html><body>
    <div class="torrent-list">
      <div class="row">
        <a href="${magnet(HASH2, 'Interstellar 2014 1080p BluRay x264')}">get</a>
        <span class="size">14.2 GB</span>
        <span class="seeds">902</span>
        <span class="leech">40</span>
      </div>
    </div></body></html>`;
  const rows = parseSearchResults(html, BASE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].infoHash, HASH2);
  assert.equal(rows[0].seeders, 902);
  assert.equal(rows[0].leechers, 40);
});

test('seeder and leecher classes beat cell position', () => {
  // Position is the fallback, not the rule: a layout that puts the date between
  // the size and the seeders would otherwise report the year as a seeder count.
  const html = `<!doctype html><html><body><table><tr>
      <td><a href="${magnet(HASH, 'A Release 1080p')}">m</a></td>
      <td>1.5 GB</td>
      <td>2024</td>
      <td class="sl-s">55</td>
      <td class="sl-l">3</td>
    </tr></table></body></html>`;
  const [row] = parseSearchResults(html, BASE);
  assert.equal(row.seeders, 55);
  assert.equal(row.leechers, 3);
});

// --- what must never happen -----------------------------------------------

test('a page with no results parses to nothing rather than to junk', () => {
  // The provider treats zero rows as a failure, which is only correct if this
  // never invents rows out of navigation and advertising markup.
  const html = `<!doctype html><html><body>
    <table><tr><td>No results found for "asdkjhasd"</td></tr></table>
    <ul class="pagination"><li><a href="/search/?p=2">2</a></li></ul>
    </body></html>`;
  assert.equal(parseSearchResults(html, BASE).length, 0);
});

test('a parked page full of links is not a results page', () => {
  const html = `<!doctype html><html><body>
    <table><tr><td><a href="/about">About</a></td><td><a href="/contact">Contact</a></td></tr></table>
    </body></html>`;
  assert.equal(parseSearchResults(html, BASE).length, 0);
});

test('the same release listed twice becomes one row', () => {
  // Sites list a torrent under two categories routinely, and two rows for one
  // release becomes two sources offering identical bytes.
  const row = `<tr><td><a href="${magnet(HASH, 'Dune 2021')}">m</a></td><td>2.1 GB</td><td>10</td><td>1</td></tr>`;
  const rows = parseSearchResults(`<table>${row}${row}</table>`, BASE);
  assert.equal(rows.length, 1);
});

test('an unparseable size does not become a tiny file', () => {
  // `ranker.ts` treats 0 as unknown rather than as "smallest", which is the
  // only safe reading — a release with no size must not sort above a real one.
  const html = `<table><tr><td><a href="${magnet(HASH, 'Some Release 1080p')}">m</a></td><td>—</td><td>5</td></tr></table>`;
  assert.equal(parseSearchResults(html, BASE)[0].sizeBytes, 0);
});

// --- magnets ---------------------------------------------------------------

test('the display name is decoded, including plus-as-space', () => {
  assert.equal(displayNameFromMagnet('magnet:?xt=urn:btih:x&dn=Dune+Part+Two'), 'Dune Part Two');
  assert.equal(displayNameFromMagnet(`magnet:?dn=${encodeURIComponent('A B [C]')}`), 'A B [C]');
});

test('a magnet with no display name yields none rather than an empty title', () => {
  assert.equal(displayNameFromMagnet(`magnet:?xt=urn:btih:${HASH}`), undefined);
});

test('a detail page yields its magnet', () => {
  const html = `<html><body><a class="dl" href="${magnet(HASH2, 'Thing')}">Download</a></body></html>`;
  assert.equal(parseDetailMagnet(html).infoHash, HASH2);
});

test('a detail page that prints only a hash still yields one', () => {
  const html = `<html><body><dl><dt>Info hash</dt><dd>${HASH2.toUpperCase()}</dd></dl></body></html>`;
  const found = parseDetailMagnet(html);
  assert.equal(found.infoHash, HASH2);
  assert.equal(found.magnet, undefined);
});

test('a 64-character checksum is not mistaken for an infohash', () => {
  // A `\b`-anchored match takes the first forty characters of a SHA-256 happily,
  // and the result is a plausible-looking hash for a torrent that does not
  // exist. Only a run of exactly forty counts.
  const html = `<html><body><p>SHA-256: ${'c'.repeat(64)}</p></body></html>`;
  assert.equal(parseDetailMagnet(html).infoHash, undefined);
});

test('a hash printed with no whitespace around it is still found', () => {
  // `text()` concatenates adjacent elements, so `<dt>Info hash</dt><dd>…</dd>`
  // has no boundary before the hash at all. The raw markup always does.
  const html = `<html><body><dl><dt>Info hash</dt><dd>${HASH2}</dd></dl></body></html>`;
  assert.equal(parseDetailMagnet(html).infoHash, HASH2);
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
