import assert from 'node:assert/strict';
import test from 'node:test';
import { TitleVideoKind, type TitleVideo } from '../../src/types/metadata.ts';
import { filterAndRankTrailers, planTrailerQueries } from './trailerDiscovery.ts';

test('planTrailerQueries handles empty/whitespace inputs', () => {
  assert.deepEqual(planTrailerQueries(''), []);
  assert.deepEqual(planTrailerQueries('   '), []);
});

test('planTrailerQueries preserves explicit intent when promotional keywords are present', () => {
  assert.deepEqual(planTrailerQueries('Dune Part Two official trailer'), ['Dune Part Two official trailer']);
  assert.deepEqual(planTrailerQueries('Stranger Things season 5 teaser'), ['Stranger Things season 5 teaser']);
  assert.deepEqual(planTrailerQueries('Batman behind the scenes'), ['Batman behind the scenes']);
  assert.deepEqual(planTrailerQueries('Interstellar exclusive clip'), ['Interstellar exclusive clip']);
  assert.deepEqual(planTrailerQueries('Avengers tv spot'), ['Avengers tv spot']);
});

test('planTrailerQueries expands unadorned titles into trailer and teaser/clip queries', () => {
  assert.deepEqual(planTrailerQueries('Spider-Man'), ['Spider-Man trailer', 'Spider-Man teaser clip']);
  assert.deepEqual(planTrailerQueries('an hull'), ['an hull trailer', 'an hull teaser clip']);
  assert.deepEqual(planTrailerQueries('Christopher Nolan'), ['Christopher Nolan trailer', 'Christopher Nolan teaser clip']);
});

test('filterAndRankTrailers filters by official status and kind and orders properly', () => {
  const sampleVideos: TitleVideo[] = [
    {
      id: 'youtube:1',
      title: 'Dune: Part Two | Official Trailer 3',
      url: 'https://youtube.com/watch?v=1',
      kind: TitleVideoKind.Trailer,
      label: 'Official Trailer 3',
      host: 'youtube',
      official: true,
      ordinal: 3,
    },
    {
      id: 'youtube:2',
      title: 'Dune: Part Two | Teaser',
      url: 'https://youtube.com/watch?v=2',
      kind: TitleVideoKind.Teaser,
      label: 'Teaser',
      host: 'youtube',
      official: true,
    },
    {
      id: 'youtube:3',
      title: 'Dune Fan Edit Trailer',
      url: 'https://youtube.com/watch?v=3',
      kind: TitleVideoKind.Trailer,
      label: 'Trailer',
      host: 'youtube',
      official: false,
      ordinal: 1,
    },
    {
      id: 'youtube:4',
      title: 'Dune BTS Making Of',
      url: 'https://youtube.com/watch?v=4',
      kind: TitleVideoKind.BehindTheScenes,
      label: 'Behind the scenes',
      host: 'youtube',
      official: false,
    },
  ];

  // Official only
  const officialOnly = filterAndRankTrailers(sampleVideos, { officialOnly: true });
  assert.equal(officialOnly.length, 2);
  assert.equal(officialOnly[0].id, 'youtube:1');
  assert.equal(officialOnly[1].id, 'youtube:2');

  // Kind filter: Teaser
  const teasers = filterAndRankTrailers(sampleVideos, { kind: TitleVideoKind.Teaser });
  assert.equal(teasers.length, 1);
  assert.equal(teasers[0].id, 'youtube:2');

  // Kind filter: Trailer
  const trailers = filterAndRankTrailers(sampleVideos, { kind: TitleVideoKind.Trailer });
  assert.equal(trailers.length, 2);
  // Official trailer 3 before fan trailer 1
  assert.equal(trailers[0].id, 'youtube:1');
  assert.equal(trailers[1].id, 'youtube:3');
});
