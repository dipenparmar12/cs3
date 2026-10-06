import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSubtitleDuration, durationCloseness, lastCueEndSeconds, subtitleFitsMedia } from './subtitleDuration.ts';

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

test('an extended cut or PAL timing is tolerated: within 20 minutes or 20% over', () => {
  // Theatrical 2h, subtitle timed to a 2h15m extended cut.
  assert.equal(assessSubtitleDuration(2 * 3600 + 15 * 60, 2 * 3600), 'compatible');
  // PAL speed-up: 4% shorter.
  assert.equal(assessSubtitleDuration(2 * 3600 * 0.96, 2 * 3600), 'compatible');
  // Past both bounds is another work.
  assert.equal(assessSubtitleDuration(2 * 3600 + 25 * 60, 2 * 3600), 'mismatch');
});

test('closeness prefers the file that ends just before the credits', () => {
  const cue = (end: number) => {
    const t = (s: number) => new Date(s * 1000).toISOString().slice(11, 23);
    return `WEBVTT\n\n${t(end - 2)} --> ${t(end)}\nLast line`;
  };
  const media = 2 * 3600;
  assert.equal(durationCloseness(cue(media - 5 * 60), media), 1);
  assert.ok(durationCloseness(cue(media + 10 * 60), media) < durationCloseness(cue(media - 10 * 60), media));
  assert.equal(durationCloseness('no cues', media), 0.5);
});
