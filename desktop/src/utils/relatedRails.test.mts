import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distinctRecommendations } from './relatedRails.ts';
import type { SearchResponse } from '../types/api.ts';

const rec = (name: string, extra: Partial<SearchResponse> = {}): SearchResponse =>
  ({ name, url: `https://p.example/${encodeURIComponent(name)}`, apiName: 'P', ...extra }) as SearchResponse;

test('drops the title being viewed and the franchise rail entries', () => {
  const out = distinctRecommendations(
    [rec('The Dark Knight', { year: 2008 }), rec('Batman Begins'), rec('Heat', { year: 1995 }), rec('Inception')],
    {
      current: { name: 'The Dark Knight', year: 2008 },
      franchise: [
        { imdbId: 'tt0372784', title: 'Batman Begins', year: 2005, current: false },
        { imdbId: 'tt0468569', title: 'The Dark Knight', year: 2008, current: true },
      ],
    }
  );
  assert.deepEqual(out.map((r) => r.name), ['Heat', 'Inception']);
});

test('an IMDb id decides when both sides have one, and disagreeing years keep a remake', () => {
  const out = distinctRecommendations(
    [
      rec('Dune', { year: 1984 }),
      rec('Dune', { imdbId: 'tt1160419' }),
      rec('Dune Remake Under Another Id', { imdbId: 'tt9999999' }),
    ],
    { current: { name: 'Dune', year: 2021, imdbId: 'tt1160419' } }
  );
  assert.deepEqual(out.map((r) => r.year ?? r.imdbId), [1984, 'tt9999999']);
});

test('one card per address', () => {
  const twice = rec('Heat');
  assert.equal(distinctRecommendations([twice, { ...twice }], { current: { name: 'X' } }).length, 1);
});
