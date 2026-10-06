import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSubtitleDuration, lastCueEndSeconds, subtitleFitsMedia } from './subtitleDuration.ts';

const vtt = (end: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n\n${end} --> ${end}\nBye\n`;

test('reads the last cue end from VTT and SRT', () => {
  assert.equal(lastCueEndSeconds(vtt('01:02:03.500')), 3723.5);
  assert.equal(lastCueEndSeconds('1\n00:00:01,000 --> 00:59:00,250\nx\n'), 3540.25);
  assert.equal(lastCueEndSeconds('WEBVTT\n\n00:10.000 --> 00:12.000\nshort form\n'), 12);
  assert.equal(lastCueEndSeconds('not a subtitle'), null);
});

test('ending before the credits is compatible', () => {
  assert.equal(assessSubtitleDuration(3600 - 8 * 60, 3600), 'compatible');
});

test('a subtitle twice as long as the film is a mismatch', () => {
  assert.equal(assessSubtitleDuration(2 * 3600 + 300, 3600), 'mismatch');
  assert.equal(subtitleFitsMedia(vtt('02:05:00.000'), 3600), false);
});

test('a subtitle covering a fraction of the film is a mismatch', () => {
  assert.equal(assessSubtitleDuration(20 * 60, 2 * 3600), 'mismatch');
});

test('unknown media duration never refuses', () => {
  assert.equal(assessSubtitleDuration(9999, 0), 'unknown');
  assert.equal(subtitleFitsMedia(vtt('05:00:00.000'), Number.NaN), true);
});
