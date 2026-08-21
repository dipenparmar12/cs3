/**
 * Pins every formatter to the exact string its call site produced before this
 * module existed.
 *
 *   node --experimental-strip-types src/utils/format.test.mts
 *
 * Six copies of "format a byte count" were consolidated here, and **the six did
 * not agree** — different zero placeholders, different bases, different
 * precision. The whole risk of that consolidation is picking one behaviour and
 * quietly changing what five screens display, so the expectations below were
 * computed from the *old* implementations rather than from what seemed
 * reasonable.
 *
 * Read a surprising expectation as documentation of what shipped, not as an
 * endorsement. `formatDownloadSize(0) === 'Unknown'` while
 * `formatPanelSize(0) === '0 MB'` for the same condition, and that inconsistency
 * is real and preserved. Changing it is a UI decision; this file only makes sure
 * it does not change by accident.
 */
import assert from 'node:assert/strict';
import {
  formatBytes,
  formatCompactBytes,
  formatDownloadSize,
  formatHistorySize,
  formatPanelSize,
  formatReleaseSize,
  formatRuntime,
  formatTimecode,
  formatTransferRate,
} from './format.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

// --- formatBytes: the full ladder (was SourcePicker.formatBytes) ------------

test('formatBytes climbs the unit ladder in binary steps', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(KIB), '1.0 KB');
  assert.equal(formatBytes(MIB), '1.0 MB');
  assert.equal(formatBytes(GIB), '1.0 GB');
  assert.equal(formatBytes(GIB * 1024), '1.0 TB');
});

test('formatBytes drops the decimal once the number is large enough to read', () => {
  // `950 MB` and `1.4 GB` both scan; `950.0 MB` and `1 GB` do not.
  assert.equal(formatBytes(9.5 * MIB), '9.5 MB');
  assert.equal(formatBytes(10 * MIB), '10 MB');
  assert.equal(formatBytes(1.4 * GIB), '1.4 GB');
});

test('formatBytes never shows a fractional byte', () => {
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(1023), '1023 B');
});

test('formatBytes stops at TB rather than running off the ladder', () => {
  assert.equal(formatBytes(GIB * 1024 * 5000), '5000 TB');
});

test('formatBytes answers the caller placeholder for nothing', () => {
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(0, 'Unknown'), 'Unknown');
});

// --- formatCompactBytes (was ProvenancePanel.formatSize) --------------------

test('formatCompactBytes covers the extension-archive range', () => {
  assert.equal(formatCompactBytes(0), '0 B');
  assert.equal(formatCompactBytes(900), '900 B');
  assert.equal(formatCompactBytes(2048), '2.0 KB');
  assert.equal(formatCompactBytes(3 * MIB), '3.00 MB');
  // Stops at MB on purpose: no `.cs3` archive reaches a gigabyte.
  assert.equal(formatCompactBytes(2 * GIB), '2048.00 MB');
});

// --- the media-size presets ------------------------------------------------

test('formatDownloadSize matches what the file manager will say', () => {
  // Base 1024, so the number agrees with the OS once the file lands.
  assert.equal(formatDownloadSize(500 * MIB), '500 MB');
  assert.equal(formatDownloadSize(2 * GIB), '2.00 GB');
  assert.equal(formatDownloadSize(1023 * MIB), '1023 MB');
});

test('formatReleaseSize uses SI, because the provider quoted SI', () => {
  /**
   * The one difference here with a user-visible consequence: a release listed
   * as "4.3 GB" on the site it was scraped from must not be redrawn as
   * "4.00 GB", or the viewer comparing the two reads them as different files.
   */
  assert.equal(formatReleaseSize(4.3e9), '4.30 GB');
  assert.equal(formatReleaseSize(700e6), '700 MB');
  assert.equal(formatReleaseSize(1e9), '1.00 GB');
});

test('the two bases genuinely disagree about the same file', () => {
  const fourPointThreeGigabytes = 4.3e9;
  assert.equal(formatReleaseSize(fourPointThreeGigabytes), '4.30 GB');
  assert.equal(formatDownloadSize(fourPointThreeGigabytes), '4.00 GB');
});

test('formatHistorySize carries one more decimal below a gigabyte', () => {
  assert.equal(formatHistorySize(500 * MIB), '500.0 MB');
  assert.equal(formatHistorySize(2 * GIB), '2.00 GB');
});

test('the zero placeholders differ by surface, and that is preserved', () => {
  assert.equal(formatDownloadSize(0), 'Unknown');
  assert.equal(formatPanelSize(0), '0 MB');
  assert.equal(formatReleaseSize(0), '—');
  assert.equal(formatHistorySize(0), 'Unknown size');
  assert.equal(formatHistorySize(undefined), 'Unknown size');
});

test('a negative size is treated as absent rather than rendered', () => {
  assert.equal(formatDownloadSize(-1), 'Unknown');
  assert.equal(formatReleaseSize(-1), '—');
});

// --- transfer rates --------------------------------------------------------

test('formatTransferRate switches to MB/s at one megabyte', () => {
  assert.equal(formatTransferRate(MIB), '1.0 MB/s');
  assert.equal(formatTransferRate(MIB * 12.34), '12.3 MB/s');
  assert.equal(formatTransferRate(500 * KIB), '500 KB/s');
});

test('formatTransferRate answers 0 KB/s for a stalled transfer', () => {
  // Not an em dash and not blank: a download list showing nothing next to a
  // task reads as a rendering bug, where `0 KB/s` reads as a stall.
  assert.equal(formatTransferRate(0), '0 KB/s');
  assert.equal(formatTransferRate(-5), '0 KB/s');
});

test('formatTransferRate honours the SI base the player uses', () => {
  assert.equal(formatTransferRate(1e6, 1000), '1.0 MB/s');
  assert.equal(formatTransferRate(500e3, 1000), '500 KB/s');
});

// --- durations -------------------------------------------------------------

test('formatTimecode drops the hour field below an hour', () => {
  assert.equal(formatTimecode(0), '0:00');
  assert.equal(formatTimecode(9), '0:09');
  assert.equal(formatTimecode(75), '1:15');
  assert.equal(formatTimecode(599), '9:59');
});

test('formatTimecode zero-pads minutes once hours appear', () => {
  assert.equal(formatTimecode(3600), '1:00:00');
  assert.equal(formatTimecode(3661), '1:01:01');
  assert.equal(formatTimecode(7384), '2:03:04');
});

test('formatTimecode survives the NaN duration a video element starts with', () => {
  // `video.duration` is NaN until metadata loads. A timeline reading `NaN:NaN`
  // looks like a crash in the two seconds before the real value arrives.
  assert.equal(formatTimecode(NaN), '0:00');
  assert.equal(formatTimecode(Infinity), '0:00');
  assert.equal(formatTimecode(-10), '0:00');
});

test('formatRuntime reads as prose and omits itself when unknown', () => {
  assert.equal(formatRuntime(45 * 60), '45 min');
  assert.equal(formatRuntime(59 * 60), '59 min');
  // The switch is at exactly an hour, so a feature-length film reads in hours
  // and minutes rather than as a three-digit minute count.
  assert.equal(formatRuntime(60 * 60), '1h 0m');
  assert.equal(formatRuntime(95 * 60), '1h 35m');
  assert.equal(formatRuntime(135 * 60), '2h 15m');
  // null, not a dash: the caller omits the field rather than printing a
  // placeholder into a row that has plenty of real metadata in it.
  assert.equal(formatRuntime(0), null);
  assert.equal(formatRuntime(undefined), null);
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
