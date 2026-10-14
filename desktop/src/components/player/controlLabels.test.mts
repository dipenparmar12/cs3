import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlLanguageLabel, numberedLanguageLabel } from './controlLabels.ts';

test('player control labels show a language, not subtitle release metadata', () => {
  assert.equal(controlLanguageLabel('', 'English SDH WEB-DL 1080p.srt'), 'English');
  assert.equal(controlLanguageLabel('hi', 'Hindi AAC 5.1'), 'Hindi');
});

test('player control labels distinguish duplicate language tracks concisely', () => {
  const tracks = [
    { label: 'English SDH' },
    { label: 'English commentary' },
    { label: 'Hindi' },
  ];
  assert.equal(numberedLanguageLabel(undefined, 'English SDH', tracks), 'English 1');
  assert.equal(numberedLanguageLabel(undefined, 'English commentary', tracks), 'English 2');
  assert.equal(numberedLanguageLabel(undefined, 'Hindi', tracks), 'Hindi');
});

test('player control labels handle single tracks without numbers', () => {
  const single = [{ label: 'Japanese [Audio]' }];
  assert.equal(numberedLanguageLabel(undefined, 'Japanese [Audio]', single), 'Japanese');
});

test('player control labels fallback cleanly for unknown tracks', () => {
  assert.equal(controlLanguageLabel('', ''), '');
  assert.equal(numberedLanguageLabel(undefined, undefined, []), 'Subtitles');
});

