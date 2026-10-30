import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cachedEntities,
  EntityLookupUnavailable,
  entityStillMatches,
  parseGate,
  pickEntities,
  resetEntityCache,
  searchEntities,
  type GateRow,
  type NameHit,
} from './entitySearch.ts';
import { setHttpFetch } from '../torrent/http.ts';

// The live answers for "John Cena" and "Christopher Nolan" (2026-10-29), cut down.
const CENA: NameHit[] = [
  { id: 'Q44437', label: 'John Cena', description: 'American actor and professional wrestler (born 1977)' },
  { id: 'Q24699898', label: 'John Cenatiempo', description: 'American actor' },
  { id: 'Q85771436', label: 'John Cena', description: 'song by Sho Madjozi' },
  { id: 'Q6101149', label: 'John Cena Ibarra', description: 'Mexican politician' },
];
const CENA_GATE: GateRow[] = [
  { id: 'Q44437', human: true, credited: true, roles: ['cast'], produced: false, image: 'http://commons.wikimedia.org/wiki/Special:FilePath/John%20Cena.jpg' },
  { id: 'Q24699898', human: true, credited: true, roles: ['cast'], produced: false },
  { id: 'Q85771436', human: false, credited: false, roles: [], produced: false },
  { id: 'Q6101149', human: true, credited: false, roles: [], produced: false },
];

test('a person is a human credited on screen; a song or a politician of the name is not', () => {
  const people = pickEntities('John Cena', CENA, CENA_GATE);
  assert.deepEqual(people.map((p) => [p.id, p.kind]), [['Q44437', 'person']]);
  assert.equal(people[0].profileUrl, 'https://www.wikidata.org/wiki/Q44437');
  assert.match(people[0].imageUrl ?? '', /John/);
});

test('without an exact name, near names are offered in Wikidata’s order', () => {
  const near = pickEntities('John Cen', CENA, CENA_GATE);
  assert.deepEqual(near.map((p) => p.id), ['Q44437', 'Q24699898']);
});

test('a company is what produced a work, never a human', () => {
  const hits: NameHit[] = [
    { id: 'Q1696916', label: 'Yash Raj Films', description: 'Indian film studio founded 1970' },
    { id: 'Q8049699', label: 'Yash Raj Films International' },
  ];
  const gate: GateRow[] = [
    { id: 'Q1696916', human: false, credited: false, roles: [], produced: true },
    { id: 'Q8049699', human: false, credited: false, roles: [], produced: false },
  ];
  assert.deepEqual(pickEntities('yash raj films', hits, gate).map((e) => [e.id, e.kind]), [['Q1696916', 'company']]);
  // A human who is somehow a production company stays a person, or nothing.
  assert.equal(pickEntities('x', [{ id: 'Q1', label: 'X' }], [{ id: 'Q1', human: true, credited: false, roles: [], produced: true }]).length, 0);
});

test('a title query offers nobody', () => {
  const hits: NameHit[] = [
    { id: 'Q25188', label: 'Inception', description: '2010 film directed by Christopher Nolan' },
    { id: 'Q3797611', label: 'Inception', description: 'soundtrack album' },
  ];
  const gate: GateRow[] = hits.map((h) => ({ id: h.id, human: false, credited: false, roles: [], produced: false }));
  assert.deepEqual(pickEntities('Inception', hits, gate), []);
});

test('an exact person does not push out an exact company, and at most three are offered', () => {
  const hits: NameHit[] = [
    { id: 'Q1', label: 'Marvel' },
    { id: 'Q2', label: 'Marvel' },
    { id: 'Q3', label: 'Marvel Studios' },
    { id: 'Q4', label: 'Marvel' },
    { id: 'Q5', label: 'Marvel' },
  ];
  const gate: GateRow[] = [
    { id: 'Q1', human: true, credited: true, roles: ['cast'], produced: false },
    { id: 'Q2', human: false, credited: false, roles: [], produced: true },
    { id: 'Q3', human: false, credited: false, roles: [], produced: true },
    { id: 'Q4', human: false, credited: false, roles: [], produced: true },
    { id: 'Q5', human: false, credited: false, roles: [], produced: true },
  ];
  const picked = pickEntities('marvel', hits, gate);
  assert.deepEqual(picked.map((e) => e.id), ['Q1', 'Q2', 'Q4']);
});

test('a label that is only an id, or a hit the gate never answered, is left out', () => {
  assert.deepEqual(pickEntities('q', [{ id: 'Q9', label: 'Q9' }], [{ id: 'Q9', human: true, credited: true, roles: ['cast'], produced: false }]), []);
  assert.deepEqual(pickEntities('ann', [{ id: 'Q9', label: 'Ann' }], []), []);
});

test('a shorter query’s people still match while their name is being typed', () => {
  const [cena] = pickEntities('John Cena', CENA, CENA_GATE);
  assert.equal(entityStillMatches(cena, 'john ce'), true);
  assert.equal(entityStillMatches(cena, 'cena'), true);
  assert.equal(entityStillMatches(cena, 'john cenat'), false);
  assert.equal(entityStillMatches(cena, 'jane'), false);
});

