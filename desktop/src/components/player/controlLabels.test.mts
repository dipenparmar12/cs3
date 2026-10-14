import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlLanguageLabel, languageLabels } from './controlLabels.ts';

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
  assert.deepEqual(languageLabels(tracks), ['English 1', 'English 2', 'Hindi']);
});

test('identically named tracks still get distinct ordinals', () => {
  // Online results routinely arrive as several files all called "English".
  assert.deepEqual(languageLabels([{ label: 'English' }, { label: 'English' }, { label: 'English' }]), [
    'English 1',
    'English 2',
    'English 3',
  ]);
});

test('player control labels handle single tracks without numbers', () => {
  assert.deepEqual(languageLabels([{ label: 'Japanese [Audio]' }]), ['Japanese']);
});

test('player control labels fall back to a position, never a release name', () => {
  assert.equal(controlLanguageLabel('', ''), '');
  assert.deepEqual(languageLabels([{ label: undefined }, { label: 'Some.Very.Long.Release.Name.2023.1080p.WEB-DL.x264-GROUP' }]), [
    'Track 1',
    'Track 2',
  ]);
  assert.deepEqual(languageLabels([]), []);
});
