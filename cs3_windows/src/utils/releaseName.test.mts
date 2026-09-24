import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tidyReleaseName } from './releaseName.ts';

/**
 * Release names into titles, and — the half that matters more — titles left
 * alone. A tidied label that is wrong reads as data corruption, so every case
 * a looser rule would break is pinned beside the ones it fixes.
 */

const tidy = (raw: string) => {
  const { title, year } = tidyReleaseName(raw);
  return year === undefined ? title : `${title} (${year})`;
};

test('file metadata after the title goes', () => {
  assert.equal(tidy('Avengers End Game 720p Hindi Dubbed'), 'Avengers End Game');
  assert.equal(tidy('Avengers.Endgame.2019.1080p.BluRay.x264-GROUP'), 'Avengers Endgame (2019)');
  assert.equal(tidy('Avengers Endgame (2019) [Dual Audio] [Org DD5.1]'), 'Avengers Endgame (2019)');
  assert.equal(tidy('Dune Part Two 2024 2160p WEB-DL'), 'Dune Part Two (2024)');
  assert.equal(tidy('Breaking Bad S01E05 720p'), 'Breaking Bad');
  assert.equal(tidy('The Office Season 2 Complete'), 'The Office');
});

test('real titles are left alone', () => {
  for (const title of [
    'Spider-Man: No Way Home',
    'A Proper Violence',
    'Uncut Gems',
    'Extended Family',
    'Mr. Robot',
    'Multiverse of Madness',
    'Season of the Witch',
    'S1m0ne',
    'Dune Part Two',
  ]) {
    assert.equal(tidy(title), title, title);
  }
});

test('a year that is part of the title stays in it', () => {
  assert.equal(tidy('Blade Runner 2049 (2017) 2160p'), 'Blade Runner 2049 (2017)');
  assert.equal(tidy('Blade Runner 2049'), 'Blade Runner 2049');
  assert.equal(tidy('1917 (2019)'), '1917 (2019)');
  assert.equal(tidy('2012'), '2012');
});

test('nothing left means the original, never an empty label', () => {
  assert.equal(tidy('1080p'), '1080p');
  assert.equal(tidyReleaseName('').title, '');
  assert.equal(tidyReleaseName('Dune').changed, false);
});
