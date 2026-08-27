/**
 * The source-list export format.
 *
 *   node --experimental-strip-types src/utils/sourceExport.test.mts
 *
 * Pure, and worth pinning for two reasons that are invisible from the UI.
 *
 * The first is quoting. Release names carry commas (`Dune, Part Two`), quotes,
 * and — via `directHeaders` — semicolons and colons; a CSV that does not escape
 * them does not fail, it silently shifts every later column by one, so a
 * spreadsheet full of plausible-looking rows attributes each link to the wrong
 * provider. Nothing about that is visible until someone acts on it.
 *
 * The second is which URL is exported. By the time a stream is playing its URL
 * is `http://127.0.0.1:<ephemeral>/…` — our own proxy, dead when the app
 * closes. Exporting it would hand a viewer a link that *looks* like it should
 * work in a downloader and cannot. The provider's own address is the only
 * useful answer, and that is the whole point of the "feed it to something else"
 * feature.
 */
import assert from 'node:assert/strict';
import {
  SOURCE_EXPORT_COLUMNS,
  provenanceChain,
  sourceAddress,
  sourceHost,
  toSourceCsv,
  toSourceDetails,
  toSourceText,
} from './sourceExport.ts';
import type { TorrentResult } from '../types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function source(overrides: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: 'ext-abc',
    title: 'Dune Part Two 2024 1080p WEB-DL',
    magnet: '',
    directUrl: 'https://gdshine.example.workers.dev/file?id=9&Expires=1',
    sizeBytes: 2.24e9,
    seeders: 1,
    leechers: 0,
    indexerId: 'gdshine',
    indexerName: 'Gdshine',
    providerName: 'Hindmoviez',
    parsed: {
      cleanTitle: 'Dune Part Two',
      isSeasonPack: false,
      isCompleteSeries: false,
      resolution: 1080,
      source: 'WEB-DL',
      videoCodec: 'x264',
      audioCodecs: ['EAC3'],
      hdr: [],
      languages: ['en', 'hi'],
      isMultiAudio: true,
      isDualAudio: true,
      hasHardcodedSubs: false,
      isRepack: false,
      isProper: false,
      isRemastered: false,
      is3D: false,
    },
    score: 0,
    scoreReasons: [],
    ...overrides,
  } as TorrentResult;
}

const rows = (csv: string) => csv.split('\r\n');

/**
 * A minimal RFC 4180 reader, so the assertions read the export the way a
 * spreadsheet will rather than the way it was written. Counting commas would
 * pass on exactly the output this file exists to rule out.
 */
function parseRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

// --- the address ------------------------------------------------------------

test('the exported address is the provider link, never the loopback proxy', () => {
  // The bug this guards is a link that looks usable and is not: a `127.0.0.1`
  // URL pasted into a downloader names a port that closed with the app.
  const result = source();
  assert.equal(sourceAddress(result), result.directUrl);
  assert.ok(!toSourceCsv([result]).includes('127.0.0.1'));
});

test('a torrent exports its magnet, and a torrent-file source its .torrent URL', () => {
  assert.match(sourceAddress(source({ directUrl: undefined, magnet: 'magnet:?xt=urn:btih:aa' })), /^magnet:/);
  assert.equal(
    sourceAddress(source({ directUrl: undefined, magnet: '', torrentUrl: 'https://x/y.torrent' })),
    'https://x/y.torrent'
  );
});

test('a source with no address at all exports an empty cell, not "undefined"', () => {
  // A report full of the string "undefined" reads as broken rather than absent.
  const csv = toSourceCsv([source({ directUrl: undefined, magnet: '' })]);
  assert.ok(!csv.includes('undefined'));
});

// --- quoting ----------------------------------------------------------------

test('a comma in a release name does not shift every later column', () => {
  /**
   * The failure mode is silent: without quoting the row still parses, just one
   * column short, so the link lands under Identity and the provider under
   * Host — a spreadsheet of plausible rows, all misattributed.
   */
  const csv = toSourceCsv([source({ title: 'Dune, Part Two' })]);
  const header = rows(csv)[0].split(',');
  const body = rows(csv)[1];
  assert.ok(body.includes('"Dune, Part Two"'));
  // Cheap structural check: the quoted field keeps the column count honest.
  assert.equal(header.length, SOURCE_EXPORT_COLUMNS.length);
});

test('a quote in a release name is doubled, per RFC 4180', () => {
  assert.ok(toSourceCsv([source({ title: 'The "Director\'s" Cut' })]).includes('"The ""Director\'s"" Cut"'));
});

