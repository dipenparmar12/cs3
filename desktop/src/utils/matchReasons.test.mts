import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchReasons, reasonFor } from './matchReasons.ts';
import type { SearchResponse } from '../types/api.ts';
import type { Filmography } from '../types/filmography.ts';

const cena: Filmography = {
  name: 'John Cena',
  source: 'wikidata',
  works: [
    { title: 'Peacemaker', year: 2022, type: 'series', imdbId: 'tt13146488', roles: ['Acting', 'Producing'], character: 'Christopher Smith' },
    { title: 'Blockers', year: 2018, type: 'movie', roles: ['Acting'] },
    { title: 'Surf’s Up 2', year: 2017, type: 'movie', roles: ['Voice'] },
  ],
};

const row = (name: string, extra: Partial<SearchResponse> = {}): SearchResponse => ({
  name,
  url: `p://${name}/${extra.year ?? ''}`,
  apiName: 'Provider',
  ...extra,
});

test('the headline credit names the card; every credit is in the detail', () => {
  assert.deepEqual(reasonFor('John Cena', cena.works[0]), {
    label: 'Cast: John Cena',
    detail: 'Acting as Christopher Smith · Producing',
  });
  assert.equal(
    reasonFor('Christopher Nolan', { title: 'Oppenheimer', type: 'movie', roles: ['Producing', 'Writing', 'Directing'] })?.label,
    'Directed by Christopher Nolan'
  );
  // An actor who directed it is named as its director.
  assert.equal(
    reasonFor('Clint Eastwood', { title: 'Gran Torino', type: 'movie', roles: ['Acting', 'Directing'] })?.label,
    'Directed by Clint Eastwood'
  );
  assert.equal(reasonFor('Yash Raj Films', { title: 'Pathaan', type: 'movie', roles: ['Production'] })?.label, 'Produced by Yash Raj Films');
  assert.equal(reasonFor('Nobody', { title: 'X', type: 'movie', roles: [] }), null);
});

test('an IMDb id decides: a different id is not their work, whatever it is called', () => {
  const reasons = matchReasons(
    [row('Peacemaker', { imdbId: 'tt13146488' }), row('Blockers', { imdbId: 'tt0000001' })],
    cena
  );
  assert.equal(reasons.get('p://Peacemaker/')?.label, 'Cast: John Cena');
  assert.equal(reasons.has('p://Blockers/'), false);
});

test('without an id, the folded title must match and the years must not disagree', () => {
  const reasons = matchReasons(
    [
      row('BLOCKERS', { year: 2019 }),
      row('Blockers', { year: 2008 }),
      row('Surfs Up 2'),
      row('Some Title', { originalTitle: 'Blockers' }),
      row('John Cena: Champion of the Ring', { year: 2020 }),
    ],
    cena
  );
  assert.equal(reasons.get('p://BLOCKERS/2019')?.label, 'Cast: John Cena');
  assert.equal(reasons.has('p://Blockers/2008'), false);
  assert.equal(reasons.get('p://Surfs Up 2/')?.label, 'Voice: John Cena');
  assert.equal(reasons.get('p://Some Title/')?.label, 'Cast: John Cena');
  // A documentary about him that does not credit him says nothing.
  assert.equal(reasons.has('p://John Cena: Champion of the Ring/2020'), false);
});

test('no works, or rows with no address, give no reasons', () => {
  assert.equal(matchReasons([row('Blockers')], { ...cena, works: [] }).size, 0);
  assert.equal(matchReasons([{ name: 'Blockers', url: '', apiName: 'P' }], cena).size, 0);
});
