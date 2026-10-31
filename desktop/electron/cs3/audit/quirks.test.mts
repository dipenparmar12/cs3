import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectQuirks, type QuirkCode, type SourceObservation } from './quirks.ts';
import type { SniffResult } from './sourceSniff.ts';

const s = (kind: SniffResult['kind']): SniffResult => ({ kind, confidence: 'high', evidence: '' });
const clean: SourceObservation = {
  url: 'https://cdn.example.com/film.mp4',
  contentType: 'video/mp4',
  sniff: s('mp4'),
  redirects: 0,
  range: 'honoured',
  contentLength: 1000,
};
const codes = (o: SourceObservation) => detectQuirks(o).map((q) => q.code);

test('a clean source fires nothing', () => {
  assert.deepEqual(codes(clean), []);
  assert.deepEqual(codes({ ...clean, contentType: 'application/octet-stream' }), []);
  assert.deepEqual(codes({ url: 'https://x/a.m3u8', sniff: s('m3u8'), segmentUrls: ['s1.ts', 'https://x/s2.ts'].map((u) => new URL(u, 'https://x/').href) }), []);
});

test('each detector fires on its own evidence (AC-4)', () => {
  const cases: Array<[QuirkCode, SourceObservation]> = [
    ['N-1', { ...clean, url: 'https://cdn.example.com/poster.jpg' }],
    ['N-2', { ...clean, contentType: 'text/html; charset=utf-8' }],
    ['N-3', { ...clean, url: 'https://x/seg.png', contentType: 'image/png', sniff: s('png+ts') }],
    ['N-4', { ...clean, url: 'https://x/a.m3u8', contentType: undefined, sniff: s('m3u8'), segmentUrls: ['https://x/a.css', 'https://x/b'] }],
    ['N-5', { ...clean, redirects: 3 }],
    ['N-6', { ...clean, contentType: undefined, sniff: { kind: 'json', confidence: 'low', evidence: '' } }],
    ['N-7', { ...clean, contentType: undefined, sniff: s('html') }],
    ['N-8', { url: 'rtmp://live.example/app/stream' }],
    ['N-9', { url: 'magnet:?xt=urn:btih:abc' }],
    ['N-10', { ...clean, live: true }],
    ['N-11', { ...clean, drm: 'clearkey' }],
    ['N-12', { ...clean, range: 'ignored' }],
    ['N-13', { ...clean, requiredHeaders: ['Referer'] }],
    ['N-14', { ...clean, contentLength: null }],
    ['N-15', { ...clean, subtitle: { format: 'srt', bom: true } }],
    ['N-16', { ...clean, url: 'https://x/film.mp4', contentType: undefined, sniff: s('archive') }],
    ['N-17', { ...clean, audioTracks: 2 }],
  ];
  for (const [code, observation] of cases) assert.ok(codes(observation).includes(code), `${code}: ${codes(observation)}`);
});

test('a plain UTF-8 WebVTT subtitle and a single-part link are not quirks', () => {
  assert.deepEqual(codes({ ...clean, subtitle: { format: 'vtt', charset: 'utf-8' }, playlistParts: 1, audioTracks: 0 }), []);
});

test('a low-confidence sniff never makes a mismatch', () => {
  assert.deepEqual(codes({ ...clean, sniff: { kind: 'mp3', confidence: 'low', evidence: '' } }), []);
});