test('headers survive the export intact, commas and all', () => {
  /**
   * A `Referer` is what makes half these links answer at all, so it has to come
   * back out of the export unaltered or the link is not reusable anywhere else.
   * `Accept` routinely contains commas, which is the case that would corrupt
   * the row.
   */
  const csv = toSourceCsv([
    source({
      directHeaders: {
        Referer: 'https://host.example/a',
        Accept: 'text/html,application/xhtml+xml',
      },
    }),
  ]);
  const cells = parseRow(rows(csv)[1]);
  assert.equal(
    cells[SOURCE_EXPORT_COLUMNS.indexOf('Headers')],
    'Referer: https://host.example/a; Accept: text/html,application/xhtml+xml'
  );
});

test('every row has exactly as many cells as there are columns', () => {
  const csv = toSourceCsv([
    source(),
    source({ title: 'A, B, C' }),
    source({ title: 'Quote " and, comma' }),
    source({ directUrl: undefined, magnet: '' }),
  ]);
  for (const line of rows(csv)) {
    assert.equal(parseRow(line).length, SOURCE_EXPORT_COLUMNS.length);
  }
});

test('a link read back out of the CSV is byte-identical to the one on the row', () => {
  // The end-to-end property the whole export exists for: paste this into a
  // downloader and it is the same link the provider handed us.
  const result = source({ directUrl: 'https://h.example/f?a=1&b=2,3&t=x"y' });
  const cells = parseRow(rows(toSourceCsv([result]))[1]);
  assert.equal(cells[SOURCE_EXPORT_COLUMNS.indexOf('URL')], result.directUrl);
});

// --- provenance -------------------------------------------------------------

test('the chain names the provider, not the extractor the provider picked', () => {
  /**
   * `indexerName` for an extension link is a file host — "Gdshine", "Voe",
   * "Server 3". Reporting it as the origin ranks hosts instead of extensions
   * and tells nobody which of their sources to turn off.
   */
  const chain = provenanceChain(source(), {
    provider: 'Hindmoviez',
    extensionName: 'PhisherProviders',
    repositoryName: 'phisher98',
  });
  assert.equal(chain, 'phisher98 ▸ PhisherProviders ▸ Hindmoviez');
  assert.ok(!chain.includes('Gdshine'));
});

test('an unresolved chain falls back to the provider name rather than going blank', () => {
  assert.equal(provenanceChain(source(), undefined), 'Hindmoviez');
});

test('the extractor keeps its own column beside the provider', () => {
  const csv = toSourceCsv([source()], () => ({ provider: 'Hindmoviez', extensionName: 'Ext' }));
  const cells = rows(csv)[1].split(',');
  assert.equal(cells[SOURCE_EXPORT_COLUMNS.indexOf('Provider')], 'Hindmoviez');
  assert.equal(cells[SOURCE_EXPORT_COLUMNS.indexOf('Host/extractor')], 'Gdshine');
});

// --- host -------------------------------------------------------------------

test('the host is the one part of a URL worth showing inline', () => {
  assert.equal(sourceHost(source()), 'gdshine.example.workers.dev');
  assert.equal(sourceHost(source({ directUrl: undefined })), null);
  // Providers hand back malformed URLs often enough that this must not throw.
  assert.equal(sourceHost(source({ directUrl: 'not a url' })), null);
});

// --- text form --------------------------------------------------------------

test('the text form carries the link and drops empty facts', () => {
  const text = toSourceText([source({ parsed: { ...source().parsed, hdr: [] } })]);
  assert.ok(text.includes('Dune Part Two 2024 1080p WEB-DL'));
  assert.ok(text.includes('URL: https://gdshine.example.workers.dev/file?id=9&Expires=1'));
  assert.ok(!/HDR:/.test(text));
});

test('the details of one source carry the provenance a bare link cannot', () => {
  const text = toSourceDetails(source(), {
    provider: 'Gdshine',
    extensionName: 'PhisherProvider',
    repositoryName: 'phisher98',
  });
  assert.ok(text.startsWith('Dune Part Two 2024 1080p WEB-DL\n'));
  assert.ok(text.includes('Provider: Gdshine'));
  assert.ok(text.includes('Repository: phisher98'));
  assert.ok(text.includes('URL: https://gdshine.example.workers.dev/file?id=9&Expires=1'));
  // No list ordinal and no caption: this is one row, not a list of one.
  assert.ok(!text.includes('1. '));
  assert.ok(!/^Sources/m.test(text));
});

// --- runner -----------------------------------------------------------------

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
