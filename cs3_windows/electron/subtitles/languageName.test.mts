import { test } from 'node:test';
import assert from 'node:assert/strict';

import { languageName, withoutAdverts } from '../subtitleService.ts';

test('language names read the same whatever code a source used', () => {
  assert.equal(languageName('eng'), 'English');
  // Providers publish two-letter codes and plain names as often as ISO 639-2.
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('hi'), 'Hindi');
  assert.equal(languageName('English'), 'English');
  assert.equal(languageName('xx'), 'XX');
});

test('OpenSubtitles advertising cues are removed and dialogue is kept', () => {
  const vtt = 'WEBVTT\n\n00:00:06.000 --> 00:00:12.074\nDo you want subtitles for any video?\n-=[ ai.OpenSubtitles.com ]=-\n\n00:00:32.958 --> 00:00:33.958\nTyler!';
  const cleaned = withoutAdverts(vtt);
  assert.ok(!/opensubtitles/i.test(cleaned));
  assert.ok(cleaned.includes('Tyler!'));
  assert.ok(cleaned.startsWith('WEBVTT'));
});
