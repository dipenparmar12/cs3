import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companionPath, languageTag, vttToSrt } from './companion.ts';

test('language tags prefer ISO 639-1', () => {
  assert.equal(languageTag('English'), 'en');
  assert.equal(languageTag('hin'), 'hi');
  assert.equal(languageTag('pt'), 'pt');
  assert.equal(languageTag('Klingon (fan)'), 'klingon');
  assert.equal(languageTag(undefined), 'und');
});

test('the companion sits beside the media with a language tag', () => {
  assert.equal(companionPath('C:\\Movies\\Dune (2021)\\Dune.mkv', 'en'), 'C:\\Movies\\Dune (2021)\\Dune.en.srt');
  assert.equal(companionPath('/m/file', 'hi'), '/m/file.hi.srt');
});

test('VTT becomes numbered SubRip with comma milliseconds', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500 align:start\nHello\nthere\n\nNOTE skip\n\n01:02.5 --> 01:04.000\nBye\n';
  assert.equal(
    vttToSrt(vtt),
    '1\n00:00:01,000 --> 00:00:02,500\nHello\nthere\n\n2\n00:01:02,500 --> 00:01:04,000\nBye\n'
  );
});
