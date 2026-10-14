/**
 * The default audio plays only when nobody chose. `bun run test audioPreference`
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordedAudioChoice, wantedAudioLanguage } from './audioPreference.ts';

test('nothing chosen anywhere: the stream default (undefined)', () => {
  assert.equal(wantedAudioLanguage(null, null, null), undefined);
});

test('a default an older build stored is not a choice', () => {
  // The reported case: Hindi chosen everywhere, `eng` recorded for this title
  // only because English is what played first.
  assert.equal(wantedAudioLanguage(null, { audioLanguage: 'eng' }, 'hin'), 'hin');
});

test('a choice stored for this title outranks the everywhere language', () => {
  assert.equal(wantedAudioLanguage(null, { audioLanguage: 'tam', audioChosen: true }, 'hin'), 'tam');
});

test("this session's pick outranks everything stored", () => {
  assert.equal(wantedAudioLanguage('tel', { audioLanguage: 'tam', audioChosen: true }, 'hin'), 'tel');
});

test('only a choice is recorded, and an unchosen default is cleared', () => {
  assert.deepEqual(recordedAudioChoice(null, { audioLanguage: 'eng' }), {
    audioLanguage: undefined,
    audioChosen: undefined,
  });
  assert.deepEqual(recordedAudioChoice('hin', null), { audioLanguage: 'hin', audioChosen: true });
  assert.deepEqual(recordedAudioChoice(null, { audioLanguage: 'tam', audioChosen: true }), {
    audioLanguage: 'tam',
    audioChosen: true,
  });
});

test('the cleared fields are present, so the record merge overwrites them', () => {
  const merged = { ...{ audioLanguage: 'eng' }, ...recordedAudioChoice(null, null) };
  assert.equal(merged.audioLanguage, undefined);
});