test('the credit check reads one row per item, whatever the number of photos', () => {
  const rows = parseGate({
    results: {
      bindings: [
        { item: { value: 'http://www.wikidata.org/entity/Q44437' }, human: { value: 'true' }, cast: { value: 'true' }, director: { value: 'false' }, produced: { value: 'false' }, image: { value: 'a.jpg' } },
        { item: { value: 'http://www.wikidata.org/entity/Q44437' }, human: { value: 'true' }, cast: { value: 'true' }, produced: { value: 'false' }, image: { value: 'b.jpg' } },
        // An editor holds no chip's role but is still a film person.
        { item: { value: 'http://www.wikidata.org/entity/Q7' }, human: { value: 'true' }, other: { value: 'true' }, produced: { value: 'false' } },
        { item: { value: 'nonsense' } },
      ],
    },
  });
  assert.deepEqual(rows, [
    { id: 'Q44437', human: true, credited: true, roles: ['cast'], produced: false, image: 'a.jpg' },
    { id: 'Q7', human: true, credited: true, roles: [], produced: false, image: undefined },
  ]);
});

// "Christopher No" with a category (live 2026-10-30, cut down): who holds which credit.
const CHRIS: NameHit[] = [
  { id: 'Q336185', label: 'Chris Noth' },
  { id: 'Q25191', label: 'Christopher Nolan' },
  { id: 'Q185846', label: 'Chris Noonan' },
  { id: 'Q1', label: 'Some Studio' },
];
const CHRIS_GATE: GateRow[] = [
  { id: 'Q336185', human: true, credited: true, roles: ['cast'], produced: false },
  { id: 'Q25191', human: true, credited: true, roles: ['cast', 'director', 'writer', 'producer'], produced: false },
  { id: 'Q185846', human: true, credited: true, roles: ['director', 'writer'], produced: false },
  { id: 'Q1', human: false, credited: false, roles: [], produced: true },
];

test('a category keeps the people who hold that credit, and only Studio offers companies', () => {
  const ids = (categories: Parameters<typeof pickEntities>[3]) =>
    pickEntities('christopher no', CHRIS, CHRIS_GATE, categories).map((e) => e.id);
  assert.deepEqual(ids(['director']), ['Q25191', 'Q185846']);
  assert.deepEqual(ids(['cast']), ['Q336185', 'Q25191']);
  // Two categories are either, not both.
  assert.deepEqual(ids(['composer', 'cast']), ['Q336185', 'Q25191']);
  assert.deepEqual(ids(['studio']), ['Q1']);
  assert.deepEqual(ids(['composer']), []);
  // All (nothing selected) is everyone, at most three.
  assert.deepEqual(ids([]), ['Q336185', 'Q25191', 'Q185846']);
  assert.deepEqual(pickEntities('christopher no', CHRIS, CHRIS_GATE, ['director'])[1].roles, ['director', 'writer']);
});

test('a category may offer six; All three', () => {
  const hits: NameHit[] = Array.from({ length: 8 }, (_, i) => ({ id: `Q${i + 10}`, label: `Ann ${i}` }));
  const gate: GateRow[] = hits.map((h) => ({ id: h.id, human: true, credited: true, roles: ['director'], produced: false }));
  assert.equal(pickEntities('ann', hits, gate, ['director']).length, 6);
  assert.equal(pickEntities('ann', hits, gate).length, 3);
});

test('only Titles asks for nobody', async () => {
  assert.deepEqual(await searchEntities('John Cena', { categories: ['title'] }), []);
});

/** A stand-in for Wikidata: answers name searches and the credit check, counting both. */
function stubWikidata(options: { searchStatus?: number } = {}) {
  const calls = { search: 0, sparql: 0 };
  setHttpFetch((async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('wbsearchentities')) {
      calls.search++;
      if (options.searchStatus) return new Response('too many', { status: options.searchStatus });
      return Response.json({ search: [{ id: 'Q44437', label: 'John Cena' }] });
    }
    calls.sparql++;
    return Response.json({
      results: {
        bindings: [
          { item: { value: 'http://www.wikidata.org/entity/Q44437' }, human: { value: 'true' }, cast: { value: 'true' }, produced: { value: 'false' } },
        ],
      },
    });
  }) as typeof fetch);
  return calls;
}

test('typing sends nothing until it pauses; then one lookup, cached for the next ask', async () => {
  resetEntityCache();
  const calls = stubWikidata();
  // Every keystroke but the last is overtaken by the next one inside the pause.
  for (const typed of ['joh', 'john', 'john ', 'john c', 'john ce', 'john cen']) {
    const run = new AbortController();
    const asked = searchEntities(typed, { signal: run.signal }).catch(() => 'aborted');
    run.abort();
    assert.equal(await asked, 'aborted');
  }
  assert.deepEqual(calls, { search: 0, sparql: 0 });
  const found = await searchEntities('John Cena');
  assert.deepEqual(found.map((e) => e.name), ['John Cena']);
  assert.deepEqual(calls, { search: 1, sparql: 1 });
  assert.deepEqual(cachedEntities('john  cena')?.map((e) => e.id), ['Q44437']);
  await searchEntities('John Cena');
  assert.deepEqual(calls, { search: 1, sparql: 1 });
  // Another category is another question, but the person's credits are already known.
  await searchEntities('John Cena', { categories: ['cast'] });
  assert.deepEqual(calls, { search: 2, sparql: 1 });
});

test('a refusal is not "nobody", and stops all asking for a while', async () => {
  resetEntityCache();
  const calls = stubWikidata({ searchStatus: 429 });
  await assert.rejects(searchEntities('Hans Zimmer'), EntityLookupUnavailable);
  assert.equal(cachedEntities('Hans Zimmer'), undefined);
  await assert.rejects(searchEntities('Tom Hanks'), EntityLookupUnavailable);
  assert.equal(calls.search, 1);
  resetEntityCache();
});
