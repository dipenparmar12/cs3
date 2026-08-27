/**
 * Tests for Media History CSV export functionality.
 *
 *   node --experimental-strip-types src/utils/historyExport.test.mts
 */
import assert from 'node:assert/strict';
import {
  HISTORY_EXPORT_COLUMNS,
  historyExportRow,
  toHistoryCsv,
} from './historyExport.ts';
import type { HistoryEvent } from '../types/history.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function createEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: 'ev-test-123',
    mediaKey: 'interstellar:2014',
    title: 'Interstellar',
    year: 2014,
    type: 'movie',
    mediaUrl: 'https://provider.example/interstellar',
    action: 'playback_completed',
    status: 'Played',
    timestamp: 1772183400000,
    durationSeconds: 9600,
    source: {
      providerName: 'Cineb',
      indexerName: 'StreamTape',
      sourceName: 'Interstellar.2014.1080p.BluRay.x265',
      resolution: 1080,
      quality: '1080p',
      videoCodec: 'HEVC',
      audioCodecs: ['AAC', 'AC3'],
      languages: ['English', 'Spanish'],
      sizeBytes: 4.5e9,
      directUrl: 'https://cdn.example.com/video.mp4?token=abc',
      magnet: '',
      directHeaders: { 'User-Agent': 'CloudStream/3.0', Referer: 'https://provider.example' },
    },
    failureReason: '',
    diagnostics: {
      stage: 'probe',
      code: 'OK',
      details: 'Container mp4 probed cleanly',
    },
    ...overrides,
  };
}

// --- 1. Columns & Header Structure -----------------------------------------

test('CSV header matches defined column schema', () => {
  const csv = toHistoryCsv([]);
  const headerLine = csv.split('\r\n')[0];
  const columns = headerLine.split(',');
  assert.equal(columns.length, HISTORY_EXPORT_COLUMNS.length);
  assert.equal(columns[0], '#');
  assert.equal(columns[3], 'Title');
  assert.equal(columns[10], 'Status');
});

// --- 2. Row data mapping ----------------------------------------------------

test('historyExportRow maps all fields and source metadata', () => {
  const ev = createEvent();
  const row = historyExportRow(ev, 0);

  assert.equal(row[0], '1'); // Index
  assert.equal(row[1], 'ev-test-123'); // ID
  assert.equal(row[3], 'Interstellar'); // Title
  assert.equal(row[4], '2014'); // Year
  assert.equal(row[9], 'playback_completed'); // Action
  assert.equal(row[10], 'Played'); // Status
  assert.equal(row[15], 'Cineb'); // Provider
  assert.equal(row[16], 'StreamTape'); // Extractor
  assert.equal(row[18], '1080p'); // Resolution
  assert.equal(row[20], 'HEVC'); // Video Codec
  assert.equal(row[21], 'AAC / AC3'); // Audio Codecs
  assert.equal(row[22], 'English / Spanish'); // Languages
  assert.equal(row[26], 'https://cdn.example.com/video.mp4?token=abc'); // Direct URL
  assert.ok(row[34].includes('User-Agent: CloudStream/3.0')); // Request Headers
});

// --- 3. RFC 4180 Escaping ---------------------------------------------------

test('escaping handles quotes, commas, and newlines in failure reasons and details', () => {
  const ev = createEvent({
    title: 'Show, The: "Special Edition"',
    failureReason: 'Error: Connection lost,\r\nretry failed with "404 Not Found"',
  });

  const csv = toHistoryCsv([ev]);
  assert.ok(csv.includes('"Show, The: ""Special Edition"""'));
  assert.ok(csv.includes('"Error: Connection lost,\r\nretry failed with ""404 Not Found"""'));
});

// --- 4. Multi-item export ---------------------------------------------------

test('toHistoryCsv generates correct multi-row output', () => {
  const ev1 = createEvent({ id: '1', title: 'Movie 1' });
  const ev2 = createEvent({ id: '2', title: 'Movie 2' });
  const ev3 = createEvent({ id: '3', title: 'Movie 3' });

  const csv = toHistoryCsv([ev1, ev2, ev3]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 4); // Header + 3 rows
});

// --- Run suite -------------------------------------------------------------

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
