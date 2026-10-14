import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { readTsStreams } from './tsProgram.ts';

// The first three packets (SDT, PAT, PMT) of a real Castle TV segment, served
// as `0.jpg`: one H.264 stream and four AAC languages, no `#EXT-X-MEDIA`.
const castle = new Uint8Array(fs.readFileSync(new URL('./fixtures/castle-tv-4audio-head.ts', import.meta.url)));

test('every audio language muxed into the segment is found, in PMT order', () => {
  const streams = readTsStreams(castle);
  assert.ok(streams);
  assert.deepEqual(
    streams.map((s) => [s.kind, s.codec, s.language ?? null]),
    [
      ['video', 'h264', null],
      ['audio', 'aac', 'eng'],
      ['audio', 'aac', 'hin'],
      ['audio', 'aac', 'tam'],
      ['audio', 'aac', 'tel'],
    ]
  );
});

test('bytes that are not transport stream answer null, not a guess', () => {
  assert.equal(readTsStreams(new TextEncoder().encode('#EXTM3U\n#EXTINF:4,\nseg.ts\n'.repeat(40))), null);
  assert.equal(readTsStreams(new Uint8Array(0)), null);
  // fMP4 (ftyp box) is not TS either.
  assert.equal(readTsStreams(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...new Array(600).fill(0)])), null);
});

test('a segment starting mid-packet (PNG-wrapped, offset) is still aligned', () => {
  const padded = new Uint8Array(70 + castle.length);
  padded.set(castle, 70);
  assert.equal(readTsStreams(padded)?.filter((s) => s.kind === 'audio').length, 4);
});
